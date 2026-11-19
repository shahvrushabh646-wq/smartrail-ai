import { isRailCoreConfigured } from '../server/railcore.js';
import { isRailRadarConfigured } from '../server/railradar.js';
import { isIrctcDevConfigured } from '../server/irctcdev.js';

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'Method not allowed. Use GET.' });
  }
  const railCoreConfigured = isRailCoreConfigured();
  const railRadarConfigured = isRailRadarConfigured();
  const customAvailabilityConfigured = Boolean(process.env.RAIL_AVAILABILITY_URL && process.env.RAIL_API_KEY);
  const irctcDevConfigured = isIrctcDevConfigured();
  return res.status(200).json({
    ok: true,
    service: 'SmartRail AI',
    apiVersion: '1',
    scheduleProviderConfigured: railCoreConfigured,
    backupScheduleProviderConfigured: railRadarConfigured,
    customAvailabilityProviderConfigured: customAvailabilityConfigured,
    irctcDevConfigured,
    anyProviderConfigured: railCoreConfigured || railRadarConfigured || customAvailabilityConfigured || irctcDevConfigured,
    checkedAt: new Date().toISOString()
  });
}
