const BASE = 'https://api.railradar.in';

async function request(path, options = {}) {
  const key = process.env.RAILRADAR_API_KEY;
  if (!key) throw new Error('RailRadar fallback is not configured.');
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${key}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(3500)
  });
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error(`RailRadar returned invalid JSON (HTTP ${response.status}).`); }
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error?.message || payload?.message || `RailRadar HTTP ${response.status}`);
  }
  return payload;
}

const normalise = value => String(value || '').toLowerCase()
  .replace(/\b(junction|jn\.?|railway station)\b/g, '')
  .replace(/[^a-z0-9]/g, '');

async function resolveStation(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Enter both origin and destination stations.');
  const payload = await request(`/v1/lookup/search/stations?q=${encodeURIComponent(raw)}&limit=10`);
  const matches = Array.isArray(payload?.data) ? payload.data : [];
  if (!matches.length) throw new Error(`RailRadar could not find station "${raw}". Try its station code.`);
  const exact = matches.find(item =>
    String(item.code || '').toUpperCase() === raw.toUpperCase() ||
    normalise(item.name) === normalise(raw)
  );
  if (exact) return exact;
  const top = matches[0];
  const second = matches[1];
  if (top?.code && Number(top.popularity || 0) >= 10 &&
      (!second || Number(top.popularity || 0) >= Number(second.popularity || 0) * 3)) return top;
  throw new Error(`Station "${raw}" is ambiguous. Use a station code. Matches: ${matches.slice(0, 5).map(x => `${x.name} (${x.code})`).join(', ')}`);
}

function toMinutes(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || ''));
  if (!match) return null;
  const h = Number(match[1]), m = Number(match[2]);
  return h <= 23 && m <= 59 ? h * 60 + m : null;
}

function dayDifference(fromDate, toDate) {
  if (!fromDate || !toDate) return 0;
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : 0;
}

function normaliseLeg(leg) {
  const dep = toMinutes(leg?.from?.departure);
  const arr = toMinutes(leg?.to?.arrival);
  const depDay = leg?.from?.date ? dayDifference(leg.from.date, leg?.from?.date) : Math.max(0, Number(leg?.from?.day || 1) - 1);
  const arrDay = leg?.to?.date && leg?.from?.date
    ? Math.max(depDay, dayDifference(leg.from.date, leg.to.date))
    : Math.max(depDay, Number(leg?.to?.day || 1) - 1);
  return {
    trainNo: String(leg?.train?.number || ''),
    name: String(leg?.train?.name || ''),
    from: String(leg?.from?.code || ''),
    to: String(leg?.to?.code || ''),
    fromName: String(leg?.from?.name || leg?.from?.code || ''),
    toName: String(leg?.to?.name || leg?.to?.code || ''),
    departureTime: String(leg?.from?.departure || ''),
    arrivalTime: String(leg?.to?.arrival || ''),
    departureMinutes: dep,
    departureDayOffset: depDay,
    arrivalMinutes: arr,
    arrivalDayOffset: arrDay,
    durationMinutes: Number.isFinite(Number(leg?.durationMinutes)) ? Number(leg.durationMinutes) : null,
    classes: Array.isArray(leg?.train?.classes) ? [...new Set(leg.train.classes.map(x => String(x).toUpperCase()))] : [],
    runningDays: Array.isArray(leg?.train?.runDays) ? leg.train.runDays : [],
    source: 'RailRadar'
  };
}

function routeFromLegs(legs, via) {
  const segments = legs.map(normaliseLeg);
  if (!segments.length || segments.some(s => !s.trainNo || !s.from || !s.to || s.departureMinutes == null || s.arrivalMinutes == null || !s.classes.length)) return null;
  return { train: segments.length === 1 ? segments[0] : null, segments, via: via || (segments.length > 1 ? segments[0].to : null), interchangeMinutes: null, source: 'RailRadar' };
}


async function checkSeatAvailability(segment, journeyDate, classCode) {
  const params = new URLSearchParams({
    source: segment.from,
    destination: segment.to,
    journeyDate,
    classCode,
    quotaCode: process.env.RAILRADAR_QUOTA || 'GN'
  });
  const payload = await request(`/v1/trains/${encodeURIComponent(segment.trainNo)}/seats?${params.toString()}`);
  const data = payload?.data || {};
  const row = (data.calendar || []).find(item => String(item.date || item.rawDate) === journeyDate);
  if (!row) return { status: 'UNVERIFIED', reason: 'RailRadar did not return availability for the requested journey date.', fetchedAt: payload?.meta?.timestamp || null };
  const providerStatus = String(row.statusCode || row.status || 'UNKNOWN').toUpperCase();
  return {
    status: providerStatus,
    availabilityText: row.status || providerStatus,
    availableCount: Number.isFinite(Number(row.availableSeats)) ? Number(row.availableSeats) : null,
    waitlistNumber: Number.isFinite(Number(row.waitlistNumber)) ? Number(row.waitlistNumber) : null,
    waitlistType: row.waitlistType || null,
    isAvailable: row.isAvailable === true || providerStatus === 'AVAILABLE',
    fetchedAt: payload?.meta?.timestamp || null,
    source: payload?.meta?.source || 'RailRadar external aggregation'
  };
}

async function addRailRadarAvailability(routes, date, travelClass) {
  const checks = [];
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const route = routes[routeIndex];
    const sets = route.segments.map(segment => new Set(segment.classes || []));
    const common = [...(sets[0] || [])].filter(cls => sets.every(set => set.has(cls)));
    const classes = common.filter(cls => travelClass === 'ALL' || cls === travelClass);
    for (const cls of classes) checks.push({ routeIndex, cls });
  }

  // Keep the serverless request bounded. Unchecked combinations are explicitly
  // labelled, never inferred as unavailable or confirmed.
  const configuredChecks = Number.parseInt(process.env.RAILRADAR_AVAILABILITY_LIMIT || '4', 10);
  // Keep the secondary provider bounded so a combined search cannot exceed
  // the serverless execution window. Raise deliberately only after load testing.
  const maxChecks = Number.isFinite(configuredChecks)
    ? Math.max(1, Math.min(8, configuredChecks))
    : 4;
  const selected = checks.slice(0, maxChecks);
  const byRoute = routes.map(() => []);
  let cursor = 0;
  const workers = Array.from({ length: 8 }, async () => {
    while (cursor < selected.length) {
      const check = selected[cursor++];
      const route = routes[check.routeIndex];
      const legs = await Promise.all(route.segments.map(segment =>
        checkSeatAvailability(segment, date, check.cls).catch(error => ({
          status: 'ERROR',
          reason: error?.message || 'RailRadar seat availability request failed.',
          fetchedAt: null
        }))
      ));
      const timestamps = legs.map(item => item.fetchedAt).filter(Boolean);
      const newest = timestamps.length ? timestamps.map(Date.parse).filter(Number.isFinite).sort((a,b)=>b-a)[0] : NaN;
      const ageMinutes = Number.isFinite(newest) ? Math.max(0, (Date.now() - newest) / 60000) : null;
      const freshness = ageMinutes == null ? 'UNKNOWN' : ageMinutes > 15 ? 'STALE' : 'FRESH';
      const allAvailable = legs.length === route.segments.length && legs.every(item => item.isAvailable === true);
      const hasError = legs.some(item => item.status === 'ERROR');
      const result = allAvailable && freshness === 'FRESH'
        ? [{
            segments: legs.map(item => ({ status: 'CONFIRMED' })),
            availabilityText: legs.map(item => item.availabilityText).join(' + '),
            availableCount: legs.length === 1 ? legs[0].availableCount : null,
            fare: null
          }]
        : [];
      const reasons = legs.map((item, i) => `${route.segments[i].trainNo}: ${item.reason || item.availabilityText || item.status}`);
      byRoute[check.routeIndex].push({
        class: check.cls,
        status: hasError ? 'ERROR' : 'OK',
        results: result,
        providerStatus: allAvailable ? 'AVAILABLE' : legs.map(item => item.status).join(' / '),
        freshness,
        freshnessAgeMinutes: ageMinutes == null ? null : Math.ceil(ageMinutes),
        freshnessThresholdMinutes: 15,
        fetchedAt: timestamps.sort().at(-1) || null,
        source: 'RailRadar',
        reason: result.length ? null : (freshness !== 'FRESH'
          ? 'Availability timestamp is missing or older than 15 minutes; not treated as confirmed.'
          : reasons.join('; '))
      });
    }
  });
  await Promise.all(workers);

  const finalRoutes = routes.map((route, index) => {
    const checked = byRoute[index];
    const sets = route.segments.map(segment => new Set(segment.classes || []));
    const common = [...(sets[0] || [])].filter(cls => sets.every(set => set.has(cls)) && (travelClass === 'ALL' || cls === travelClass));
    const checkedClasses = new Set(checked.map(item => item.class));
    for (const cls of common) {
      if (!checkedClasses.has(cls)) checked.push({
        class: cls,
        status: 'UNAVAILABLE',
        results: [],
        reason: `Not checked in this search to respect the configured request budget (limit ${maxChecks}).`
      });
    }
    return { ...route, availability: checked };
  });
  return finalRoutes;
}

export async function searchRailRadarJourney(fromInput, toInput, date, travelClass = 'ALL', routeType = 'ALL') {
  const [from, to] = await Promise.all([resolveStation(fromInput), resolveStation(toInput)]);
  if (from.code === to.code) throw new Error('Origin and destination must be different stations.');
  const maxTransfers = routeType === 'DIRECT' ? 0 : 2;
  const minTransfers = routeType === 'VIA' ? 1 : 0;
  const payload = await request('/v1/journeys/plan', {
    method: 'POST',
    body: JSON.stringify({
      stops: [from.code, to.code],
      date,
      minTransfers,
      maxTransfers,
      minTransferMinutes: 30,
      maxWaitMinutes: 1440,
      maxItineraries: 50,
      windowHours: 24,
      rolling24h: false,
      byCity: false
    })
  });
  const plan = payload?.data?.segments?.[0]?.plan || payload?.data?.plan || {};
  const candidates = [];
  for (const item of (plan.direct || [])) candidates.push(routeFromLegs([item], null));
  for (const item of (plan.itineraries || [])) candidates.push(routeFromLegs(item.legs || [], item.legs?.[0]?.to?.code));
  for (const route of (plan.routes || [])) {
    for (const item of (route.itineraries || [])) candidates.push(routeFromLegs(item.legs || [], route.via?.join(', ') || item.legs?.[0]?.to?.code));
  }
  const seen = new Set();
  const routes = candidates.filter(Boolean).filter(route => {
    const count = route.segments.length;
    if (routeType === 'DIRECT' && count !== 1) return false;
    if (routeType === 'VIA' && count < 2) return false;
    const classSets = route.segments.map(s => new Set(s.classes));
    const common = [...(classSets[0] || [])].filter(cls => classSets.every(set => set.has(cls)));
    if (!common.length || (travelClass !== 'ALL' && !common.includes(travelClass))) return false;
    const key = route.segments.map(s => `${s.trainNo}:${s.from}:${s.to}:${s.departureTime}`).join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const routesWithAvailability = await addRailRadarAvailability(routes, date, travelClass);
  return {
    from: from.code,
    to: to.code,
    results: routesWithAvailability,
    source: 'RailRadar',
    providerCheckedAt: payload?.meta?.timestamp || new Date().toISOString(),
    availabilityChecked: routesWithAvailability.reduce((sum, route) => sum + route.availability.filter(item => item.source === 'RailRadar').length, 0),
    availabilityCreditsRequested: routesWithAvailability.reduce((sum, route) => sum + route.availability.filter(item => item.source === 'RailRadar').length * route.segments.length, 0),
    availabilityLimit: Number.isFinite(Number.parseInt(process.env.RAILRADAR_AVAILABILITY_LIMIT || '4', 10))
      ? Math.max(1, Math.min(8, Number.parseInt(process.env.RAILRADAR_AVAILABILITY_LIMIT || '4', 10)))
      : 4,
    sourceNote: 'RailRadar is an independent third-party timetable and route-data provider, not Indian Railways or IRCTC. Its route planner supplies direct and connecting train schedules. Seat availability is queried for each checked train/class/leg using RailRadar's documented seat endpoint. Only fresh AVAILABLE results across every leg are marked confirmed; RAC, waitlist, stale, failed and budget-skipped checks are not confirmed. RailRadar describes this seat data as an external aggregation, not authoritative; verify critical details on IRCTC.'
  };
}

export function isRailRadarConfigured() {
  return Boolean(process.env.RAILRADAR_API_KEY);
}
