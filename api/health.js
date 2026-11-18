import { isRailCoreConfigured } from '../server/railcore.js';

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).json({
    ok: true,
    service: 'SmartRail AI',
    scheduleProviderConfigured: isRailCoreConfigured(),
    customAvailabilityProviderConfigured: Boolean(process.env.RAIL_AVAILABILITY_URL && process.env.RAIL_API_KEY)
  });
}
