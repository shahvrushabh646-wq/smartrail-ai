const BASE = 'https://api.railkit.in/api/v1';
const CLASSES = ['1A', '2A', '3A', '3E', 'SL', '2S', 'CC', 'EC'];

export function isRailKitConfigured() {
  return Boolean(process.env.RAILKIT_API_KEY);
}

function formatDate(date) {
  const [year, month, day] = String(date).split('-');
  return `${day}-${month}-${year}`;
}

async function request(path) {
  const key = process.env.RAILKIT_API_KEY;
  if (!key) throw new Error('RAILKIT_API_KEY is not configured.');
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'x-api-key': key, accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
    cache: 'no-store'
  });
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error(`RailKit returned invalid JSON (HTTP ${response.status}).`); }
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error?.message || payload?.error || payload?.message || `RailKit HTTP ${response.status}`);
  }
  return payload;
}

async function resolveStation(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Enter both origin and destination stations.');
  if (/^[A-Z0-9]{2,5}$/.test(raw)) return raw.toUpperCase();
  const payload = await request(`/stations/search?name=${encodeURIComponent(raw)}`);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const norm = value => String(value || '').toLowerCase().replace(/\\b(junction|jn\\.?|railway station)\\b/g, '').replace(/[^a-z0-9]/g, '');
  const exact = rows.find(row => norm(row.name) === norm(raw) || norm(row.code) === norm(raw));
  if (exact?.code) return String(exact.code).toUpperCase();
  if (rows.length === 1 && rows[0]?.code) return String(rows[0].code).toUpperCase();
  if (!rows.length) throw new Error(`RailKit could not find station "${raw}".`);
  throw new Error(`"${raw}" matches multiple stations. Enter an exact station code.`);
}

function toMinutes(value) {
  const match = /^(\\d{1,2}):(\\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const h = Number(match[1]), m = Number(match[2]);
  return h <= 23 && m <= 59 ? h * 60 + m : null;
}

function normaliseTrain(row) {
  const dep = String(row.from_time || row.departure_time || '');
  const arr = String(row.to_time || row.arrival_time || '');
  const departureMinutes = toMinutes(dep);
  let arrivalMinutes = toMinutes(arr);
  let arrivalDayOffset = 0;
  if (departureMinutes != null && arrivalMinutes != null && arrivalMinutes < departureMinutes) arrivalDayOffset = 1;
  return {
    trainNo: String(row.train_no || row.train_number || ''),
    name: String(row.train_name || row.name || ''),
    from: String(row.from_stn_code || row.from_station_code || ''),
    to: String(row.to_stn_code || row.to_station_code || ''),
    fromName: String(row.from_stn_name || row.from_station_name || row.from_stn_code || ''),
    toName: String(row.to_stn_name || row.to_station_name || row.to_stn_code || ''),
    departureTime: dep,
    arrivalTime: arr,
    departureMinutes,
    departureDayOffset: 0,
    arrivalMinutes,
    arrivalDayOffset,
    durationMinutes: null,
    classes: Array.isArray(row.classes) ? row.classes.map(value => String(value.class_code || value.code || value).toUpperCase()) : [],
    runningDays: String(row.running_days || '').split('').map(Number),
    source: 'RailKit'
  };
}

async function fetchClass(train, date, cls) {
  const path = `/seats/${encodeURIComponent(train.trainNo)}/${encodeURIComponent(train.from)}/${encodeURIComponent(train.to)}/${formatDate(date)}/${encodeURIComponent(cls)}/GN`;
  const payload = await request(path);
  const data = payload?.data || {};
  const row = Array.isArray(data.availability) ? data.availability.find(item => {
    const raw = String(item.date || '');
    return raw === date || raw === formatDate(date) || raw === `${Number(date.slice(8,10))}-${Number(date.slice(5,7))}-${date.slice(0,4)}`;
  }) : null;
  if (!row) return {
    class: cls, status: 'UNAVAILABLE', results: [], source: 'RailKit',
    freshness: 'UNKNOWN', providerStatus: 'NO STATUS RETURNED',
    reason: 'RailKit did not return a status for the requested journey date.'
  };
  const statusText = String(row.availabilityText || row.rawStatus || row.status || 'UNKNOWN').trim();
  const statusCode = String(row.status || 'UNKNOWN').toUpperCase();
  return {
    class: cls, status: 'OK', results: [], source: 'RailKit',
    freshness: 'UNKNOWN', providerStatus: statusText,
    providerStatusCode: statusCode,
    fetchedAt: new Date().toISOString(),
    fare: data.fare?.totalFare ?? null,
    reason: 'Status is reported by RailKit. The documented seat response does not provide a per-class upstream update timestamp, so SmartRail displays it as provider-reported, not independently freshness-confirmed.'
  };
}

export async function searchRailKitJourney(fromInput, toInput, date, travelClass = 'ALL') {
  const [from, to] = await Promise.all([resolveStation(fromInput), resolveStation(toInput)]);
  if (from === to) throw new Error('Origin and destination must be different stations.');
  const payload = await request(`/trains/between/${encodeURIComponent(from)}/${encodeURIComponent(to)}?date=${formatDate(date)}`);
  const raw = Array.isArray(payload?.data) ? payload.data : [];
  const trains = raw.map(normaliseTrain).filter(train =>
    train.trainNo && train.from && train.to && train.departureMinutes != null && train.arrivalMinutes != null
  );
  const seen = new Set();
  const unique = trains.filter(train => {
    const key = [train.trainNo, train.from, train.to, train.departureTime].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a,b) => a.departureMinutes - b.departureMinutes);

  const limitRaw = Number.parseInt(process.env.RAILKIT_AVAILABILITY_TRAIN_LIMIT || '3', 10);
  const trainLimit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(10, limitRaw)) : 3;
  const selected = unique.slice(0, trainLimit);
  const selectedNumbers = new Set(selected.map(train => train.trainNo));
  const results = await Promise.all(unique.map(async train => {
    const offered = train.classes.length ? train.classes.filter(cls => CLASSES.includes(cls)) : CLASSES;
    const requested = travelClass === 'ALL' ? offered : offered.includes(travelClass) ? [travelClass] : [];
    const classes = selectedNumbers.has(train.trainNo) ? requested : [];
    const availability = await Promise.all(classes.map(cls => fetchClass(train, date, cls).catch(error => ({
      class: cls, status: 'ERROR', results: [], source: 'RailKit',
      freshness: 'UNKNOWN', providerStatus: 'REQUEST FAILED',
      reason: error?.message || 'RailKit availability request failed.'
    }))));
    if (!classes.length) {
      const list = travelClass === 'ALL' ? offered : [travelClass];
      for (const cls of list) availability.push({
        class: cls, status: 'UNAVAILABLE', results: [], source: 'RailKit',
        freshness: 'UNKNOWN', providerStatus: 'NOT CHECKED',
        reason: `Not checked in this search. Seat checks are limited to the first ${trainLimit} trains to control API usage.`
      });
    }
    return { segments: [train], availability, source: 'RailKit', via: null };
  }));
  return {
    from, to, results, source: 'RailKit',
    providerCheckedAt: new Date().toISOString(),
    availabilityChecked: selected.length,
    availabilityLimit: trainLimit,
    availabilityCreditsRequested: selected.reduce((sum, train) => sum + (travelClass === 'ALL' ? (train.classes.length ? train.classes.filter(cls => CLASSES.includes(cls)).length : CLASSES.length) : 1), 0),
    sourceNote: `Journey search and class-wise seat status are fetched server-side from RailKit, an independent third-party railway API, not an official IRCTC feed. No Chrome tab or browser extension is required. RailKit's REST endpoint returns provider-reported availability but does not document a per-class upstream timestamp; SmartRail labels those values provider-reported/unverified and shows the server observation time. Seat requests are limited to the first ${trainLimit} trains by RAILKIT_AVAILABILITY_TRAIN_LIMIT (default 3) to control usage; unrequested combinations are explicitly marked NOT CHECKED. Verify on the official booking channel before relying on a status.`
  };
}
