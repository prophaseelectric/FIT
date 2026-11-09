# FIT

Personal fitness dashboard PWA on top of Garmin's **Connect Personal API** (launched Oct 2026: free, no developer program, read-only). Your data is pulled to your own Azure storage and stays there.

```
app/   PWA (vanilla JS modules, Chart.js, Leaflet). No build step.
api/   Azure Functions (Node 22). One catch-all function -> src/lib/handlers.js
test/  End-to-end smoke test (Playwright) against mock Garmin data
dev-server.js  Runs app + API locally, no Azure tools needed
macrofactor-glance/  Separate project: MacroFactor nutrition on the watch (Connect IQ glance + iOS Shortcuts)
```

## What it does

| Area | Features |
|---|---|
| Today | Recovery verdict (HRV vs baseline, sleep, resting HR vs 30-day avg, Body Battery, load ratio) with the reason for each signal; sleep, HRV, RHR, Body Battery, steps, stress, weekly intensity minutes, weight trend; journal tags; quick weigh-in |
| Sleep | Stages per night vs sleep need, score, sleep window and consistency (bedtime SD), 7-night debt, HRV with baseline band, sleeping HR, breathing rate, weekday pattern, night table |
| Train | Weekly volume by sport, training load (acute 7d vs chronic 28d, ratio with sweet spot), weekly HR zones + polarization check, VO2max trend, all-time best efforts (400 m to marathon), activity list |
| Activity | Route map, HR / pace / elevation / cadence / power / temp streams from the original FIT file, laps, strength sets, zones, training effect, download original FIT |
| Lift | Exercise library mapped to Garmin FIT exercise IDs, templates, live logging (previous numbers, warm-up/drop/failure sets, RIR, rest timer with vibration), double-progression weight suggestions, e1RM PRs, progress charts, hard sets per muscle per week |
| Workouts to watch | Strength templates and run/ride interval workouts (HR zone, HR range or pace targets) export as real FIT workout files |
| Body | Weigh-ins (Garmin scale + manual), smoothed trend, weekly rate, goal ETA, estimated intake from burn vs trend, body fat |
| Trends | Any of ~30 daily metrics with 7/28-day averages, compare two metrics + correlation (same day or next day), 12-month heatmap, journal tag impact on next-night HRV / sleep / RHR / Body Battery |
| Day | Intraday heart rate, Body Battery, overnight HRV readings, SpO2, food log, raw JSON |
| Data | Bulk download of original activity FIT files for any range, **Export for Claude** (Markdown briefing + CSVs), full backup ZIP, live explorer for every Personal API endpoint |

**Garmin limits worth knowing:** the Personal API is pull-only. FIT cannot write weight, food or workouts back to Garmin, which is why workouts export as `.fit` files and weigh-ins logged here stay in FIT. Workouts: copy the `.fit` into `GARMIN/NewFiles` on the watch over USB, or import it at connect.garmin.com → Training → Workouts.

## Try it locally (2 minutes, fake data)

```bash
npm install
npm run demo        # http://localhost:8787, app key "dev"
```

With your real data:

```bash
GARMIN_API_KEY=your-key APP_SECRET=pick-a-long-random-string npm run dev
```

## Deploy (Azure, free tier, same as the vacation planner)

1. **Garmin key:** connect.garmin.com → Settings → Personal API (or go straight to `https://connect.garmin.com/app/settings/personalApiToken`) → Create Key → pick 1 year. Copy it now, it's shown once.
2. **Storage account:** Azure portal → Storage account → new, Standard LRS. Copy *Access keys → Connection string*.
3. **Static Web App:** Azure portal → Static Web App, Free plan, GitHub source = this repo, branch `main`, build preset Custom, app location `app`, api location `api`, output location empty. Azure commits its own deploy workflow to `.github/workflows/`; keep it. (`test.yml` is the separate test run.)
4. **Environment variables** (Static Web App → Settings → Environment variables):
   - `GARMIN_API_KEY` = key from step 1
   - `APP_SECRET` = a long random string (this is your login; `openssl rand -base64 32`)
   - `STORAGE_CONNECTION` = connection string from step 2
5. Open the site, enter `APP_SECRET`, Settings → choose how far back to pull → Save & sync. On iPhone: Share → Add to Home Screen.

The Garmin key expires (max 1 year). Garmin emails a week before. Make a new one and update `GARMIN_API_KEY`.

## How sync works

- Data types and per-call limits come from Garmin's Swagger spec: daily summaries 365 days/call, sleep 31, HRV 28, weight 90, activities paged 100 at a time.
- Each `/api/sync` call runs about 24 s (Azure's limit is 45 s): catch up to today, refresh the last 3 days (Garmin revises them), then walk backwards toward your backfill date, newest first. The app keeps calling while it's open until history is complete. A storage lease stops two devices syncing at once.
- Stored as JSON per year: `raw/<type>/<year>.json` (untouched Garmin responses), `days/<year>.json` (compact metrics the app reads), `act/<year>.json`, plus cached FIT originals in `fitfile/`.
- The browser caches everything in IndexedDB with ETag revalidation, so the app opens instantly and works offline.

## Security

All `/api` routes require the `x-app-key` header to match `APP_SECRET` (constant-time compare). The Garmin key never leaves the server. Static files are public (code only, no data). The raw explorer only proxies GETs to documented Personal API paths.

## Tests

```bash
npm test
```

Boots the dev server on mock data, backfills two years, opens every screen at phone size in dark and light mode, logs a lifting session, exports a workout FIT, checks auth, and fails on any JS error or horizontal overflow.
