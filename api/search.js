import fs from 'node:fs/promises';
import path from 'node:path';
import { getLiveAvailability } from '../server/provider.js';
import { isRailCoreConfigured, searchRailCoreJourney } from '../server/railcore.js';
import { isRailRadarConfigured, searchRailRadarJourney } from '../server/railradar.js';

async function readTimetable() {
  const file = path.join(process.cwd(), 'server', 'data', 'timetable.json');
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error('Timetable data file is missing or invalid.');
  }
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function routeKey(route) {
  return (route.segments || []).map(segment =>
    [segment.trainNo || '', String(segment.from || '').toUpperCase(),
      String(segment.to || '').toUpperCase(), segment.departureTime || ''].join('|')
  ).join('>');
}

function mergeProviderRoutes(primaryRoutes, secondaryRoutes) {
  const merged = new Map();
  for (const route of [...primaryRoutes, ...secondaryRoutes]) {
    const key = routeKey(route);
    if (!merged.has(key)) {
      merged.set(key, { ...route, availability: [...(route.availability || [])] });
      continue;
    }
    const current = merged.get(key);
    const seen = new Set((current.availability || []).map(item => `${item.class}|${item.source || 'unknown'}`));
    for (const item of route.availability || []) {
      const itemKey = `${item.class}|${item.source || 'unknown'}`;
      if (!seen.has(itemKey)) current.availability.push(item);
    }
    current.source = [...new Set([current.source, route.source].filter(Boolean))].join(' + ');
  }
  return [...merged.values()];
}

function findConnections(all, from, to) {
  const norm = value => String(value || '').trim().toUpperCase();
  const connections = [];
  const firstLegs = all.filter(train => norm(train.from) === norm(from));
  for (const first of firstLegs) {
    for (const second of all) {
      if (norm(second.from) !== norm(first.to) || norm(second.to) !== norm(to)) continue;
      const arrival = Number(first.arrivalDayOffset || 0) * 1440 + Number(first.arrivalMinutes);
      const departure = Number(second.departureDayOffset || 0) * 1440 + Number(second.departureMinutes);
      const buffer = departure - arrival;
      if (Number.isFinite(buffer) && buffer >= 30) {
        connections.push({ train: null, segments: [first, second], interchangeMinutes: buffer, via: first.to });
      }
    }
  }
  const seen = new Set();
  return connections.filter(route => {
    const key = route.segments.map(segment => [segment.trainNo || segment.train_number || '', norm(segment.from), norm(segment.to), segment.departureTime || segment.departure_time || ''].join('|')).join('>');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function addLocalAvailability(routes, date, travelClass) {
  return Promise.all(routes.map(async route => {
    const sets = route.segments.map(segment => new Set((segment.classes || []).map(c => String(c).toUpperCase())));
    const commonClasses = [...(sets[0] || [])].filter(cls => sets.every(set => set.has(cls)));
    const selected = travelClass === 'ALL'
      ? commonClasses
      : commonClasses.includes(travelClass) ? [travelClass] : [];
    const availability = await Promise.all(selected.map(async cls => {
      const live = await getLiveAvailability(route.segments, date, cls);
      if (live.status !== 'OK') return { class: cls, ...live };
      const confirmed = live.results.filter(option =>
        Array.isArray(option.segments) &&
        option.segments.length === route.segments.length &&
        option.segments.every(segment => String(segment?.status || '').toUpperCase() === 'CONFIRMED')
      );
      return {
        class: cls,
        status: 'OK',
        results: confirmed,
        source: live.source,
        fetchedAt: live.fetchedAt,
        excludedCount: live.results.length - confirmed.length
      };
    }));
    return { ...route, availability };
  }));
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fromInput = String(body.from || '').trim();
    const toInput = String(body.to || '').trim();
    const date = body.date;
    const travelClass = String(body.travelClass || 'ALL').trim().toUpperCase();
    const routeType = String(body.routeType || 'ALL').trim().toUpperCase();

    if (!fromInput || !toInput) return res.status(400).json({ error: 'Enter both origin and destination stations.' });
    if (!validDate(date)) return res.status(400).json({ error: 'Enter a valid journey date in YYYY-MM-DD format.' });
    if (!['ALL', 'DIRECT', 'VIA'].includes(routeType)) return res.status(400).json({ error: 'Select Direct + Via, Direct only, or Via station only.' });
    if (travelClass !== 'ALL' && !/^[A-Z0-9]{2,3}$/.test(travelClass)) {
      return res.status(400).json({ error: 'Select a valid travel class.' });
    }

    const all = await readTimetable();

    let railCoreFailure = null;
    if (isRailCoreConfigured()) {
      try {
        const remote = await searchRailCoreJourney(fromInput, toInput, date, travelClass);
        const localConnections = findConnections(all, remote.from, remote.to);
        const connectionResults = await addLocalAvailability(localConnections, date, travelClass);
        let radarResults = [];
        let backupSourceNote = '';
        if (isRailRadarConfigured()) {
          try {
            const backup = await searchRailRadarJourney(fromInput, toInput, date, travelClass, routeType);
            radarResults = backup.results;
            const radarChecked = radarResults.reduce((sum, route) =>
              sum + (route.availability || []).filter(item => item.source === 'RailRadar').length, 0);
            const radarConfirmed = radarResults.reduce((sum, route) =>
              sum + (route.availability || []).filter(item => item.source === 'RailRadar' && item.results?.length).length, 0);
            backupSourceNote = ` RailRadar independently supplied ${radarResults.length} itinerary(s) and checked ${radarChecked} route/class combination(s); ${radarConfirmed} met SmartRail's fresh AVAILABLE checks. Unchecked, stale, RAC, waitlist and unverified results are not marked confirmed.`;
          } catch (backupError) {
            backupSourceNote = ` RailRadar secondary source was unavailable: ${backupError?.message || 'provider error'}.`;
          }
        }

        const localRoutes = routeType === 'DIRECT'
          ? remote.results
          : routeType === 'VIA'
            ? connectionResults
            : [...remote.results, ...connectionResults];
        const results = mergeProviderRoutes(localRoutes, radarResults);
        results.sort((a, b) => {
          if (a.segments.length !== b.segments.length) return a.segments.length - b.segments.length;
          return (a.interchangeMinutes || 0) - (b.interchangeMinutes || 0);
        });
        return res.status(200).json({
          from: remote.from,
          to: remote.to,
          date,
          results,
          timetableRecords: all.length,
          source: radarResults.length ? 'RailCore + RailRadar' : remote.source,
          providerCheckedAt: remote.providerCheckedAt,
          availabilityChecked: remote.availabilityChecked,
          availabilityLimit: remote.availabilityLimit,
          availabilityCreditsRequested: remote.availabilityCreditsRequested,
          routeType,
          sourceNote: `${remote.sourceNote} SmartRail combines matching journey results from configured independent providers and keeps each provider's availability result separate and labelled. Via-station routes also use the imported timetable when available.${backupSourceNote} Verify each provider's source and update time.`,
          generatedAt: new Date().toISOString()
        });
      } catch (error) {
        railCoreFailure = error?.message || 'RailCore is temporarily unavailable.';
      }
    }

    // Independent timetable/connection provider used when RailCore is unavailable
    // or not configured. It never represents timetable data as live seat availability.
    if (railCoreFailure || !isRailCoreConfigured()) {
      if (isRailRadarConfigured()) {
        try {
          const backup = await searchRailRadarJourney(fromInput, toInput, date, travelClass, routeType);
          return res.status(200).json({
            from: backup.from,
            to: backup.to,
            date,
            results: backup.results,
            timetableRecords: all.length,
            source: backup.source,
            providerCheckedAt: backup.providerCheckedAt,
            availabilityChecked: backup.availabilityChecked,
            availabilityLimit: backup.availabilityLimit,
            availabilityCreditsRequested: backup.availabilityCreditsRequested,
            routeType,
            providerError: railCoreFailure,
            sourceNote: railCoreFailure
              ? `RailCore fallback activated: ${railCoreFailure} RailRadar supplied the alternate timetable and connecting-route results. ${backup.sourceNote}`
              : backup.sourceNote,
            generatedAt: new Date().toISOString()
          });
        } catch (backupError) {
          if (!all.length) {
            return res.status(502).json({
              error: 'Both primary and backup train-data providers failed.',
              detail: `RailCore: ${railCoreFailure || 'not configured'}. RailRadar: ${backupError?.message || 'unavailable'}`,
              sourceNote: 'No trains or seat counts have been invented.'
            });
          }
        }
      }
    }

    if (!all.length) {
      return res.status(200).json({
        from: fromInput,
        to: toInput,
        date,
        results: [],
        timetableRecords: 0,
        source: null,
        sourceNote: 'No train data source is connected. Configure RAILCORE_KEY for the independent RailCore API, or import a current timetable feed whose licence permits this use. Live seat availability is a separate service. No trains or seat counts have been invented.',
        generatedAt: new Date().toISOString()
      });
    }

    const norm = value => String(value || '').trim().toUpperCase();
    const direct = all.filter(train => norm(train.from) === norm(fromInput) && norm(train.to) === norm(toInput));
    const routes = routeType === 'VIA' ? [] : direct.map(train => ({ train, segments: [train] }));
    if (routeType !== 'DIRECT') routes.push(...findConnections(all, fromInput, toInput));
    const results = await addLocalAvailability(routes, date, travelClass);
    results.sort((a, b) => {
      if (a.segments.length !== b.segments.length) return a.segments.length - b.segments.length;
      return (a.interchangeMinutes || 0) - (b.interchangeMinutes || 0);
    });

    return res.status(200).json({
      from: fromInput,
      to: toInput,
      date,
      results,
      routeType,
      timetableRecords: all.length,
      source: railCoreFailure ? 'Imported timetable fallback' : 'Imported timetable',
      providerError: railCoreFailure,
      sourceNote: railCoreFailure
        ? `RailCore could not complete this search (${railCoreFailure}). SmartRail used the locally imported timetable as a fallback. Seat availability is shown only when the separately configured authorised availability provider confirms every leg. This fallback is only as current as the imported timetable; verify its source and update date.`
        : 'Routes are based on the locally imported timetable. Seat availability is shown only when a separate authorised provider confirms every leg.',
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('SmartRail search error:', error);
    return res.status(502).json({
      error: 'SmartRail could not complete this search.',
      detail: error?.message || 'The train data provider is temporarily unavailable.'
    });
  }
}
