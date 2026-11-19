export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  return res.status(200).json({
    ok: true,
    service: 'SmartRail AI',
    endpoint: 'api-ping',
    runtime: 'nodejs',
    checkedAt: new Date().toISOString()
  });
}
