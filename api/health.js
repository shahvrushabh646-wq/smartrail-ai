export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'Method not allowed. Use GET.' });
  }
  return res.status(200).json({
    ok: true,
    service: 'SmartRail AI',
    apiVersion: '1',
    dataMode: 'local timetable + Chrome browser bridge',
    serverSideProvidersEnabled: false,
    deployment: {
      environment: process.env.VERCEL_ENV || 'unknown',
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      url: process.env.VERCEL_URL || null
    },
    checkedAt: new Date().toISOString()
  });
}
