# SmartRail AI

SmartRail AI is a train-journey search prototype. It never invents trains, train timings, fares or seat availability.

## Current data integration

### Direct train search — RailCore (optional third-party provider)

The app now supports the documented RailCore API for:
- Station-name/code resolution.
- Date-specific direct trains between two stations.
- Classes and running days returned by the provider.
- Fresh seat-availability checks for every upcoming direct train and every class returned for that train, using the batch endpoint by default.
- Fares, available-seat count and source update time when returned.

RailCore is an **independent third-party service**, not Indian Railways, CRIS or IRCTC. RailCore is an independent third-party source, not Indian Railways or IRCTC. Its published plan limits and prices differ across its quickstart and pricing pages, so check the live developer dashboard before relying on a quota or cost figure. Free access is for evaluation and personal projects; the provider lists paid plans for commercial use. Every distinct train/class availability check consumes usage, including checks batched into one HTTP request. SmartRail checks every upcoming direct train and every class returned by the timetable by default. Set `RAILCORE_AVAILABILITY_LIMIT` to a positive integer only when you deliberately want to cap the number of trains checked; set it to `ALL` (or leave it unset) for all upcoming trains. Unchecked classes remain visible as NOT CHECKED, never as unavailable. See [pricing](https://railcore.tech/pricing), [API documentation](https://railcore.tech/developers/seat-availability-api), [trains-between-stations contract](https://railcore.tech/docs/api/route-trains), [station search contract](https://railcore.tech/docs/api/search-stations), [batch seat-availability contract](https://railcore.tech/docs/api/seat-availability), and [API terms](https://railcore.tech/legal/api-terms). SmartRail must show RailCore attribution next to or near displayed data as required by those terms.

To enable:
1. Create your own provider account/key at [RailCore Developers](https://railcore.tech/developers).
2. In Vercel → Project → Settings → Environment Variables, add `RAILCORE_KEY` with your key.
3. Leave `RAILCORE_AVAILABILITY_LIMIT` unset or set it to `ALL` to check every upcoming direct train and all returned classes. A positive integer deliberately limits the number of trains checked and reduces provider usage.
4. Redeploy the project and test `/api/health`; `scheduleProviderConfigured` should be `true`.

Do not put the key in React code, commit it to GitHub, or share it in chat. The key must remain server-side. The provider key is not supplied by SmartRail AI.

### Independent backup timetable + connections — RailRadar

When RailCore is configured, SmartRail also queries RailRadar (when its key is configured) as an independent second source for direct and connecting itineraries. Matching journeys are merged into one journey card while each provider's class-wise availability remains a separate, source-labelled row. If RailCore is not configured or its request fails, RailRadar can serve as the fallback. The integration resolves station names/codes, requests up to two transfers with a minimum 30-minute interchange, and supports classes returned for every leg.

RailRadar is an independent third-party source, not Indian Railways, CRIS or IRCTC. In this integration its documented journey-planner endpoint supplies direct and connecting schedules, and its documented seat endpoint is queried per train/class/leg. Only fresh AVAILABLE responses for every leg are marked confirmed; RAC, waitlist, stale timestamps, errors and budget-skipped checks are not confirmed. RailRadar describes availability as externally aggregated, not authoritative, so users should recheck critical details before booking. Its plans are quota-based, not unlimited. See [RailRadar route-planner docs](https://railradar.in/docs/journey-plan), [station search docs](https://railradar.in/docs/search-stations), and [pricing](https://railradar.in/pricing).

To enable:
1. Create your own API key at [RailRadar Developers](https://railradar.in/).
2. Add `RAILRADAR_API_KEY` in Vercel → Project → Settings → Environment Variables.
3. Keep the key server-side; never commit it or put it in frontend code.
4. Redeploy and test a journey. When both provider keys are configured, SmartRail queries RailCore and RailRadar and combines matching itineraries while keeping each source's availability separate. RailRadar is also the fallback if RailCore is unavailable.

### Private personal-use feed — IRCTC.dev (optional)

SmartRail has an optional server-side adapter for the independent `irctc.dev` developer API. It can supply direct train schedules and class-wise 14-day seat-status responses. It is **not** an official IRCTC/Indian Railways/CRIS API or an endorsement by those authorities.

For private personal use only:
1. Create your own account/key at https://irctc.dev/dashboard.
2. Set `IRCTC_API_KEY` in Vercel Environment Variables.
3. Set a strong private `SMARTRAIL_PERSONAL_ACCESS_CODE` in Vercel. The search form asks for this code; the backend checks it before calling this provider. Do not share the code or API key.
4. Optionally set `IRCTC_DEV_AVAILABILITY_LIMIT` (1–5, default 2). With All Classes, each selected train may trigger multiple class requests.
5. Redeploy and check `/api/health` for `irctcDevConfigured: true`.

The integration uses the documented station search, trains-between-stations and seat-availability endpoints. Seat availability is displayed as the provider-reported status, but SmartRail deliberately does **not** mark it confirmed: the published response schema does not provide a class-level fetch timestamp for freshness verification. Always verify the current status on the official booking channel.

Important terms: irctc.dev describes itself as an independent service. Its terms prohibit redistribution and providing API responses through another API, platform, product or service, and limit data use to applications owned or operated by the subscriber. Because SmartRail is a separately hosted app, obtain written confirmation from irctc.dev that this exact private deployment is permitted before setting the key. Do not expose this integration as a public/customer-facing feed. This adapter does not bypass IRCTC rules or grant official data rights. See [API docs](https://irctc.dev/docs), [seat availability endpoint](https://irctc.dev/guides/irctc-seat-availability-tracker-python/), and [terms](https://irctc.dev/terms/).

#### Community project candidates (listed in UI, disabled by default)

SmartRail lists these three community repositories as integration candidates for transparency, but **does not execute or scrape from them**:

- [ConfirmTkt MCP](https://github.com/uditya-kumar/confirmtkt-mcp) — the repository code is MIT-licensed, but its described ConfirmTkt endpoint is reverse-engineered. The code licence does not grant permission to access, reuse or redistribute ConfirmTkt's service/data. Disabled unless ConfirmTkt provides written permission and a documented SmartRail API arrangement.
- [RailIN](https://github.com/ash2shukla/RailIN) — its README describes personal-use scraping and says it is not intended for commercial use; no suitable repository licence was identified. Not used by SmartRail.
- [MANIT RailwayAPI](https://github.com/MANIT-Bhopal/RailwayAPI) — an experimental crawler/API. Its source-code licence does not grant rights to crawl or redistribute Indian Railways website data. Not used by SmartRail.

These entries are informational provider records only; they do not make network requests, do not change search results, and do not indicate provider approval. Enable a source only after verifying the applicable website/API terms, data rights, permission, and commercial/attribution conditions.

#### Third-party app data partnerships (RailYatri, ixigo/ConfirmTkt, IRCTC)

These providers are **not connected**. Their consumer apps do not expose a public SmartRail developer API contract in the current integration. Do not scrape their private app endpoints, copy session tokens, or reuse credentials. Add a provider only after a written agreement, API documentation, credentials issued for SmartRail, and confirmed commercial/attribution terms. IRCTC access must be obtained through the applicable eligible route; an existing partner's credentials or enquiry API cannot simply be passed through to SmartRail.

## Via-station / split-ticket routes

Connecting routes are calculated from `server/data/timetable.json`. This file is intentionally empty until a current, verified multi-stop timetable with suitable reuse rights is supplied. The app will not use an old or unlicensed dataset as if it were current.

For local timetable imports, each consecutive train segment must include:
- `trainNo`, `name`, `from`, `to`
- `departureMinutes`, `departureDayOffset`
- `arrivalMinutes`, `arrivalDayOffset`
- `classes` (the actual classes operating on that segment)

Minutes are local clock minutes after midnight. Day offsets are relative to the journey date. The route planner applies a minimum 30-minute interchange and only offers classes common to every leg. Split-route seat checks require an authorised provider that returns one availability status per segment. Every segment must be available/confirmed; RAC, WL and partial confirmations are excluded. Separate PNRs do not protect a missed connection if the first train is delayed.

**Important:** RailCore supplies the primary direct search. When RailRadar is configured, SmartRail also uses its documented journey planner to obtain connecting-route schedules (including when RailCore is healthy and the selected route mode includes Via). If RailCore fails, RailRadar can supply both direct and connecting timetable results. RailRadar also documents a seat-availability endpoint (`GET /v1/trains/{number}/seats`). SmartRail checks each requested class for each leg and shows a route as confirmed only when every leg returns a fresh AVAILABLE result. RAC, waitlist, stale timestamps, errors and request-budget-skipped combinations are not labelled confirmed. The endpoint describes its data as aggregated from external sources, not authoritative; always verify critical details on IRCTC. Each train/class/leg check consumes a provider request. Set `RAILRADAR_AVAILABILITY_LIMIT` (1–24, default 24) to control the maximum route/class checks per search and `RAILRADAR_QUOTA` (default `GN`) to select quota.

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
4. Add `RAILCORE_KEY` and/or `RAILRADAR_API_KEY` in Vercel Environment Variables. Optionally, for private personal use only, add `IRCTC_API_KEY` and `SMARTRAIL_PERSONAL_ACCESS_CODE`; protect the deployment so it is not exposed as a public service. RailRadar is the automatic schedule/connection fallback when RailCore is unavailable.
5. Optionally set `RAILRADAR_AVAILABILITY_LIMIT` and `RAILRADAR_QUOTA` to control seat-check volume and quota.
6. Deploy the latest `main` commit.
7. Check `/api/health`, then test a journey search.

This is an informational search tool, not a booking engine. Recheck availability at the final booking source before purchasing tickets.


## Optional Chrome extension — browser-visible IRCTC availability

SmartRail includes an optional Chrome/Edge extension bridge in `extension/`. It reads class-wise status text already visible on an IRCTC page you open yourself and displays captured observations in SmartRail search results. This is a browser companion, not an independent live availability API.

Install:
1. Open `chrome://extensions` and enable Developer mode.
2. Click **Load unpacked** and select this repository's `extension` directory.
3. Open SmartRail AI in a tab.
4. In another tab, open IRCTC, search the same journey, and expand/check availability so the class status is visible.
5. Return to SmartRail and click **Refresh from browser**.

The extension does not log in, book, submit forms, read cookies, call private APIs, or bypass CAPTCHA. It stores up to 80 recent observations in Chrome local storage. Page markup may change, so only recognized rows appear; unrecognized/missing status is **not captured**, not unavailable. Refresh before booking.

See [extension installation and limitations](extension/README.md).
