// Custom availability adapter. A provider response is never treated as live
// unless it includes a valid, recent fetch timestamp and explicit confirmation
// for every journey leg.
const MAX_FRESHNESS_MINUTES = 5;

export async function getLiveAvailability(segments, journeyDate, travelClass) {
  const endpoint = process.env.RAIL_AVAILABILITY_URL;
  const apiKey = process.env.RAIL_API_KEY;
  if (!endpoint || !apiKey) {
    return { status: 'UNAVAILABLE', reason: 'No authorised live availability provider is configured.' };
  }

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ segments, journeyDate, travelClass }),
      signal: AbortSignal.timeout(12000),
      cache: 'no-store'
    });
  } catch {
    return { status: 'UNAVAILABLE', reason: 'Availability provider could not be reached.' };
  }

  if (!response.ok) {
    return { status: 'UNAVAILABLE', reason: `Availability provider returned HTTP ${response.status}.` };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return { status: 'UNAVAILABLE', reason: 'Availability provider returned invalid JSON.' };
  }

  if (!data || !Array.isArray(data.results)) {
    return { status: 'UNAVAILABLE', reason: 'Provider response did not match the required data format.' };
  }

  const fetchedAt = data.fetchedAt || null;
  const fetchedMs = fetchedAt ? Date.parse(fetchedAt) : NaN;
  const ageMinutes = Number.isFinite(fetchedMs) && fetchedMs <= Date.now() + 2 * 60_000
    ? Math.max(0, (Date.now() - fetchedMs) / 60000)
    : null;
  if (ageMinutes == null || ageMinutes > MAX_FRESHNESS_MINUTES) {
    return {
      status: 'UNAVAILABLE',
      results: [],
      source: data.source || 'Configured provider',
      fetchedAt,
      freshness: ageMinutes == null ? 'UNKNOWN' : 'STALE',
      reason: 'Provider response has no valid fetch timestamp or is older than 5 minutes; not treated as confirmed.'
    };
  }

  const confirmedResults = data.results.filter(option =>
    Array.isArray(option?.segments) &&
    option.segments.length === segments.length &&
    option.segments.every(segment => String(segment?.status || '').toUpperCase() === 'CONFIRMED')
  );

  return {
    status: 'OK',
    results: confirmedResults,
    source: data.source || 'Configured provider',
    fetchedAt,
    freshness: 'FRESH',
    freshnessAgeMinutes: Math.floor(ageMinutes),
    freshnessThresholdMinutes: MAX_FRESHNESS_MINUTES,
    excludedCount: data.results.length - confirmedResults.length,
    reason: confirmedResults.length ? null : 'Provider did not explicitly confirm every journey leg.'
  };
}
