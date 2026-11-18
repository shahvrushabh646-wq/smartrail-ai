const BASE = 'https://ir.railcore.tech/v1';

function configured() {
  return Boolean(process.env.RAILCORE_KEY);
}

async function request(path, options = {}) {
  const key = process.env.RAILCORE_KEY;
  if (!key) throw new Error('RailCore API key is not configured.');
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'X-RailCore-Key': key,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(15000)
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Rail data provider returned invalid JSON (HTTP ${response.status}).`);
  }

  if (!response.ok || payload?.success === false) {
    const code = payload?.error?.code || payload?.code;
    if (response.status === 404 && code === 'NO_TRAINS_FOUND') {
      return { noTrains: true, data: { trains: [] } };
    }
    const message = payload?.error?.message || payload?.message || code || `HTTP ${response.status}`;
    throw new Error(`Rail data provider: ${message}`);
  }
  return payload;
}

async function resolveStation(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Enter both station codes or names.');
  if (/^[A-Z0-9]{2,5}$/.test(raw)) return raw.toUpperCase();

  const payload = await request(`/stations/search?q=${encodeURIComponent(raw)}&limit=5`);
  const matches = payload?.data?.results || payload?.results || [];
  if (!matches.length) throw new Error(`No station matched "${raw}". Try its official station code.`);

  const normalise = value => String(value || '')
    .toLowerCase()
    .replace(/\b(junction|jn\.?|railway station)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();

  const exact = matches.find(item =>
    String(item.station_name || '').toLowerCase() === raw.toLowerCase() ||
    String(item.display_name || '').toLowerCase() === raw.toLowerCase()
  );
  if (exact) return exact.station_code;

  // A city name often returns several nearby stations. If exactly one result
  // is the city's named main junction (e.g. "Pune" -> "PUNE JN."),
  // select that canonical junction instead of failing the whole search.
  const cityKey = normalise(raw);
  const mainJunctions = matches.filter(item => {
    const name = String(item.station_name || item.display_name || '');
    const key = normalise(name);
    const isJunction = /\b(junction|jn\.?)\b/i.test(name);
    return isJunction && key === cityKey;
  });
  if (mainJunctions.length === 1) return mainJunctions[0].station_code;

  const top = matches[0];
  const second = matches[1];
  const confident = Number(top.confidence || 0) >= 0.9 &&
    (!second || Number(top.confidence || 0) - Number(second.confidence || 0) >= 0.12);
  if (confident) return top.station_code;

  const choices = matches.slice(0, 4).map(item =>
    `${item.display_name || item.station_name} (${item.station_code})`
  ).join(', ');
  throw new Error(`"${raw}" matches multiple stations. Enter a station code. Matches: ${choices}`);
}

function minutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const h = Number(match[1]), m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function normaliseTrain(train) {
  const departureMinutes = minutes(train.departure_time);
  const duration = Number(train.duration_minutes);
  const arrivalAbsolute = departureMinutes == null || !Number.isFinite(duration)
    ? null
    : departureMinutes + duration;
  const arrivalMinutes = arrivalAbsolute == null ? minutes(train.arrival_time) : arrivalAbsolute % 1440;
  const arrivalDayOffset = arrivalAbsolute == null ? 0 : Math.floor(arrivalAbsolute / 1440);
  return {
    trainNo: String(train.train_number || ''),
    name: train.extended_train_name || train.train_name || '',
    from: train.from_station_code,
    to: train.to_station_code,
    fromName: train.from_station_name || train.from_station_code,
    toName: train.to_station_name || train.to_station_code,
    departureTime: train.departure_time || '',
    arrivalTime: train.arrival_time || '',
    departureMinutes,
    departureDayOffset: 0,
    arrivalMinutes,
    arrivalDayOffset,
    durationMinutes: Number.isFinite(duration) ? duration : null,
    classes: Array.isArray(train.classes) ? [...new Set(train.classes.map(x => String(x).toUpperCase()))] : [],
    runningDays: Array.isArray(train.running_days) ? train.running_days : [],
    source: 'RailCore'
  };
}

function indiaClock() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute)
  };
}

async function freshAvailability(trains, date, travelClass) {
  const limit = Math.max(1, Math.min(10, Number(process.env.RAILCORE_AVAILABILITY_LIMIT || 3)));
  const checked = trains.slice(0, limit);
  const items = checked.map(train => {
    const classes = travelClass === 'ALL'
      ? train.classes.slice(0, 8)
      : train.classes.includes(travelClass) ? [travelClass] : [];
    return {
      train_number: train.trainNo,
      from: train.from,
      to: train.to,
      date,
      classes,
      quota: 'GN'
    };
  }).filter(item => item.classes.length);

  if (!items.length) return { byTrain: new Map(), checkedCount: 0, creditsRequested: 0, limit, checkedTrainNumbers: new Set() };
  const payload = await request('/availability/seats/batch', {
    method: 'POST',
    body: JSON.stringify({ items })
  });
  const rows = payload?.data?.results || payload?.results || [];
  const byTrain = new Map();
  for (const row of rows) {
    const key = String(row.train_number || '');
    const classes = new Map((row.classes || []).map(item => [String(item.class_code).toUpperCase(), item]));
    byTrain.set(key, classes);
  }
  return { byTrain, checkedCount: items.length, creditsRequested: items.reduce((sum, item) => sum + item.classes.length, 0), limit, checkedTrainNumbers: new Set(items.map(item => String(item.train_number))) };
}

export async function searchRailCoreJourney(fromInput, toInput, date, travelClass = 'ALL') {
  const [from, to] = await Promise.all([resolveStation(fromInput), resolveStation(toInput)]);
  if (from === to) throw new Error('Origin and destination must be different stations.');

  const query = new URLSearchParams({ from, to, date, match: 'station' });
  const payload = await request(`/routes/trains?${query.toString()}`);
  const rawTrains = payload?.data?.trains || payload?.trains || [];
  const allTrains = rawTrains.map(normaliseTrain).filter(train =>
    train.trainNo && train.from && train.to && train.departureMinutes != null &&
    train.arrivalMinutes != null && train.classes.length
  );
  const now = indiaClock();
  // The provider returns a full-day timetable. On today's journey date, hide
  // departures that have already left before selecting live availability checks.
  const departedCount = date === now.date
    ? allTrains.filter(train => train.departureMinutes <= now.minutes).length
    : 0;
  const trains = date === now.date
    ? allTrains.filter(train => train.departureMinutes > now.minutes)
    : allTrains;

  const availability = await freshAvailability(trains, date, travelClass);
  const results = trains.map((train, index) => {
    const classCodes = travelClass === 'ALL'
      ? train.classes
      : train.classes.includes(travelClass) ? [travelClass] : [];
    const checkedClasses = availability.byTrain.get(train.trainNo);
    const classResults = classCodes.map(cls => {
      const live = checkedClasses?.get(cls);
      if (!live) {
        return {
          class: cls,
          status: 'UNAVAILABLE',
          reason: !availability.checkedTrainNumbers.has(train.trainNo)
            ? 'Live check not run for this result to protect the provider request limit.'
            : 'Live availability was not returned by the provider.'
        };
      }
      const status = String(live.status || 'UNKNOWN').toUpperCase();
      const confirmed = status === 'AVAILABLE';
      return {
        class: cls,
        status: 'OK',
        results: confirmed ? [{
          segments: [{ status: 'AVAILABLE' }],
          fare: live.total_fare ?? live.fare ?? null,
          availableCount: live.available_count ?? null,
          availabilityText: live.availability_text || status
        }] : [],
        reason: confirmed ? null : (live.availability_text || status),
        providerStatus: status,
        fetchedAt: live.last_updated_at || payload?.meta?.timestamp || new Date().toISOString(),
        source: 'RailCore'
      };
    });
    return {
      segments: [train],
      availability: classResults,
      source: 'RailCore',
      via: null
    };
  });

  return {
    from,
    to,
    results,
    source: 'RailCore',
    providerCheckedAt: payload?.meta?.timestamp || new Date().toISOString(),
    availabilityChecked: availability.checkedCount,
    availabilityCreditsRequested: availability.creditsRequested,
    availabilityLimit: availability.limit,
    departedFiltered: departedCount,
    sourceNote: `Train schedules and seat-availability responses are supplied by RailCore, an independent third-party provider, not Indian Railways or IRCTC. ${departedCount} train(s) already departed in India time were excluded for this same-day search. Fresh availability was requested for the next ${availability.limit} upcoming direct trains only (estimated ${availability.creditsRequested} class checks); remaining trains are not live-checked. Source timestamps are shown where available. Recheck before booking.`
  };
}

export function isRailCoreConfigured() {
  return configured();
}
