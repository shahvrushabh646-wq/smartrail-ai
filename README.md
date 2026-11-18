# SmartRail AI — Phase 1 data-ready starter

This is a **data-ready prototype**, not a live railway booking service. It deliberately contains no invented trains, fares, seat counts or PNRs. `server/data/timetable.json` starts empty; add a verified and legally usable timetable feed before expecting route results.

## Included
- Responsive search UI with From, To, journey date and All Classes default.
- Backend API (`GET /api/health`, `POST /api/search`).
- Direct-route lookup and two-leg via-station discovery from the supplied timetable.
- Same-class intersection across every leg (a class is offered only when every segment operates it).
- Minimum 30-minute interchange rule, with day offsets for overnight timetable calculations.
- Live provider adapter. Without authorised credentials it explicitly returns `UNAVAILABLE`.
- Split-ticket options are retained only if the provider confirms **every segment** as `CONFIRMED`; RAC, WL, partial confirmations and malformed results are excluded.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

Frontend: http://localhost:5173 — API: http://localhost:4100

## Timetable data format

Populate `server/data/timetable.json` only with a current, verified dataset whose licence/terms permit this use. Example record shape (illustrative schema only, **not a real train**):

```json
[
  {
    "trainNo": "TRAIN_NUMBER",
    "name": "TRAIN_NAME",
    "from": "SOURCE_STATION_CODE",
    "to": "DESTINATION_STATION_CODE",
    "departureMinutes": 540,
    "departureDayOffset": 0,
    "arrivalMinutes": 780,
    "arrivalDayOffset": 0,
    "classes": ["SL", "3A", "2A"]
  }
]
```

Minutes are local clock minutes after midnight. `arrivalDayOffset` / `departureDayOffset` are day offsets from the journey date. For multi-stop trains, provide segment records for each consecutive station pair, with the correct times and day offsets. This starter's route discovery currently handles direct and one-interchange/two-leg routes; multi-interchange search is a later enhancement.

## Live availability provider contract

IRCTC/CRIS live availability is not assumed to be a free, public API. Obtain written permission/credentials or use a provider whose contract explicitly permits your use. Configure `RAIL_AVAILABILITY_URL` and `RAIL_API_KEY` in `.env`. The configured endpoint must accept POST JSON:

```json
{"segments":[{"trainNo":"...","from":"...","to":"..."}],"journeyDate":"YYYY-MM-DD","travelClass":"3A"}
```

It must return:

```json
{
  "source":"Provider name",
  "fetchedAt":"2026-11-18T08:30:00Z",
  "results":[
    {"fare":1234,"segments":[{"status":"CONFIRMED"},{"status":"CONFIRMED"}]}
  ]
}
```

For a split journey, `segments` must contain one status per leg, in route order. The backend displays only options where **all** leg statuses equal `CONFIRMED`. The provider-specific request/response mapping must be verified before production; never point this adapter at an undocumented endpoint. Revalidate before redirecting to booking. Separate PNRs are not a protected connection: a delay on the first ticket can cause the second ticket to be missed.

## Important limitations / next work
- No booking, payment, PNR, Tatkal, bus or flight integration in Phase 1.
- Static timetable data can become stale; include source, version and last-updated metadata in a production feed.
- Live provider adapter requires a real authorised provider. Hosting, database and provider quotas may have costs even if the app code is free.
- Add provider-specific schema validation, rate limiting, caching, monitoring, audit logs and security before public launch.
- This is a route-search prototype, not a guarantee of railway availability or journey protection.

## Deploy to Vercel

1. Import `shahvrushabh646-wq/smartrail-ai` into Vercel.
2. Keep the project root directory as `./`.
3. Use the Vite framework preset, build command `npm run build`, and output directory `dist`.
4. Deploy the latest commit on `main`.
5. Test `/api/health` in the deployed domain; it should return JSON with `ok: true`.
6. Test `POST /api/search` with JSON containing `from`, `to`, `date`, and optional `travelClass`.

The Vercel function configuration explicitly includes `server/data/timetable.json` in the search function bundle. Do not add fake sample train records to make the search look populated. Until a verified timetable feed and an authorised availability provider are configured, the app will correctly report that no route dataset/live availability is available.
