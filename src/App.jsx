import { useState, useEffect } from 'react'
import { supabase } from './supabase'

const fmt2 = v => v != null ? Number(v).toFixed(2) : '—'
const fmt3 = v => v != null ? Number(v).toFixed(3) : '—'
const fmtPct = v => v != null ? Number(v).toFixed(1) + '%' : '—'
const fmtEV = v => v != null ? (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%' : '—'
const pf = v => parseFloat(String(v).replace(',', '.')) || 0

function calcBackEV(prob, odds, comm = 0.05) {
  if (!prob || !odds) return null
  return prob * (odds - 1) * (1 - comm) - (1 - prob)
}

function fuzzyScore(a, b) {
  if (!a || !b) return 0
  const na = a.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
  const nb = b.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
  if (na === nb) return 1
  const tokA = na.split(' ')
  const tokB = nb.split(' ')
  let matches = 0
  for (const ta of tokA) {
    if (ta.length < 2) continue
    for (const tb of tokB) {
      if (tb.length < 2) continue
      if (ta === tb || ta.startsWith(tb) || tb.startsWith(ta)) { matches++; break }
    }
  }
  return matches / Math.max(tokA.length, tokB.length)
}

// Validácia kickoff času — Betfair event time vs náš kickoff (±3 hodiny)
// Betfair API vracia time ako unix timestamp v ev.time alebo ev.starts
function kickoffValid(ev, kickoffIso, toleranceHours = 3) {
  if (!kickoffIso) return true // ak nemáme kickoff, neblokujeme
  const evTime = ev.time ? ev.time * 1000 : ev.starts ? new Date(ev.starts).getTime() : null
  if (!evTime) return true // Betfair nám nedal čas, neblokujeme
  const diff = Math.abs(evTime - new Date(kickoffIso).getTime())
  return diff <= toleranceHours * 60 * 60 * 1000
}

// Nájdi Betfair event — najprv DB, potom fuzzy, vždy validuj kickoff
function findBetfairEvent(homeName, awayName, betfairEvents, teamNameDb, kickoffIso) {
  const dbHome = teamNameDb.find(t => t.footystats_name.toLowerCase() === homeName.toLowerCase())
  const dbAway = teamNameDb.find(t => t.footystats_name.toLowerCase() === awayName.toLowerCase())

  // Obaja v DB — hľadaj presný event + validuj čas
  if (dbHome && dbAway) {
    const ev = betfairEvents.find(e =>
      e.home?.name?.toLowerCase() === dbHome.betfair_name.toLowerCase() &&
      e.away?.name?.toLowerCase() === dbAway.betfair_name.toLowerCase() &&
      kickoffValid(e, kickoffIso)
    )
    if (ev) return { event: ev, score: 1.0, source: 'db' }
    // Tímy sú v DB ale čas nesedí — varuj, nespadni na fuzzy automaticky
    const evNoTime = betfairEvents.find(e =>
      e.home?.name?.toLowerCase() === dbHome.betfair_name.toLowerCase() &&
      e.away?.name?.toLowerCase() === dbAway.betfair_name.toLowerCase()
    )
    if (evNoTime) return { event: evNoTime, score: 0.85, source: 'db_time_mismatch' }
  }

  // Jeden v DB — kotva + fuzzy pre druhého + validuj čas
  if (dbHome || dbAway) {
    let best = null, bestScore = 0
    for (const ev of betfairEvents) {
      if (!kickoffValid(ev, kickoffIso)) continue
      const sh = dbHome
        ? (ev.home?.name?.toLowerCase() === dbHome.betfair_name.toLowerCase() ? 1.0 : 0)
        : fuzzyScore(homeName, ev.home?.name || '')
      const sa = dbAway
        ? (ev.away?.name?.toLowerCase() === dbAway.betfair_name.toLowerCase() ? 1.0 : 0)
        : fuzzyScore(awayName, ev.away?.name || '')
      const total = (sh + sa) / 2
      if (total > bestScore && total > 0.4) { bestScore = total; best = ev }
    }
    if (best) return { event: best, score: bestScore, source: 'db+fuzzy' }
  }

  // Čistý fuzzy + validuj čas
  let best = null, bestScore = 0
  for (const ev of betfairEvents) {
    if (!kickoffValid(ev, kickoffIso)) continue
    const sh = fuzzyScore(homeName, ev.home?.name || '')
    const sa = fuzzyScore(awayName, ev.away?.name || '')
    const total = (sh + sa) / 2
    if (total > bestScore && total > 0.3) { bestScore = total; best = ev }
  }
  if (best) return { event: best, score: bestScore, source: 'fuzzy' }
  return null
}

const css = `
  * { box-sizing: border-box; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 20px 16px 60px; }
  .header { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 10; }
  .logo { font-weight: 800; font-size: 17px; letter-spacing: -0.02em; color: var(--accent2); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px var(--green); flex-shrink: 0; }
  .tabs { border-bottom: 1px solid var(--border); padding: 0 24px; display: flex; gap: 2px; background: var(--bg2); overflow-x: auto; }
  .tab { cursor: pointer; padding: 10px 16px; border: none; background: transparent; font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text3); transition: all 0.2s; border-bottom: 2px solid transparent; white-space: nowrap; }
  .tab.active { color: var(--accent2); border-bottom-color: var(--accent); }
  .card { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .card + .card { margin-top: 10px; }
  .label { font-size: 10px; color: var(--text3); letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 5px; }
  .inp { width: 100%; background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; padding: 9px 12px; color: var(--text); font-family: var(--mono); font-size: 13px; }
  .inp:focus { border-color: var(--accent); outline: none; }
  .inp-sm { padding: 6px 9px; font-size: 12px; }
  .btn { cursor: pointer; border: none; font-family: var(--mono); font-size: 11px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; padding: 10px 18px; border-radius: 6px; transition: all 0.2s; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-ghost { cursor: pointer; background: transparent; border: 1px solid var(--border2); color: var(--text2); font-family: var(--mono); font-size: 11px; padding: 6px 12px; border-radius: 4px; }
  .btn-green { cursor: pointer; background: rgba(0,184,148,0.15); border: 1px solid rgba(0,184,148,0.4); color: var(--green); font-family: var(--mono); font-size: 11px; padding: 6px 12px; border-radius: 4px; font-weight: 700; }
  .btn-yellow { cursor: pointer; background: rgba(253,203,110,0.12); border: 1px solid rgba(253,203,110,0.4); color: var(--yellow); font-family: var(--mono); font-size: 11px; padding: 6px 12px; border-radius: 4px; font-weight: 700; }
  .btn-danger { cursor: pointer; background: transparent; border: 1px solid rgba(214,48,49,0.3); color: var(--red); font-family: var(--mono); font-size: 11px; padding: 6px 10px; border-radius: 4px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .grid4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; }
  .pos { color: var(--green); }
  .neg { color: var(--red); }
  .badge { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 3px; font-weight: 600; }
  .badge-value { background: rgba(0,184,148,0.15); color: var(--green); }
  .badge-pending { background: rgba(253,203,110,0.15); color: var(--yellow); }
  .badge-no-match { background: rgba(107,112,148,0.15); color: var(--text3); }
  .badge-db { background: rgba(108,92,231,0.15); color: var(--accent2); }
  .match-row { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-bottom: 8px; }
  .match-row.has-value { border-color: rgba(0,184,148,0.4); background: rgba(0,184,148,0.04); }
  .match-row.no-match { opacity: 0.75; }
  .ev-pill { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 700; font-family: var(--mono); }
  .ev-pos { background: rgba(0,184,148,0.15); color: var(--green); }
  .ev-neg { background: rgba(214,48,49,0.1); color: var(--red); }
  .ev-zero { background: rgba(253,203,110,0.1); color: var(--yellow); }
  .section-title { font-size: 10px; color: var(--text3); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  .loading { text-align: center; padding: 60px; color: var(--text3); }
  .empty { text-align: center; padding: 60px; color: var(--text3); line-height: 1.8; }
  .odds-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 10px; }
  .odds-cell { background: var(--bg3); border-radius: 6px; padding: 8px 10px; }
  .odds-cell.has-value { background: rgba(0,184,148,0.08); border: 1px solid rgba(0,184,148,0.3); }
  .mapping-row { padding: 12px 14px; border-bottom: 1px solid var(--border); font-size: 12px; }
  .mapping-row:last-child { border-bottom: none; }
  .pulse { animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }
`

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [matches, setMatches] = useState([])
  const [mappings, setMappings] = useState([])
  const [teamNameDb, setTeamNameDb] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [betfairEvents, setBetfairEvents] = useState([])
  const [loadingBetfair, setLoadingBetfair] = useState(false)
  const [mappingSearch, setMappingSearch] = useState({})
  const [changingMapping, setChangingMapping] = useState({})

  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    setLoading(true)
    const [{ data: m }, { data: mp }, { data: tndb }] = await Promise.all([
      supabase.from('watched_matches').select('*, odds_snapshots(*)').eq('match_date', today).eq('status', 'active').order('kick_off'),
      supabase.from('team_mapping').select('*').order('created_at', { ascending: false }),
      supabase.from('team_name_mapping').select('*').order('footystats_name'),
    ])
    setMatches(m || [])
    setMappings(mp || [])
    setTeamNameDb(tndb || [])
    setLoading(false)
  }

  async function loadBetfairEvents() {
    setLoadingBetfair(true)
    try {
      let events = []
      const first = await fetch(`/api/betsapi?endpoint=betfair/ex/upcoming&sport_id=1&page=1`)
      const firstJson = await first.json()
      if (firstJson?.results) events = events.concat(firstJson.results)
      const total = firstJson?.pager?.total || 0
      const perPage = firstJson?.pager?.per_page || 50
      const totalPages = Math.min(Math.ceil(total / perPage), 15)
      for (let page = 2; page <= totalPages; page++) {
        const res = await fetch(`/api/betsapi?endpoint=betfair/ex/upcoming&sport_id=1&page=${page}`)
        const json = await res.json()
        if (json?.results) events = events.concat(json.results)
      }
      setBetfairEvents(events)
    } catch (e) { console.error(e) }
    setLoadingBetfair(false)
  }

  // Uloží oba tímy do perzistentnej DB názvov
  async function saveTeamNames(footystatsHome, betfairHome, footystatsAway, betfairAway) {
    const ops = []
    if (footystatsHome && betfairHome)
      ops.push(supabase.from('team_name_mapping').upsert(
        { footystats_name: footystatsHome, betfair_name: betfairHome },
        { onConflict: 'footystats_name' }
      ))
    if (footystatsAway && betfairAway)
      ops.push(supabase.from('team_name_mapping').upsert(
        { footystats_name: footystatsAway, betfair_name: betfairAway },
        { onConflict: 'footystats_name' }
      ))
    if (ops.length) await Promise.all(ops)
  }

  async function autoMatch() {
    if (betfairEvents.length === 0) await loadBetfairEvents()
    setRefreshing(true)
    for (const match of matches) {
      const existing = mappings.find(m =>
        m.footystats_home === match.home_name && m.footystats_away === match.away_name
      )
      if (existing?.confirmed) continue

      const result = findBetfairEvent(match.home_name, match.away_name, betfairEvents, teamNameDb, match.kick_off)
      if (result) {
        const { event: best, score, source } = result
        const autoConfirm = score >= 0.7 || source === 'db'
        await supabase.from('team_mapping').upsert({
          footystats_home: match.home_name, footystats_away: match.away_name,
          betfair_event_id: best.id, betfair_home: best.home?.name, betfair_away: best.away?.name,
          confirmed: autoConfirm,
        }, { onConflict: 'footystats_home,footystats_away' })
        if (autoConfirm)
          await saveTeamNames(match.home_name, best.home?.name, match.away_name, best.away?.name)
      } else {
        await supabase.from('team_mapping').upsert({
          footystats_home: match.home_name, footystats_away: match.away_name,
          betfair_event_id: null, betfair_home: null, betfair_away: null, confirmed: false,
        }, { onConflict: 'footystats_home,footystats_away' })
      }
    }
    await loadData()
    setRefreshing(false)
  }

  async function refreshOdds() {
    setRefreshing(true)
    for (const match of matches) {
      const mapping = mappings.find(m =>
        m.footystats_home === match.home_name && m.footystats_away === match.away_name &&
        m.confirmed && m.betfair_event_id
      )
      if (!mapping) continue
      try {
        const res = await fetch(`/api/betsapi?endpoint=betfair/ex/event&event_id=${mapping.betfair_event_id}`)
        const json = await res.json()
        const mkts = json?.results?.[0]?.markets
        if (!mkts) continue
        const getBack = (mkt, side) => {
          if (!mkt) return null
          for (const r of mkt.runners || [])
            if (r.description?.runnerName?.toLowerCase().includes(side))
              return r.exchange?.availableToBack?.[0]?.price || null
          return null
        }
        const ou25 = mkts.find(m => m.description?.marketName === 'Over/Under 2.5 Goals')
        const ou30s = mkts.find(m => m.description?.marketName === 'Over/Under 3.0 Goals')
        const gl = mkts.find(m => m.description?.marketName === 'Goal Lines')
        const getGL = (h, s) => {
          if (!gl) return null
          const r = gl.runners?.find(r => r.handicap === h && r.description?.runnerName?.toLowerCase().startsWith(s))
          return r?.exchange?.availableToBack?.[0]?.price || null
        }
        const bo25 = getBack(ou25, 'over'), bu25 = getBack(ou25, 'under')
        const bo30 = ou30s ? getBack(ou30s, 'over') : getGL(3, 'over')
        const bu30 = ou30s ? getBack(ou30s, 'under') : getGL(3, 'under')
        const comm = 0.05
        const ev25 = bo25 ? calcBackEV(match.p_over25, bo25, comm) : null
        const evu25 = bu25 ? calcBackEV(match.p_under25, bu25, comm) : null
        const ev30 = bo30 ? calcBackEV(match.p_over30, bo30, comm) : null
        const evu30 = bu30 ? calcBackEV(match.p_under30, bu30, comm) : null
        await supabase.from('odds_snapshots').insert({
          watched_match_id: match.id, betfair_event_id: mapping.betfair_event_id,
          back_over25: bo25, back_under25: bu25, back_over30: bo30, back_under30: bu30,
          ev_over25: ev25 != null ? ev25 * 100 : null, ev_under25: evu25 != null ? evu25 * 100 : null,
          ev_over30: ev30 != null ? ev30 * 100 : null, ev_under30: evu30 != null ? evu30 * 100 : null,
          value_found: [ev25, evu25, ev30, evu30].some(ev => ev != null && ev > 0.05),
        })
      } catch (e) { console.error(e) }
    }
    await loadData()
    setRefreshing(false)
  }

  async function confirmMapping(mappingId, betfairEventId, betfairHome, betfairAway, fsHome, fsAway) {
    await supabase.from('team_mapping').update({
      betfair_event_id: betfairEventId, betfair_home: betfairHome,
      betfair_away: betfairAway, confirmed: true,
    }).eq('id', mappingId)
    await saveTeamNames(fsHome, betfairHome, fsAway, betfairAway)
    setChangingMapping(prev => ({ ...prev, [mappingId]: false }))
    await loadData()
  }

  async function changeMatchMapping(fsHome, fsAway, betfairEventId, betfairHome, betfairAway) {
    await supabase.from('team_mapping').upsert({
      footystats_home: fsHome, footystats_away: fsAway,
      betfair_event_id: betfairEventId, betfair_home: betfairHome,
      betfair_away: betfairAway, confirmed: true,
    }, { onConflict: 'footystats_home,footystats_away' })
    await saveTeamNames(fsHome, betfairHome, fsAway, betfairAway)
    await loadData()
  }

  async function deleteMapping(id) {
    await supabase.from('team_mapping').delete().eq('id', id)
    await loadData()
  }

  async function deleteTeamName(id) {
    await supabase.from('team_name_mapping').delete().eq('id', id)
    await loadData()
  }

  async function deleteMatch(id) {
    await supabase.from('watched_matches').update({ status: 'expired' }).eq('id', id)
    await loadData()
  }

  function getLatestSnapshot(match) {
    const snaps = match.odds_snapshots || []
    if (!snaps.length) return null
    return snaps.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
  }

  const unmappedCount = mappings.filter(m => !m.confirmed).length
  const valueCount = matches.filter(m => getLatestSnapshot(m)?.value_found).length

  // Pomocná funkcia pre inline search dropdown
  function SearchDropdown({ searchKey, placeholder, onSelect }) {
    const val = mappingSearch[searchKey] || ''
    const results = val.length > 1
      ? betfairEvents.filter(ev =>
          ev.home?.name?.toLowerCase().includes(val.toLowerCase()) ||
          ev.away?.name?.toLowerCase().includes(val.toLowerCase())
        ).slice(0, 8)
      : []
    return (
      <div style={{ position: 'relative', marginTop: 8 }}>
        <input
          className="inp inp-sm"
          placeholder={placeholder || 'Hľadaj na Betfaire...'}
          value={val}
          autoFocus
          onChange={e => setMappingSearch(prev => ({ ...prev, [searchKey]: e.target.value }))}
        />
        {loadingBetfair && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>⏳ Načítavam Betfair eventy...</div>}
        {!loadingBetfair && betfairEvents.length === 0 && (
          <div style={{ fontSize: 10, color: 'var(--yellow)', marginTop: 4 }}>⚠ Eventy nie sú načítané — klikni "Načítať Betfair eventy" v Mapping záložke</div>
        )}
        {results.length > 0 && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 50, maxHeight: 220, overflowY: 'auto' }}>
            {results.map(ev => (
              <div key={ev.id}
                style={{ padding: '8px 10px', cursor: 'pointer', fontSize: 11, borderBottom: '1px solid var(--border)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg2)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => {
                  onSelect(ev)
                  setMappingSearch(prev => ({ ...prev, [searchKey]: '' }))
                }}
              >
                <b>{ev.home?.name}</b> vs {ev.away?.name}
                <span style={{ color: 'var(--text3)', marginLeft: 6, fontSize: 10 }}>{ev.league?.name || ''}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <style>{css}</style>
      <div className="header">
        <div className="dot" />
        <span className="logo">VALUE TRACKER</span>
        <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 4 }}>Betfair Exchange Monitor</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {valueCount > 0 && <span className="pulse" style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700 }}>⚡ {valueCount} VALUE</span>}
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{matches.length} sledovaných</span>
        </div>
      </div>

      <div className="tabs">
        {[
          ['dashboard', `Dashboard (${matches.length})`],
          ['mapping', `Mapping (${unmappedCount} neopravených)`],
          ['teamdb', `🗄 Databáza tímov (${teamNameDb.length})`],
          ['add', '+ Pridať zápas'],
        ].map(([id, lbl]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>{lbl}</button>
        ))}
      </div>

      <div className="wrap">

        {/* ── DASHBOARD ── */}
        {tab === 'dashboard' && (
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn btn-primary" onClick={refreshOdds} disabled={refreshing}>
                {refreshing ? '⏳ Sťahujem...' : '🔄 Refresh kurzy'}
              </button>
              <button className="btn-ghost" onClick={autoMatch} disabled={refreshing}>
                🤖 Auto-match Betfair
              </button>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                Posledný refresh: {new Date().toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {loading && <div className="loading">Načítavam...</div>}
            {!loading && matches.length === 0 && (
              <div className="empty">Žiadne sledované zápasy na dnes.<br />Klikni "+ Pridať zápas" alebo použij xg-calc skenera.</div>
            )}

            {matches.map(match => {
              const mapping = mappings.find(m => m.footystats_home === match.home_name && m.footystats_away === match.away_name)
              const snap = getLatestSnapshot(match)
              const hasValue = snap?.value_found
              const isConfirmed = mapping?.confirmed
              const dashKey = `dash_${match.id}`
              const isChanging = !!changingMapping[dashKey]
              const homeInDb = teamNameDb.find(t => t.footystats_name.toLowerCase() === match.home_name.toLowerCase())
              const awayInDb = teamNameDb.find(t => t.footystats_name.toLowerCase() === match.away_name.toLowerCase())
              const mkts = [
                { label: 'O 2.5', fer: match.fer_over25, p: match.p_over25, back: snap?.back_over25, ev: snap?.ev_over25 },
                { label: 'U 2.5', fer: match.fer_under25, p: match.p_under25, back: snap?.back_under25, ev: snap?.ev_under25 },
                { label: 'O 3.0', fer: match.fer_over30, p: match.p_over30, back: snap?.back_over30, ev: snap?.ev_over30 },
                { label: 'U 3.0', fer: match.fer_under30, p: match.p_under30, back: snap?.back_under30, ev: snap?.ev_under30 },
              ]
              return (
                <div key={match.id} className={`match-row ${hasValue ? 'has-value' : ''} ${!isConfirmed ? 'no-match' : ''}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        {hasValue && <span className="badge badge-value">⚡ VALUE</span>}
                        {!isConfirmed && <span className="badge badge-no-match">⚠ Bez mappingu</span>}
                        {isConfirmed && !snap && <span className="badge badge-pending">Čaká na kurzy</span>}
                        <span style={{ fontWeight: 700, fontSize: 13 }}>{match.home_name} vs {match.away_name}</span>
                        {match.league && <span style={{ fontSize: 10, color: 'var(--accent2)', background: 'rgba(108,92,231,0.1)', padding: '1px 6px', borderRadius: 3 }}>{match.league}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span>λ {fmt2(match.lambda_h)} / {fmt2(match.lambda_a)}</span>
                        {match.kick_off && <span style={{ color: 'var(--yellow)' }}>⏰ {new Date(match.kick_off).toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' })}</span>}
                        {isConfirmed && mapping?.betfair_home && <span style={{ color: 'var(--green)', fontSize: 10 }}>✓ {mapping.betfair_home} vs {mapping.betfair_away}</span>}
                        {(homeInDb || awayInDb) && (
                          <span className="badge badge-db" style={{ fontSize: 9 }}>
                            🗄 {homeInDb && awayInDb ? 'obaja v DB' : homeInDb ? 'home v DB' : 'away v DB'}
                          </span>
                        )}
                        <button
                          className={isConfirmed ? 'btn-yellow' : 'btn-green'}
                          style={{ padding: '3px 8px', fontSize: 10 }}
                          onClick={() => {
                            if (betfairEvents.length === 0) loadBetfairEvents()
                            setChangingMapping(prev => ({ ...prev, [dashKey]: !prev[dashKey] }))
                            setMappingSearch(prev => ({ ...prev, [dashKey]: '' }))
                          }}
                        >
                          {isChanging ? '✕ Zatvoriť' : isConfirmed ? '✏ Zmeniť mapping' : '+ Pridať mapping'}
                        </button>
                      </div>
                      {isChanging && (
                        <SearchDropdown
                          searchKey={dashKey}
                          onSelect={async ev => {
                            await changeMatchMapping(match.home_name, match.away_name, ev.id, ev.home?.name, ev.away?.name)
                            setChangingMapping(prev => ({ ...prev, [dashKey]: false }))
                          }}
                        />
                      )}
                    </div>
                    <button className="btn-danger" onClick={() => deleteMatch(match.id)}>✕</button>
                  </div>
                  <div className="odds-grid">
                    {mkts.map(mkt => {
                      const evVal = mkt.ev
                      const hasEdge = evVal != null && evVal > 5
                      return (
                        <div key={mkt.label} className={`odds-cell ${hasEdge ? 'has-value' : ''}`}>
                          <div style={{ fontSize: 10, color: 'var(--text3)', fontWeight: 700, marginBottom: 4 }}>{mkt.label}</div>
                          <div style={{ fontSize: 11, marginBottom: 2 }}>FER: <b style={{ color: 'var(--accent2)' }}>{mkt.fer ? fmt3(mkt.fer) : '—'}</b></div>
                          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4 }}>P: {mkt.p ? fmtPct(mkt.p * 100) : '—'}</div>
                          {mkt.back && <div style={{ fontSize: 11, marginBottom: 3 }}>Back: <b>{fmt3(mkt.back)}</b></div>}
                          {evVal != null && <span className={`ev-pill ${evVal > 5 ? 'ev-pos' : evVal > 0 ? 'ev-zero' : 'ev-neg'}`}>EV {fmtEV(evVal)}</span>}
                        </div>
                      )
                    })}
                  </div>
                  {snap && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8, textAlign: 'right' }}>Kurzy z {new Date(snap.created_at).toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' })}</div>}
                </div>
              )
            })}
          </div>
        )}

        {/* ── MAPPING ── */}
        {tab === 'mapping' && (
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={autoMatch} disabled={loadingBetfair || refreshing}>
                {loadingBetfair ? '⏳ Načítavam Betfair...' : refreshing ? '⏳ Matchujem...' : '🤖 Auto-match všetky'}
              </button>
              <button className="btn-ghost" onClick={loadBetfairEvents} disabled={loadingBetfair}>
                {loadingBetfair ? '⏳' : '📡 Načítať Betfair eventy'}
              </button>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{betfairEvents.length} eventov načítaných</span>
            </div>
            {mappings.length === 0 && <div className="empty">Žiadne mappingy.</div>}
            <div className="card" style={{ padding: 0 }}>
              {mappings.map(mp => {
                const isChangingThis = !!changingMapping[mp.id]
                return (
                  <div key={mp.id} className="mapping-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{mp.footystats_home} vs {mp.footystats_away}</div>
                        {mp.confirmed && mp.betfair_home
                          ? <div style={{ fontSize: 11, color: mp.match_source === 'db_time_mismatch' ? 'var(--yellow)' : 'var(--green)', marginTop: 2 }}>
                              {mp.match_source === 'db_time_mismatch' ? '⚠ ' : '✓ '}{mp.betfair_home} vs {mp.betfair_away}
                              {mp.match_source === 'db_time_mismatch' && <span style={{ marginLeft: 6, fontSize: 10 }}>(čas nesedí — over manuálne)</span>}
                            </div>
                          : <div style={{ fontSize: 11, color: 'var(--yellow)', marginTop: 2 }}>{mp.betfair_home ? `⚠ Návrh: ${mp.betfair_home} vs ${mp.betfair_away}` : '❌ Nenájdené na Betfaire'}</div>
                        }
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {mp.betfair_home && !mp.confirmed && (
                          <button className="btn-green" onClick={() => confirmMapping(mp.id, mp.betfair_event_id, mp.betfair_home, mp.betfair_away, mp.footystats_home, mp.footystats_away)}>
                            ✓ Potvrdiť
                          </button>
                        )}
                        <button className="btn-yellow" onClick={() => {
                          if (betfairEvents.length === 0) loadBetfairEvents()
                          setChangingMapping(prev => ({ ...prev, [mp.id]: !prev[mp.id] }))
                          setMappingSearch(prev => ({ ...prev, [mp.id]: '' }))
                        }}>
                          {isChangingThis ? '✕' : '✏ Zmeniť'}
                        </button>
                        <button className="btn-danger" onClick={() => deleteMapping(mp.id)}>✕</button>
                      </div>
                    </div>
                    {isChangingThis && (
                      <SearchDropdown
                        searchKey={mp.id}
                        onSelect={async ev => {
                          await confirmMapping(mp.id, ev.id, ev.home?.name, ev.away?.name, mp.footystats_home, mp.footystats_away)
                        }}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── DATABÁZA TÍMOV ── */}
        {tab === 'teamdb' && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text2)', marginBottom: 6 }}>🗄 Perzistentná databáza názvov tímov</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.8 }}>
                Každý raz keď potvrdíš mapping, tímy sa automaticky uložia sem.<br />
                Pri ďalšom výskyte rovnakého tímu ho systém nájde na Betfaire okamžite — bez fuzzy hľadania.<br />
                <span style={{ color: 'var(--accent2)' }}>Príklad: "Pohronie" → "FC PUKov" — raz nastavené, navždy funguje.</span>
              </div>
            </div>

            {teamNameDb.length === 0 && (
              <div className="empty">Databáza je prázdna.<br />Potvrdzuj mappingy — tímy sa budú pridávať automaticky.</div>
            )}

            {teamNameDb.length > 0 && (
              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ padding: '8px 14px', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>FootyStats názov</div>
                  <div style={{ padding: '8px 14px', fontSize: 10, color: 'var(--text3)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Betfair názov</div>
                  <div style={{ padding: '8px 14px' }}></div>
                </div>
                {teamNameDb.map(t => (
                  <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
                    <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--text2)' }}>{t.footystats_name}</div>
                    <div style={{ padding: '10px 14px', fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>→ {t.betfair_name}</div>
                    <div style={{ padding: '8px 10px' }}>
                      <button className="btn-danger" style={{ padding: '3px 8px', fontSize: 10 }} onClick={() => deleteTeamName(t.id)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── ADD MATCH ── */}
        {tab === 'add' && <AddMatchForm onSaved={() => { loadData(); setTab('dashboard') }} />}

      </div>
    </>
  )
}

function AddMatchForm({ onSaved }) {
  const [form, setForm] = useState({
    home_name: '', away_name: '', league: '', kick_off: '',
    lambda_h: '', lambda_a: '',
    fer_over25: '', fer_under25: '', fer_over30: '', fer_under30: '',
    p_over25: '', p_under25: '', p_over30: '', p_under30: '',
    xg_scaler: '0.90', shrinkage: '0.15',
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.home_name || !form.away_name) return
    setSaving(true)
    const today = new Date().toISOString().slice(0, 10)
    await supabase.from('watched_matches').insert({
      match_date: today,
      home_name: form.home_name.trim(), away_name: form.away_name.trim(),
      league: form.league || null,
      kick_off: form.kick_off ? new Date(form.kick_off).toISOString() : null,
      lambda_h: pf(form.lambda_h) || null, lambda_a: pf(form.lambda_a) || null,
      fer_over25: pf(form.fer_over25) || null, fer_under25: pf(form.fer_under25) || null,
      fer_over30: pf(form.fer_over30) || null, fer_under30: pf(form.fer_under30) || null,
      p_over25: pf(form.p_over25) || null, p_under25: pf(form.p_under25) || null,
      p_over30: pf(form.p_over30) || null, p_under30: pf(form.p_under30) || null,
      xg_scaler: pf(form.xg_scaler) || 0.90, shrinkage: pf(form.shrinkage) || 0.15,
    })
    setSaving(false)
    onSaved()
  }

  return (
    <div className="card">
      <div className="section-title" style={{ marginBottom: 14 }}>Pridať sledovaný zápas</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="grid2">
          <div><div className="label">Home tím</div><input className="inp" placeholder="napr. Gokulam FC" value={form.home_name} onChange={e => set('home_name', e.target.value)} /></div>
          <div><div className="label">Away tím</div><input className="inp" placeholder="napr. Shillong Lajong" value={form.away_name} onChange={e => set('away_name', e.target.value)} /></div>
        </div>
        <div className="grid2">
          <div><div className="label">Liga</div><input className="inp" placeholder="napr. I-League" value={form.league} onChange={e => set('league', e.target.value)} /></div>
          <div><div className="label">Čas výkopu</div><input className="inp" type="datetime-local" value={form.kick_off} onChange={e => set('kick_off', e.target.value)} style={{ colorScheme: 'dark' }} /></div>
        </div>
        <div className="grid2">
          <div><div className="label">λ Home</div><input className="inp inp-sm" placeholder="1.45" value={form.lambda_h} onChange={e => set('lambda_h', e.target.value)} /></div>
          <div><div className="label">λ Away</div><input className="inp inp-sm" placeholder="0.98" value={form.lambda_a} onChange={e => set('lambda_a', e.target.value)} /></div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>FER kurzy</div>
        <div className="grid4">
          <div><div className="label">FER O 2.5</div><input className="inp inp-sm" placeholder="1.85" value={form.fer_over25} onChange={e => set('fer_over25', e.target.value)} /></div>
          <div><div className="label">FER U 2.5</div><input className="inp inp-sm" placeholder="2.10" value={form.fer_under25} onChange={e => set('fer_under25', e.target.value)} /></div>
          <div><div className="label">FER O 3.0</div><input className="inp inp-sm" placeholder="2.50" value={form.fer_over30} onChange={e => set('fer_over30', e.target.value)} /></div>
          <div><div className="label">FER U 3.0</div><input className="inp inp-sm" placeholder="1.60" value={form.fer_under30} onChange={e => set('fer_under30', e.target.value)} /></div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)' }}>Pravdepodobnosti (0-1)</div>
        <div className="grid4">
          <div><div className="label">P Over 2.5</div><input className="inp inp-sm" placeholder="0.54" value={form.p_over25} onChange={e => set('p_over25', e.target.value)} /></div>
          <div><div className="label">P Under 2.5</div><input className="inp inp-sm" placeholder="0.46" value={form.p_under25} onChange={e => set('p_under25', e.target.value)} /></div>
          <div><div className="label">P Over 3.0</div><input className="inp inp-sm" placeholder="0.33" value={form.p_over30} onChange={e => set('p_over30', e.target.value)} /></div>
          <div><div className="label">P Under 3.0</div><input className="inp inp-sm" placeholder="0.50" value={form.p_under30} onChange={e => set('p_under30', e.target.value)} /></div>
        </div>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving} style={{ marginTop: 6 }}>
          {saving ? '⏳ Ukladám...' : '💾 Uložiť zápas'}
        </button>
      </div>
    </div>
  )
}
