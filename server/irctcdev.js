const BASE = 'https://api.irctc.dev';

export function isIrctcDevConfigured() {
  return Boolean(process.env.IRCTC_API_KEY && process.env.SMARTRAIL_PERSONAL_ACCESS_CODE);
}

function formatDate(date) {
  const [year, month, day] = String(date).split('-');
  return `${day}-${month}-${year}`;
}

async function request(path) {
  const key = process.env.IRCTC_API_KEY;
  if (!key) throw new Error('IRCTC.dev API key is not configured.');
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'x-api-key': key, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000)
  });
  let payload;
  try { payload = await response.json(); }
  catch { throw new Error(`IRCTC.dev returned invalid JSON (HTTP ${response.status}).`); }
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || payload?.message || `IRCTC.dev HTTP ${response.status}`);
  }
  return payload;
}

async function resolveStation(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Enter both origin and destination stations.');
  if (/^[A-Z0-9]{2,5}$/.test(raw)) return raw.toUpperCase();
  const payload = await request(`/api/v1/trains/stations?q=${encodeURIComponent(raw)}`);
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const norm = value => String(value || '').toLowerCase().replace(/\\b(junction|jn\\.?|railway station)\\b/g, '').replace(/[^a-z0-9]/g, '');
  const exact = rows.find(row => norm(row.name) === norm(raw) || norm(row.code) === norm(raw));
  if (exact?.code) return String(exact.code).toUpperCase();
  if (rows.length === 1 && rows[0]?.code) return String(rows[0].code).toUpperCase();
  if (!rows.length) throw new Error(`IRCTC.dev could not find station "${raw}".`);
  throw new Error(`"${raw}" matches multiple stations. Use an exact station code.`);
}

function normaliseTrain(row) {
  const dep = String(row.departure || '');
  const arr = String(row.arrival || '');
  const parseMinutes = value => {
    const match = /^(\\d{1,2}):(\\d{2})$/.exec(value);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const departureMinutes = parseMinutes(dep);
  const duration = Number(row.durationMin);
  const absoluteArrival = departureMinutes != null && Number.isFinite(duration) ? departureMinutes + duration : null;
  return {
    trainNo: String(row.trainNo || ''),
    name: String(row.trainName || ''),
    from: String(row.fromStation || ''),
    to: String(row.toStation || ''),
    fromName: String(row.fromStationName || row.fromStation || ''),
    toName: String(row.toStationName || row.toStation || ''),
    departureTime: dep,
    arrivalTime: arr,
    departureMinutes,
    departureDayOffset: Number(row.fromStationDayOffset || 0),
    arrivalMinutes: absoluteArrival == null ? parseMinutes(arr) : absoluteArrival % 1440,
    arrivalDayOffset: absoluteArrival == null ? Number(row.toStationDayOffset || 0) : Math.floor(absoluteArrival / 1440),
    durationMinutes: Number.isFinite(duration) ? duration : null,
    classes: Array.isArray(row.classes) ? row.classes.map(value => String(value).toUpperCase()) : [],
    runningDays: Array.isArray(row.runningDays) ? row.runningDays : [],
    source: 'IRCTC.dev'
  };
}

export async function searchIrctcDevJourney(fromInput, toInput, date, travelClass = 'ALL', accessCode) {
  if (!isIrctcDevConfigured()) throw new Error('IRCTC.dev and SmartRail personal access credentials are not configured.');
  if (!accessCode || accessCode !== process.env.SMARTRAIL_PERSONAL_ACCESS_CODE) {
    throw new Error('Enter the personal access code configured by the SmartRail owner to use this private provider.');
  }
  const [from, to] = await Promise.all([resolveStation(fromInput), resolveStation(toInput)]);
  if (from === to) throw new Error('Origin and destination must be different stations.');
  const query = new URLSearchParams({ from, to, date });
  const payload = await request(`/api/v1/trains/search?${query.toString()}`);
  const raw = Array.isArray(payload?.data) ? payload.data : [];
  const trains = raw.map(normaliseTrain).filter(train =>
    train.trainNo && train.from && train.to && train.departureMinutes != null && train.arrivalMinutes != null
  );
  const configuredLimit = Number.parseInt(process.env.IRCTC_DEV_AVAILABILITY_LIMIT || '2', 10);
  const limit = Number.isFinite(configuredLimit) ? Math.max(1, Math.min(5, configuredLimit)) : 2;
  const selected = trains.slice(0, limit);
  const allClasses = ['1A', '2A', '3A', '3E', 'SL', 'CC', 'EC'];
  let cursor = 0;
  const worker = async () => {
    while (cursor < selected.length) {
      const train = selected[cursor++];
      const classes = travelClass === 'ALL'
        ? (train.classes.length ? train.classes.filter(cls => allClasses.includes(cls)) : allClasses)
        : [travelClass];
      train.availability = await Promise.all(classes.map(async cls => {
        const params = new URLSearchParams({
          from: train.from, to: train.to, date: formatDate(date), class: cls, quota: 'GN'
        });
        try {
          const result = await request(`/api/v1/trains/${encodeURIComponent(train.trainNo)}/availability?${params.toString()}`);
          const row = (Array.isArray(result?.availability) ? result.availability : []).find(item => {
            const value = String(item.date || '');
            return value === date || value === formatDate(date);
          });
          const reported = row?.status || row?.type || 'NO STATUS RETURNED';
          const status = String(row?.type || reported).toUpperCase();
          return {
            class: cls, status: 'OK', results: [], providerStatus: reported,
            freshness: 'UNKNOWN', freshnessThresholdMinutes: 15,
            source: 'IRCTC.dev',
            reason: row
              ? 'Provider status shown as reported; the documented response has no class-level fetch timestamp, so SmartRail cannot label it freshly confirmed.'
              : 'Provider did not return the requested journey date for this train/class.',
            fetchedAt: null
          };
        } catch (error) {
          return { class: cls, status: 'ERROR', results: [], source: 'IRCTC.dev', freshness: 'UNKNOWN', reason: error?.message || 'Availability request failed.' };
        }
      }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, worker));
  const selectedNumbers = new Set(selected.map(train => train.trainNo));
  const results = trains.map(train => ({
    segments: [train],
    availability: train.availability || (travelClass === 'ALL'
      ? (train.classes.length ? train.classes : allClasses).map(cls => ({
          class: cls, status: 'UNAVAILABLE', results: [], source: 'IRCTC.dev',
          reason: 'Not checked to limit personal API usage.'
        }))
      : [{ class: travelClass, status: 'UNAVAILABLE', results: [], source: 'IRCTC.dev', reason: 'Not checked to limit personal API usage.' }]),
    source: 'IRCTC.dev',
    via: null
  }));
  return {
    from, to, results, source: 'IRCTC.dev',
    providerCheckedAt: new Date().toISOString(),
    availabilityChecked: selectedNumbers.size,
    availabilityLimit: limit,
    sourceNote: 'Schedule and availability data are supplied by IRCTC.dev, an independent third-party developer service and not an official Indian Railways/IRCTC feed. Seat statuses are displayed exactly as provider-reported but are not labelled confirmed because the documented availability response does not include a class-level fetch timestamp. Personal-use integration only; verify on the official booking channel before relying on it.'
  };
}
