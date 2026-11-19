import { loadLocalTimetable, getTimetableDiagnostics } from '../server/localTimetable.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ ok: false, error: 'Method not allowed. Use GET.' });
  }

  // Keep health checks independent from provider adapters. A provider module
  // import/runtime error must not make the API health endpoint itself fail.
  const railCoreConfigured = Boolean(process.env.RAILCORE_KEY);
  const railRadarConfigured = Boolean(process.env.RAILRADAR_API_KEY);
  const customAvailabilityConfigured = Boolean(
    process.env.RAIL_AVAILABILITY_URL && process.env.RAIL_API_KEY
  );
  const irctcDevConfigured = Boolean(
    process.env.IRCTC_API_KEY && process.env.SMARTRAIL_PERSONAL_ACCESS_CODE
  );

  let timetableMeta = {
    recordCount: 0,
    valid: false,
    source: null,
    lastUpdated: null,
    stationCount: 0
  };
  try {
    const db = await loadLocalTimetable();
    timetableMeta = getTimetableDiagnostics(db);
  } catch {
    // Health must still return 200 even if the timetable file is broken.
  }

  const localSearchReady = Boolean(timetableMeta.valid && timetableMeta.recordCount > 0);

  return res.status(200).json({
    ok: true,
    service: 'SmartRail AI',
    apiVersion: '1',
    scheduleProviderConfigured: railCoreConfigured,
    backupScheduleProviderConfigured: railRadarConfigured,
    customAvailabilityProviderConfigured: customAvailabilityConfigured,
    irctcDevConfigured,
    localTimetableReady: localSearchReady,
    anyProviderConfigured: railCoreConfigured || railRadarConfigured ||
      customAvailabilityConfigured || irctcDevConfigured || localSearchReady,
    timetable: timetableMeta,
    featuresWithoutApiKeys: {
      localDirectSearch: localSearchReady,
      localConnectingRoutes: localSearchReady,
      localClassFiltering: localSearchReady,
      liveSeatAvailability: false
    },
    featuresRequiringAuthorisedKeys: {
      liveSeatAvailability: true,
      providerDirectSchedules: true,
      providerConnectingRoutes: true
    },
    deployment: {
      environment: process.env.VERCEL_ENV || 'unknown',
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      url: process.env.VERCEL_URL || null
    },
    availability: {
      defaultTrainLimit: 'ALL',
      configuredTrainLimit: process.env.RAILCORE_AVAILABILITY_LIMIT || 'ALL'
    },
    checkedAt: new Date().toISOString()
  });
}
