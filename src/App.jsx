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

const css = `
  * { box-sizing: border-box; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 20px 16px 60px; }
  .header { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 14px 24px; display: flex; align-items: center; gap: 12px; position: sticky; top: 0; z-index: 10; }
  .logo { font-weight: 800; font-size: 17px; letter-spacing: -0.02em; color: var(--accent2); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px var(--green); flex-shrink: 0; }
  .tabs { border-bottom: 1px solid var(--border); padding: 0 24px; display: flex; gap: 2px; background: var(--bg2); }
  .tab { cursor: pointer; padding: 10px 18px; border: none; background: transparent; font-family: var(--mono); font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text3); transition: all 0.2s; border-bottom: 2px solid transparent; }
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
  .btn-danger { cursor: pointer; background: transparent; border: 1px solid rgba(214,48,49,0.3); color: var(--red); font-family: var(--mono); font-size: 11px; padding: 6px 10px; border-radius: 4px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .grid3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
  .grid4 { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; }
  .pos { color: var(--green); }
  .neg { color: var(--red); }
  .badge { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 3px; font-weight: 600; }
  .badge-value { background: rgba(0,184,148,0.15); color: var(--green); }
  .badge-no-value { background: rgba(214,48,49,0.1); color: var(--red); }
  .badge-pending { background: rgba(253,203,110,0.15); color: var(--yellow); }
  .badge-no-match { background: rgba(107,112,148,0.15); color: var(--text3); }
  .match-row { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin-bottom: 8px; }
  .match-row.has-value { border-color: rgba(0,184,148,0.4); background: rgba(0,184,148,0.04); }
  .match-row.no-match { opacity: 0.7; }
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
  .mapping-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--border); font-size: 12px; }
  .mapping-row:last-child { border-bottom: none; }
  .pulse { animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.5 } }
`

export default function App() {
  const [tab, setTab] = useState('dashboard')
  const [matches, setMatches] = useState([])
  const [mappings, setMappings] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [betfairEvents, setBetfairEvents] = useState([])
  const [loadingBetfair, setLoadingBetfair] = useState(false)
  const [mappingSearch, setMappingSearch] = useState({})

  const today = new Date().toISOString().slice(0, 10)

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    const [{ data: m }, { data: mp }] = await Promise.all([
      supabase.from('watched_matches').select('*, odds_snapshots(*)').eq('match_date', today).eq('status', 'active').order('kick_off'),
      supabase.from('team_mapping').select('*').order('created_at', { ascending: false }),
    ])
    setMatches(m || [])
    setMappings(mp || [])
    setLoading(false)
  }

  async function loadBetfairEvents() {
    setLoadingBetfair(true)
    try {
      let events = []
      let page = 1
      while (page <= 12) {
        const res = await fetch(`/api/betsapi?endpoint=betfair/ex/upcoming&sport_id=1&page=${page}`)
        const json = await res.json()
        if (json?.results) events = events.concat(json.results)
        if (!json?.pager?.next_page) break
        page++
      }
      setBetfairEvents(events)
    } catch (e) { console.error(e) }
    setLoadingBetfair(false)
  }

  async function autoMatch() {
    if (betfairEvents.length === 0) await loadBetfairEvents()
    setRefreshing(true)

    for (const match of matches) {
      // Skip if already mapped
      const existing = mappings.find(m => m.footystats_home === match.home_name && m.footystats_away === match.away_name)
      if (existing) continue

      // Try fuzzy match
      let best = null, bestScore = 0
      for (const ev of betfairEvents) {
        const sh = fuzzyScore(match.home_name, ev.home?.name || '')
        const sa = fuzzyScore(match.away_name, ev.away?.name || '')
        const total = (sh + sa) / 2
        if (total > bestScore && total > 0.3) { bestScore = total; best = ev }
      }

      if (best) {
        await supabase.from('team_mapping').upsert({
          footystats_home: match.home_name,
          footystats_away: match.away_name,
          betfair_event_id: best.id,
          betfair_home: best.home?.name,
          betfair_away: best.away?.name,
          confirmed: bestScore >= 0.7, // auto-confirm high confidence
        }, { onConflict: 'footystats_home,footystats_away' })
      } else {
        // Insert unmatched so user can fix manually
        await supabase.from('team_mapping').upsert({
          footystats_home: match.home_name,
          footystats_away: match.away_name,
          betfair_event_id: null,
          betfair_home: null,
          betfair_away: null,
          confirmed: false,
        }, { onConflict: 'footystats_home,footystats_away' })
      }
    }

    await loadData()
    setRefreshing(false)
  }

  async function refreshOdds() {
    setRefreshing(true)
    for (const match of matches) {
      const mapping = mappings.find(m => m.footystats_home === match.home_name && m.footystats_away === match.away_name && m.confirmed && m.betfair_event_id)
      if (!mapping) continue

      try {
        const res = await fetch(`/api/betsapi?endpoint=betfair/ex/event&event_id=${mapping.betfair_event_id}`)
        const json = await res.json()
        const mkts = json?.results?.[0]?.markets
        if (!mkts) continue

        const getBack = (mkt, side) => {
          if (!mkt) return null
          for (const r of mkt.runners || []) {
            if (r.description?.runnerName?.toLowerCase().includes(side))
              return r.exchange?.availableToBack?.[0]?.price || null
          }
          return null
        }

        const ou25 = mkts.find(m => m.description?.marketName === 'Over/Under 2.5 Goals')
        const ou30 = mkts.find(m => m.description?.marketName === 'Over/Under 3.0 Goals')
          || mkts.find(m => m.description?.marketName === 'Over/Under 3.5 Goals')

        const bo25 = getBack(ou25, 'over')
        const bu25 = getBack(ou25, 'under')
        const bo30 = getBack(ou30, 'over')
        const bu30 = getBack(ou30, 'under')
        const comm = 0.05

        const ev25 = bo25 ? calcBackEV(match.p_over25, bo25, comm) : null
        const evu25 = bu25 ? calcBackEV(match.p_under25, bu25, comm) : null
        const ev30 = bo30 ? calcBackEV(match.p_over30, bo30, comm) : null
        const evu30 = bu30 ? calcBackEV(match.p_under30, bu30, comm) : null
        const hasValue = [ev25, evu25, ev30, evu30].some(ev => ev != null && ev > 0.05)

        await supabase.from('odds_snapshots').insert({
          watched_match_id: match.id,
          betfair_event_id: mapping.betfair_event_id,
          back_over25: bo25, back_under25: bu25,
          back_over30: bo30, back_under30: bu30,
          ev_over25: ev25 != null ? ev25 * 100 : null,
          ev_under25: evu25 != null ? evu25 * 100 : null,
          ev_over30: ev30 != null ? ev30 * 100 : null,
          ev_under30: evu30 != null ? evu30 * 100 : null,
          value_found: hasValue,
        })
      } catch (e) { console.error(e) }
    }
    await loadData()
    setRefreshing(false)
  }

  async function confirmMapping(mappingId, betfairEventId, betfairHome, betfairAway) {
    await supabase.from('team_mapping').update({
      betfair_event_id: betfairEventId,
      betfair_home: betfairHome,
      betfair_away: betfairAway,
      confirmed: true,
    }).eq('id', mappingId)
    await loadData()
  }

  async function deleteMatch(id) {
    await supabase.from('watched_matches').update({ status: 'expired' }).eq('id', id)
    await loadData()
  }

  // Get latest snapshot for each match
  function getLatestSnapshot(match) {
    const snaps = match.odds_snapshots || []
    if (!snaps.length) return null
    return snaps.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
  }

  const unmappedCount = matches.filter(m => {
    const mp = mappings.find(x => x.footystats_home === m.home_name && x.footystats_away === m.away_name)
    return !mp || !mp.confirmed
  }).length

  const valueCount = matches.filter(m => {
    const snap = getLatestSnapshot(m)
    return snap?.value_found
  }).length

  return (
    <>
      <style>{css}</style>
      <div className="header">
        <div className="dot" />
        <span className="logo">VALUE TRACKER</span>
        <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 4 }}>Betfair Exchange Monitor</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {valueCount > 0 && (
            <span className="pulse" style={{ fontSize: 12, color: 'var(--green)', fontWeight: 700 }}>
              ⚡ {valueCount} VALUE
            </span>
          )}
          <span style={{ fontSize: 11, color: 'var(--text3)' }}>{matches.length} sledovaných</span>
        </div>
      </div>

      <div className="tabs">
        {[['dashboard', `Dashboard (${matches.length})`], ['mapping', `Mapping (${unmappedCount} neopravených)`], ['add', '+ Pridať zápas']].map(([id, lbl]) => (
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
              <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 4 }}>
                Posledný refresh: {new Date().toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {loading && <div className="loading">Načítavam...</div>}
            {!loading && matches.length === 0 && (
              <div className="empty">
                Žiadne sledované zápasy na dnes.<br />
                Klikni "+ Pridať zápas" alebo použij xg-calc.<br />
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  (V xg-calc skeneri bude tlačidlo "👁 Sledovať")
                </span>
              </div>
            )}

            {matches.map(match => {
              const mapping = mappings.find(m => m.footystats_home === match.home_name && m.footystats_away === match.away_name)
              const snap = getLatestSnapshot(match)
              const hasValue = snap?.value_found
              const isConfirmed = mapping?.confirmed

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
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                        λ {fmt2(match.lambda_h)} / {fmt2(match.lambda_a)}
                        {match.kick_off && <span style={{ marginLeft: 8, color: 'var(--yellow)' }}>
                          ⏰ {new Date(match.kick_off).toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' })}
                        </span>}
                        {isConfirmed && mapping?.betfair_home && (
                          <span style={{ marginLeft: 8, color: 'var(--green)', fontSize: 10 }}>
                            ✓ {mapping.betfair_home} vs {mapping.betfair_away}
                          </span>
                        )}
                      </div>
                    </div>
                    <button className="btn-danger" onClick={() => deleteMatch(match.id)}>✕</button>
                  </div>

                  {/* Odds grid */}
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
                          {evVal != null && (
                            <span className={`ev-pill ${evVal > 5 ? 'ev-pos' : evVal > 0 ? 'ev-zero' : 'ev-neg'}`}>
                              EV {fmtEV(evVal)}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {snap && (
                    <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 8, textAlign: 'right' }}>
                      Kurzy z {new Date(snap.created_at).toLocaleTimeString('sk', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* ── MAPPING ── */}
        {tab === 'mapping' && (
          <div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
              <button className="btn btn-primary" onClick={autoMatch} disabled={loadingBetfair || refreshing}>
                {loadingBetfair ? '⏳ Načítavam Betfair...' : refreshing ? '⏳ Matchujem...' : '🤖 Auto-match všetky'}
              </button>
              <button className="btn-ghost" onClick={loadBetfairEvents} disabled={loadingBetfair}>
                {loadingBetfair ? '⏳' : '📡 Načítať Betfair eventy'}
              </button>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{betfairEvents.length} Betfair eventov načítaných</span>
            </div>

            {mappings.length === 0 && <div className="empty">Žiadne mappingy. Najprv pridaj zápasy a spusti Auto-match.</div>}

            <div className="card" style={{ padding: 0 }}>
              {mappings.map(mp => {
                const searchResults = (mappingSearch[mp.id] || '').length > 1
                  ? betfairEvents.filter(ev =>
                      ev.home?.name?.toLowerCase().includes(mappingSearch[mp.id].toLowerCase()) ||
                      ev.away?.name?.toLowerCase().includes(mappingSearch[mp.id].toLowerCase())
                    ).slice(0, 8)
                  : []

                return (
                  <div key={mp.id} className="mapping-row">
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                        {mp.footystats_home} vs {mp.footystats_away}
                      </div>
                      {mp.confirmed && mp.betfair_home && (
                        <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>
                          ✓ {mp.betfair_home} vs {mp.betfair_away}
                        </div>
                      )}
                      {!mp.confirmed && (
                        <div style={{ fontSize: 11, color: 'var(--yellow)', marginTop: 2 }}>
                          {mp.betfair_home
                            ? `⚠ Návrh: ${mp.betfair_home} vs ${mp.betfair_away}`
                            : '❌ Nenájdené na Betfaire'}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {mp.betfair_home && !mp.confirmed && (
                        <button className="btn-green" onClick={() => confirmMapping(mp.id, mp.betfair_event_id, mp.betfair_home, mp.betfair_away)}>
                          ✓ Potvrdiť
                        </button>
                      )}

                      {/* Manual search */}
                      <div style={{ position: 'relative' }}>
                        <input
                          className="inp inp-sm"
                          style={{ width: 180 }}
                          placeholder="Hľadaj na Betfaire..."
                          value={mappingSearch[mp.id] || ''}
                          onChange={e => setMappingSearch(prev => ({ ...prev, [mp.id]: e.target.value }))}
                        />
                        {searchResults.length > 0 && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 50, maxHeight: 200, overflowY: 'auto' }}>
                            {searchResults.map(ev => (
                              <div key={ev.id}
                                style={{ padding: '7px 10px', cursor: 'pointer', fontSize: 11, borderBottom: '1px solid var(--border)' }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg2)'}
                                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                onClick={async () => {
                                  await confirmMapping(mp.id, ev.id, ev.home?.name, ev.away?.name)
                                  setMappingSearch(prev => ({ ...prev, [mp.id]: '' }))
                                }}
                              >
                                <b>{ev.home?.name}</b> vs {ev.away?.name}
                                <span style={{ color: 'var(--text3)', marginLeft: 6, fontSize: 10 }}>{ev.league?.name || ''}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {mp.confirmed && (
                        <span style={{ fontSize: 10, color: 'var(--green)' }}>✓ OK</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
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
      home_name: form.home_name.trim(),
      away_name: form.away_name.trim(),
      league: form.league || null,
      kick_off: form.kick_off ? new Date(form.kick_off).toISOString() : null,
      lambda_h: pf(form.lambda_h) || null,
      lambda_a: pf(form.lambda_a) || null,
      fer_over25: pf(form.fer_over25) || null,
      fer_under25: pf(form.fer_under25) || null,
      fer_over30: pf(form.fer_over30) || null,
      fer_under30: pf(form.fer_under30) || null,
      p_over25: pf(form.p_over25) || null,
      p_under25: pf(form.p_under25) || null,
      p_over30: pf(form.p_over30) || null,
      p_under30: pf(form.p_under30) || null,
      xg_scaler: pf(form.xg_scaler) || 0.90,
      shrinkage: pf(form.shrinkage) || 0.15,
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
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>FER kurzy</div>
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
