export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const { endpoint, ...params } = req.query
  const token = process.env.BETSAPI_TOKEN

  const allowedEndpoints = [
    'betfair/ex/upcoming',
    'betfair/ex/event',
    'betfair/upcoming',
    'betfair/event',
  ]

  if (!allowedEndpoints.includes(endpoint)) {
    return res.status(400).json({ error: 'Endpoint not allowed' })
  }

  const qs = new URLSearchParams({ token, ...params }).toString()
  const url = `https://api.betsapi.com/v2/${endpoint}?${qs}`

  try {
    const r = await fetch(url)
    const data = await r.json()
    res.setHeader('Cache-Control', 's-maxage=60')
    return res.status(200).json(data)
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
