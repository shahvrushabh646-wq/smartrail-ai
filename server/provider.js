// Provider adapter: only use an authorised provider with a documented API contract.
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
      signal: AbortSignal.timeout(12000)
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

  return {
    status: 'OK',
    results: data.results,
    source: data.source || 'Configured provider',
    fetchedAt: data.fetchedAt || new Date().toISOString()
  };
}
