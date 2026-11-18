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
    signal: AbortSignal.timeout(6000)
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
  .replace(/\\b(junction|jn\\.?|railway station)\\b/g, '')
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
  const match = /^(\\d{1,2}):(\\d{2})$/.exec(String(time || ''));
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
    route.availability = common.filter(cls => travelClass === 'ALL' || cls === travelClass).map(cls => ({
      class: cls,
      status: 'UNAVAILABLE',
      results: [],
      reason: 'RailRadar supplies timetable and route data, not live seat availability. Configure a separately authorised availability provider to verify seats.'
    }));
    return true;
  });
  return {
    from: from.code,
    to: to.code,
    results: routes,
    source: 'RailRadar',
    providerCheckedAt: payload?.meta?.timestamp || new Date().toISOString(),
    availabilityChecked: 0,
    availabilityCreditsRequested: 0,
    availabilityLimit: routes.length,
    sourceNote: 'RailRadar is an independent third-party timetable and route-data provider, not Indian Railways or IRCTC. Its route planner supplies direct and connecting train schedules, but this response does not confirm live seat availability. Seats remain unverified unless a separate authorised availability provider confirms them.'
  };
}

export function isRailRadarConfigured() {
  return Boolean(process.env.RAILRADAR_API_KEY);
}
