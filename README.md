# SmartRail AI

SmartRail AI is a train-journey search prototype. It never invents trains, train timings, fares or seat availability.

## Current data integration

### Direct train search — RailCore (optional third-party provider)

The app now supports the documented RailCore API for:
- Station-name/code resolution.
- Date-specific direct trains between two stations.
- Classes and running days returned by the provider.
- Fresh seat-availability checks for the top results, using the batch endpoint.
- Fares, available-seat count and source update time when returned.

RailCore is an **independent third-party service**, not Indian Railways, CRIS or IRCTC. Its published free plan currently advertises 500 requests/month, 100/day and 10/minute; limits and pricing can change. Every checked class consumes API usage. The default app setting checks the top 3 direct trains to limit usage. See the provider's [API documentation](https://railcore.tech/developers/irctc-api), [trains-between-stations contract](https://railcore.tech/docs/api/route-trains), [station search contract](https://railcore.tech/docs/api/search-stations), and [seat-availability contract](https://railcore.tech/docs/api/batch-seat-availability).

To enable:
1. Create your own provider account/key at [RailCore Developers](https://railcore.tech/developers).
2. In Vercel → Project → Settings → Environment Variables, add `RAILCORE_KEY` with your key.
3. Optionally add `RAILCORE_AVAILABILITY_LIMIT` (default `3`, maximum `10`).
4. Redeploy the project and test `/api/health`; `scheduleProviderConfigured` should be `true`.

Do not put the key in React code, commit it to GitHub, or share it in chat. The key must remain server-side. The provider key is not supplied by SmartRail AI.

### Via-station / split-ticket routes

Connecting routes are calculated from `server/data/timetable.json`. This file is intentionally empty until a current, verified multi-stop timetable with suitable reuse rights is supplied. The app will not use an old or unlicensed dataset as if it were current.

For local timetable imports, each consecutive train segment must include:
- `trainNo`, `name`, `from`, `to`
- `departureMinutes`, `departureDayOffset`
- `arrivalMinutes`, `arrivalDayOffset`
- `classes` (the actual classes operating on that segment)

Minutes are local clock minutes after midnight. Day offsets are relative to the journey date. The route planner applies a minimum 30-minute interchange and only offers classes common to every leg. Split-route seat checks require an authorised provider that returns one availability status per segment. Every segment must be available/confirmed; RAC, WL and partial confirmations are excluded. Separate PNRs do not protect a missed connection if the first train is delayed.

**Important:** The RailCore integration currently returns direct train options. It does not magically create a complete connecting-route timetable. Via-station options remain disabled until a verified multi-stop timetable is imported and the relevant availability provider is configured.

## Official integration option

IRCTC publishes the Train Information Enquiry Scheme (TIES), which covers availability/fare, trains between stations, train schedules and related enquiries for registered service providers. It is a formal integration route and has registration/integration charges and annual commitments; it is not a free public API. See the [official IRCTC TIES policy](https://contents.irctc.co.in/en/TIES_Policy.pdf).

The public OGD Indian Railways timetable catalogue was last updated on 24 January 2018, so it is not suitable as a current operational timetable without independent validation.

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

Frontend: http://localhost:5173  
API: http://localhost:4100

## API

- `GET /api/health` — API and provider configuration status.
- `POST /api/search` — accepts JSON `{ "from": "PUNE", "to": "CSMT", "date": "YYYY-MM-DD", "travelClass": "ALL" }`.

Station names are resolved through the configured provider. If a name matches multiple stations, use an exact station code.

## Deployment

1. Import `shahvrushabh646-wq/smartrail-ai` into Vercel.
2. Root directory: `./`.
3. Build command: `npm run build`; output: `dist`.
4. Add `RAILCORE_KEY` in Vercel Environment Variables if using RailCore.
5. Deploy the latest `main` commit.
6. Check `/api/health`, then test a journey search.

This is an informational search tool, not a booking engine. Recheck availability at the final booking source before purchasing tickets.
