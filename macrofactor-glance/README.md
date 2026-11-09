# MacroFactor → Garmin: Nutrition Glance

Lives in the FIT repo but is independent of it: nothing here is deployed by FIT's Static Web Apps workflow. Run every command below from `macrofactor-glance/`.

MacroFactor nutrition on a Fenix glance, plus water/staple logging from the watch.
No MacroFactor API exists, so every hop is an official surface:
Apple Health → iOS Shortcuts → Azure Blob (static JSON) → Connect IQ widget, and
watch → Pushcut → Shortcut → MacroFactor's own Shortcuts actions.

```
infra/azure.sh                 one-time Azure setup (RG, storage, container, SAS via stored policies)
docs/state.example.json        v1 schema sample (also seeds the blob)
docs/macrofactor-shortcuts.md  Log by JSON schema: TO BE FILLED ON THE PHONE (Phase 4 blocker)
shortcuts/*.md                 step-by-step builds for MF Push, MF Nudge, MF Log
shortcuts/mf-static.example.json  template for iCloud Drive/Shortcuts/mf-static.json
tools/check_state.py           validate schema, numeric types, size, and Content-Type of the live blob
watch/                         Connect IQ widget + glance + complications (Monkey C)
```

## Phase 1: read path
1. **Azure**: `cp .env.example .env`, set `AZ_SUBSCRIPTION` (PROPHASE tenant), `az login`, then `./infra/azure.sh`.
   Check: `curl -sI "$READ_SAS_URL" | grep -i content-type` shows `application/json`.
2. **Phone**: put `mf-static.json` in iCloud Drive/Shortcuts, build **MF Push** (`shortcuts/MF-Push.md`), run it once.
   Check: `python3 tools/check_state.py "$READ_SAS_URL"` prints OK.
3. **Watch**: build and sideload (below), set the **Blob URL** setting, add the glance.

Done when the glance shows today's numbers within 10 min of logging in MacroFactor.

## Build and sideload
1. Install the Connect IQ SDK (SDK Manager) and the device for your watch. VS Code + Monkey C extension.
2. Open SDK Manager > Devices and confirm the product id. `watch/manifest.xml` ships with
   `fenix847mm` as a placeholder. Replace with the fenix 9 Pro id if listed, else the closest fenix 8 Pro id.
3. Developer key (never committed):
   ```
   openssl genrsa -out developer_key.pem 4096
   openssl pkcs8 -topk8 -inform PEM -outform DER -in developer_key.pem -out developer_key.der -nocrypt
   ```
4. Build:
   ```
   cd macrofactor-glance && monkeyc -f watch/monkey.jungle -d <device-id> -y developer_key.der -o bin/mf.prg
   ```
5. USB the watch, copy `bin/mf.prg` to `GARMIN/Apps/`, eject. It appears in the glance list after a rescan.
6. Settings: Garmin Connect app > Device > Activities & Apps > MF Nutrition > Settings.
   Paste `READ_SAS_URL` and (Phase 4) `PUSHCUT_URL`. Sideloaded apps sometimes don't expose settings in
   Garmin Connect; if so, use the simulator's App Settings Editor to write a `.SET` file into
   `GARMIN/Apps/SETTINGS/`, or temporarily hard-code defaults in `resources/settings/properties.xml`
   for a local-only build (never commit those).

`makeWebRequest` is stubbed in the simulator. First real network test is on the watch.

## Watch behavior
| Situation | What you see |
|---|---|
| Fresh data | kcal left, P/C/F grams left, bars red with `+N` when over |
| `updated` > 3 h old, or blob date ≠ today | grey values, "stale". After midnight consumed reads 0 until the first push |
| Phone out of range / airplane | last cached values + "stale", no crash |
| Blob 404 / no URL / SAS expired | "no data (404)" / "set Blob URL" / "SAS expired?" instead of the IQ triangle |
| Blob over the size limit | red "BLOB TOO BIG" (CIQ -402 or background exit overflow) |

Background temporal event every 15 min; opening the widget refetches if the cache is > 10 min old.
START on Today/Weight/Adherence forces a refresh. START on Log opens the menu.

## Phases
1. Read path: done in code, needs your Azure + Shortcut + sideload.
2. Pages + complication: in code. Complication resource XML is unverified (see below).
3. Nudges: `shortcuts/MF-Nudge.md`, phone-only.
4. Write-back: watch side in code. **Blocked** on documenting MacroFactor's Log by JSON
   (`docs/macrofactor-shortcuts.md`).

## Not verified (no SDK access when written)
- Never compiled. Expect a round of small compiler fixes on first build.
- Product id for fenix 9 Pro.
- `resources/complications/complications.xml` format and the `updateComplication` data keys.
  If it doesn't compile, delete that file and the `ComplicationPublisher` permission; everything else still works.
  Publishing from the glance process may be blocked by firmware; it also publishes from the full widget.
- Whether Storage is writable from the glance process. Code keeps an in-memory copy so it renders either way.
- Pushcut passing the webhook `input` field through to the Shortcut.

## Secrets
SAS URLs and the Pushcut URL live only in `.env`, the Shortcut, and watch settings. To revoke a leaked SAS,
delete the `watch-read` or `phone-write` stored access policy on the container and re-run
`./infra/azure.sh --new-sas`. No account key rotation needed.
