import fs from 'node:fs/promises';
import path from 'node:path';
import { getLiveAvailability } from '../server/provider.js';

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
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
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
    const from = String(body.from || '').trim();
    const to = String(body.to || '').trim();
    const date = body.date;
    const travelClass = String(body.travelClass || 'ALL').trim().toUpperCase();

    if (!from || !to) return res.status(400).json({ error: 'Enter both origin and destination stations.' });
    if (from.toLowerCase() === to.toLowerCase()) return res.status(400).json({ error: 'Origin and destination must be different.' });
    if (!validDate(date)) return res.status(400).json({ error: 'Enter a valid journey date in YYYY-MM-DD format.' });

    const all = await readTimetable();
    const norm = value => String(value || '').trim().toUpperCase();
    const direct = all.filter(t => norm(t.from) === norm(from) && norm(t.to) === norm(to));
    const routes = direct.map(train => ({ train, segments: [train] }));
    const firstLegs = all.filter(t => norm(t.from) === norm(from));
    const connections = [];

    for (const first of firstLegs) {
      for (const second of all.filter(t => norm(t.from) === norm(first.to) && norm(t.to) === norm(to))) {
        const arrival = Number(first.arrivalDayOffset || 0) * 1440 + Number(first.arrivalMinutes);
        const departure = Number(second.departureDayOffset || 0) * 1440 + Number(second.departureMinutes);
        const buffer = departure - arrival;
        if (Number.isFinite(buffer) && buffer >= 30) {
          connections.push({ train: null, segments: [first, second], interchangeMinutes: buffer, via: first.to });
        }
      }
    }

    routes.push(...connections);

    const results = await Promise.all(routes.map(async route => {
      const sets = route.segments.map(segment => new Set((segment.classes || []).map(c => String(c).toUpperCase())));
      const commonClasses = [...(sets[0] || [])].filter(c => sets.every(set => set.has(c)));
      const selectedClasses = travelClass === 'ALL'
        ? commonClasses
        : commonClasses.includes(travelClass) ? [travelClass] : [];

      const availability = await Promise.all(selectedClasses.map(async cls => {
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

    results.sort((a, b) => {
      if (a.segments.length !== b.segments.length) return a.segments.length - b.segments.length;
      return (a.interchangeMinutes || 0) - (b.interchangeMinutes || 0);
    });

    return res.status(200).json({
      from, to, date, results,
      timetableRecords: all.length,
      sourceNote: all.length
        ? 'Routes are based on the configured timetable. Seat availability is shown only when an authorised provider confirms it.'
        : 'No timetable feed is configured yet. No trains or availability have been invented.',
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('SmartRail search error:', error);
    return res.status(500).json({
      error: 'SmartRail could not complete this search.',
      detail: error?.message || 'Unexpected server error.'
    });
  }
}
