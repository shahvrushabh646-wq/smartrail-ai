import fs from 'node:fs/promises';
import { getLiveAvailability } from '../server/provider.js';

async function readTimetable() {
  try {
    return JSON.parse(await fs.readFile(new URL('../server/data/timetable.json', import.meta.url), 'utf8'));
  } catch {
    return [];
  }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  try {
    const { from, to, date, travelClass = 'ALL' } = req.body || {};
    if (!from || !to || !date) return res.status(400).json({ error: 'From, To and journey date are required.' });
    const all = await readTimetable();
    const norm = s => String(s || '').trim().toLowerCase();
    const direct = all.filter(t => norm(t.from) === norm(from) && norm(t.to) === norm(to));
    const routes = direct.map(t => ({ train: t, segments: [t] }));
    const starts = all.filter(t => norm(t.from) === norm(from));
    const connections = [];
    for (const first of starts) {
      for (const second of all.filter(t => norm(t.from) === norm(first.to) && norm(t.to) === norm(to))) {
        const arrival = Number(first.arrivalDayOffset || 0) * 1440 + Number(first.arrivalMinutes);
        const departure = Number(second.departureDayOffset || 0) * 1440 + Number(second.departureMinutes);
        if (Number.isFinite(arrival) && Number.isFinite(departure) && departure - arrival >= 30) {
          connections.push({ train: null, segments: [first, second], interchangeMinutes: departure - arrival, via: first.to });
        }
      }
    }
    routes.push(...connections);
    const results = await Promise.all(routes.map(async route => {
      const classSets = route.segments.map(segment => new Set(segment.classes || []));
      const common = [...(classSets[0] || [])].filter(c => classSets.every(set => set.has(c)));
      const classes = travelClass === 'ALL' ? common : common.includes(travelClass) ? [travelClass] : [];
      const availability = await Promise.all(classes.map(async cls => {
        try {
          const live = await getLiveAvailability(route.segments, date, cls);
          if (live.status !== 'OK') return { class: cls, ...live };
          const confirmed = (live.results || []).filter(option =>
            Array.isArray(option.segments) &&
            option.segments.length === route.segments.length &&
            option.segments.every(segment => String(segment.status).toUpperCase() === 'CONFIRMED')
          );
          return { class: cls, status: 'OK', results: confirmed, source: live.source, fetchedAt: live.fetchedAt, excludedCount: (live.results || []).length - confirmed.length };
        } catch {
          return { class: cls, status: 'UNAVAILABLE', reason: 'Availability provider request failed.' };
        }
      }));
      return { ...route, availability };
    }));
    return res.status(200).json({
      from, to, date, results,
      sourceNote: 'Timetable results require a current verified timetable. Seat availability is shown only when an authorised provider is configured.',
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({ error: 'SmartRail search failed safely. Please try again.', detail: error?.message || 'Unknown server error' });
  }
}
