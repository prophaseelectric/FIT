# Shortcut: MF Push

Builds `state.json` from Apple Health + `mf-static.json` and PUTs it to the blob.
Shortcuts can't be reliably authored as files, so build it by hand from this list.
Variable names in **bold** are what you rename each action's output to.

## Before you start (one time)
- Health app > Browse > Nutrition > **Water** > Unit: **mL**. Body Measurements > Weight: **lb**.
  Find Health Samples returns values in your preferred unit, so this saves conversions.
- Put `mf-static.json` (see `mf-static.example.json`) in iCloud Drive `/Shortcuts/`.

## Actions
1. **Text**: paste `WRITE_SAS_URL` from `.env` → **SasUrl**
2. **Get File** from iCloud Drive, path `Shortcuts/mf-static.json`, Error If Not Found on.
   **Get Dictionary from Input** → **Static**
3. **Current Date** → **Now**. **Format Date** Now, Custom `yyyy-MM-dd` → **Today**.
   **Format Date** Now, ISO 8601, include time → **Updated**
4. For each of Dietary Energy, Protein, Carbohydrates, Total Fat, Water:
   - **Find Health Samples** where Type is _X_ and Start Date is today. Sort none, Limit off.
   - **Get Details of Health Sample**: Value.
   - **Calculate Statistics**: Sum. **Round Number**: Ones → **Kcal / P / C / F / WaterMl**
   (Empty day: Sum returns 0 or nothing. Wrap in **If has any value**, else use 0.)
5. **Find Health Samples** Type Weight, Sort by Start Date Latest First, Limit 1.
   Get Details: Value → **Scale**. Get Details: Start Date, Format `yyyy-MM-dd` → **ScaleDate**
6. Week (last 7 full days, oldest first):
   - **Repeat** 7 times: **Adjust Date** Now subtract (8 − Repeat Index) days → D.
     Repeat step 4 for Dietary Energy, Protein, Carbohydrates, Total Fat with Start Date **is** D.
     **Dictionary** `{ d: <D formatted MM-dd>, kcal, p, c, f }` (all Number type).
   - End Repeat → **Week** (a list of 7 dictionaries).
   - Optional speed-up: this is 28 Health queries per run. Cache Week to
     `Shortcuts/mf-week-cache.json` with its date, and only rebuild when the date changed.
7. **Dictionary** → **State**. Set field types explicitly (Number, not Text; text breaks math on the watch):
   ```
   v: 1                        (Number)
   date: Today                 (Text)
   updated: Updated            (Text)
   targets: Static.targets     (Dictionary)
   consumed: { kcal: Kcal, p: P, c: C, f: F }   (Dictionary of Numbers)
   water_ml: WaterMl           (Number)
   weight: { scale: Scale, scale_date: ScaleDate,
             trend, expenditure, goal, eta from Static.weight }
   week: Week                  (Array)
   staples: Static.staples     (Array)
   ```
8. **Get Contents of URL**
   - URL: SasUrl. Method: **PUT**.
   - Headers:
     - `x-ms-blob-type`: `BlockBlob`
     - `x-ms-blob-content-type`: `application/json`  (this is what Azure stores and serves back)
     - `x-ms-blob-cache-control`: `no-cache`
     - `Content-Type`: `application/json`
   - Request Body: **File** → State.
   Azure returns 201 with an empty body on success.

## Automations (Shortcuts > Automation > +, all "Run Immediately", notifications off)
- App: **MacroFactor** is **Closed** → Run MF Push.
- Time of Day: 07:00, 10:00, 12:30, 15:00, 18:00, 20:00, 22:00 → Run MF Push (7 automations).

## Verify
```
python3 tools/check_state.py "$READ_SAS_URL"
```
Must print OK. A WARN about strings means a Dictionary field is typed Text; fix it in step 7.
