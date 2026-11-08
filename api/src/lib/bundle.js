// "Export for Claude" bundle for one activity: original FIT + full parsed JSON + CSVs + a README
// that explains every column, so an analyst (human or Claude) can work from the zip alone.
'use strict';

const { zipSync, strToU8 } = require('fflate');
const { parseActivityFile, extractFit } = require('./fit');

const r = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : '');
const csv = (header, rows) => {
  const esc = (v) => (v === undefined || v === null || v === '' ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [header.join(','), ...rows.map((row) => row.map(esc).join(','))].join('\n') + '\n';
};
const mmss = (sec) => { sec = Math.round(sec || 0); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };

// Local time offset (ms) from Garmin's paired local/GMT start strings, e.g. "2026-11-07 17:04:22" / "2026-11-08 01:04:22".
function utcOffsetMs(local, gmt) {
  if (!local || !gmt) return 0;
  const a = Date.parse(String(local).replace(' ', 'T') + 'Z'), b = Date.parse(String(gmt).replace(' ', 'T') + 'Z');
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : 0;
}
const fmtLocal = (ms, off) => new Date(ms + off).toISOString().replace('T', ' ').slice(0, 19);

async function buildActivityBundle({ id, zip, summary = {}, detail = null }) {
  const fit = await parseActivityFile(zip, { full: true, maxPoints: Infinity });
  const fitBytes = extractFit(zip);
  const s = fit.session || {};
  const sd = detail?.summaryDTO || {};
  const startLocal = summary.start || sd.startTimeLocal || '';
  const startGMT = summary.startGMT || sd.startTimeGMT || '';
  const off = utcOffsetMs(startLocal, startGMT);
  const name = summary.name || detail?.activityName || `Activity ${id}`;
  const type = summary.type || detail?.activityTypeDTO?.typeKey || s.sport || 'activity';
  const recs = fit.records || [];
  const t0 = recs.length ? Date.parse((fit.messages?.recordMesgs?.[0]?.timestamp) || 0) : NaN;
  const first = recs.find((p) => p.lat !== null && p.lon !== null) || {};
  const cosLat = Math.cos(((first.lat || 0) * Math.PI) / 180);

  const records = csv(
    ['t_sec', 'time_utc', 'time_local', 'lat', 'lon', 'x_m', 'y_m', 'dist_m', 'dist_mi', 'speed_mps', 'speed_mph', 'pace_min_per_mi', 'heart_rate_bpm', 'alt_m', 'alt_ft', 'cadence', 'power_w', 'temp_c', 'temp_f'],
    recs.map((p) => {
      const ms = Number.isFinite(t0) ? t0 + p.t * 1000 : NaN;
      const hasPos = p.lat !== null && p.lon !== null;
      return [p.t, Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 19) + 'Z' : '', Number.isFinite(ms) ? fmtLocal(ms, off) : '',
        hasPos ? p.lat : '', hasPos ? p.lon : '',
        hasPos ? r((p.lon - first.lon) * 111320 * cosLat, 2) : '', hasPos ? r((p.lat - first.lat) * 110540, 2) : '',
        p.dist ?? '', p.dist !== null ? r(p.dist / 1609.344, 4) : '', p.spd ?? '', p.spd !== null ? r(p.spd * 2.23694, 2) : '', p.spd > 0.3 ? r(1609.344 / p.spd / 60, 2) : '',
        p.hr ?? '', p.alt ?? '', p.alt !== null ? r(p.alt * 3.28084, 1) : '', p.cad ?? '', p.pwr ?? '', p.temp ?? '', p.temp !== null ? r(p.temp * 9 / 5 + 32, 1) : ''];
    }));

  const laps = csv(['lap', 'duration_sec', 'duration', 'dist_m', 'dist_mi', 'avg_speed_mps', 'avg_speed_mph', 'avg_hr', 'max_hr', 'avg_cadence', 'avg_power_w', 'ascent_m'],
    (fit.laps || []).map((l) => [l.n, l.dur, mmss(l.dur), l.dist ?? '', l.dist !== null ? r(l.dist / 1609.344, 3) : '', l.spd ?? '', l.spd !== null ? r(l.spd * 2.23694, 2) : '', l.avgHR ?? '', l.maxHR ?? '', l.cad ?? '', l.pwr ?? '', l.elev ?? '']));

  const sets = (fit.sets || []).length ? csv(['set', 'exercise_category', 'reps', 'weight_kg', 'weight_lb', 'duration_sec'],
    fit.sets.map((st, i) => [i + 1, st.cat ?? '', st.reps ?? '', st.kg ?? '', st.kg ? r(st.kg * 2.20462, 1) : '', st.dur ?? ''])) : null;

  const session = csv(
    ['activity_id', 'name', 'type', 'sport', 'sub_sport', 'device', 'firmware', 'start_local', 'start_utc', 'elapsed_sec', 'timer_sec', 'dist_m', 'dist_mi', 'avg_speed_mph', 'max_speed_mph', 'avg_hr', 'max_hr', 'min_hr', 'calories', 'ascent_m', 'descent_m', 'avg_temp_c', 'aerobic_te', 'anaerobic_te', 'training_load', 'vo2max', 'z1_sec', 'z2_sec', 'z3_sec', 'z4_sec', 'z5_sec', 'user_max_hr', 'user_resting_hr', 'user_weight_kg', 'gps_points'],
    [[id, name, type, s.sport ?? '', s.subSport ?? '', s.device ?? '', s.firmware ?? '', startLocal, startGMT, s.elapsed ?? '', s.timer ?? '', s.dist ?? '', s.dist ? r(s.dist / 1609.344, 3) : '',
      s.avgSpeed ? r(s.avgSpeed * 2.23694, 2) : '', s.maxSpeed ? r(s.maxSpeed * 2.23694, 2) : '', s.avgHr ?? '', s.maxHr ?? '', s.minHr ?? '', s.calories ?? '', s.totalAscent ?? '', s.totalDescent ?? '', s.avgTemp ?? '',
      s.aerobicTE ?? summary.teAer ?? '', s.anaerobicTE ?? summary.teAna ?? '', summary.load ?? '', summary.vo2 ?? '', ...(s.hrZoneSec || summary.hrz || ['', '', '', '', '']), s.userMaxHr ?? '', s.userRestingHr ?? '', s.userWeightKg ?? '', (fit.track || []).length]]);

  const b = s.hrZoneBounds || [];
  const below = s.hrZoneSecBelow;
  const zones = s.hrZoneSec && b.length >= 6
    ? [`  - below Z1 (<${b[0] + 1} bpm): ${mmss(below || 0)}`, ...s.hrZoneSec.map((sec, i) => `  - Z${i + 1} (${b[i] + 1}–${b[i + 1]} bpm): ${mmss(sec)}`)].join('\n')
    : '  - not recorded';
  const readme = `# Garmin activity ${id}: ${name}

Exported from FIT (personal Garmin dashboard) on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. Everything here comes from the original device file, decoded with Garmin's FIT SDK. Metric columns are the source of truth; imperial columns are conveniences.

## Files
| File | What it is |
|---|---|
| \`${id}_ACTIVITY.fit\` | Original device file, untouched. |
| \`fit-parsed.json\` | Full decode: session, laps, every record (${recs.length}), events, device info, user profile, HR zones, developer fields. \`messageCounts\` lists every message type in the file. |
| \`records.csv\` | One row per record (usually one per second) with GPS, speed, heart rate, altitude, cadence, power, temperature. |
| \`laps.csv\` | One row per lap/split as the watch recorded them (${(fit.laps || []).length}). |
${sets ? '| `sets.csv` | Strength sets: exercise category, reps, weight, duration. |\n' : ''}| \`session.csv\` | One-row summary. |

## Activity facts
- Type: ${type} (FIT sport ${s.sport ?? '?'} / ${s.subSport ?? '?'}${s.profileName ? `, profile "${s.profileName}"` : ''})
- Device: ${s.device ?? 'Garmin'}${s.firmware ? `, firmware ${s.firmware}` : ''}
- Start: ${startLocal || '?'} local (${startGMT || '?'} UTC)${off ? `, UTC offset ${off / 3600000} h` : ''}
- Elapsed ${mmss(s.elapsed)}, timer ${mmss(s.timer)}${s.elapsed && s.timer && s.elapsed - s.timer > 1 ? ` (${mmss(s.elapsed - s.timer)} paused)` : ''}
- Distance: ${s.dist ? `${s.dist} m = ${r(s.dist / 1609.344, 2)} mi` : 'none'}
- Speed: avg ${s.avgSpeed ? `${s.avgSpeed} m/s (${r(s.avgSpeed * 2.23694, 2)} mph)` : '–'}, max ${s.maxSpeed ? `${s.maxSpeed} m/s (${r(s.maxSpeed * 2.23694, 2)} mph)` : '–'}
- Heart rate: avg ${s.avgHr ?? '–'}, min ${s.minHr ?? '–'}, max ${s.maxHr ?? '–'} bpm${s.userMaxHr ? ` (user max ${s.userMaxHr}, resting ${s.userRestingHr ?? '–'})` : ''}
- Time in HR zones:
${zones}
- Calories: ${s.calories ?? '–'}; ascent ${s.totalAscent ?? 0} m, descent ${s.totalDescent ?? 0} m; temperature avg ${s.avgTemp ?? '–'} °C
- Training effect: aerobic ${s.aerobicTE ?? summary.teAer ?? '–'}, anaerobic ${s.anaerobicTE ?? summary.teAna ?? '–'}${summary.load ? `; training load ${summary.load}` : ''}${summary.vo2 ? `; VO2max estimate ${summary.vo2}` : ''}
- Streams present: ${Object.keys(fit.streams || {}).filter((k) => k !== 't').join(', ') || 'none'}; GPS points: ${(fit.track || []).length}

## records.csv columns
| column | meaning |
|---|---|
| t_sec | seconds since the first record |
| time_utc, time_local | timestamp in UTC and in the watch's local time |
| lat, lon | decimal degrees (FIT semicircles × 180 / 2³¹) |
| x_m, y_m | meters east / north of the first GPS point (equirectangular) |
| dist_m, dist_mi | cumulative distance from the device |
| speed_mps, speed_mph | device speed (enhanced_speed) |
| pace_min_per_mi | 1609.344 / speed / 60, blank when nearly stopped |
| heart_rate_bpm | wrist or strap heart rate |
| alt_m, alt_ft | barometric altitude |
| cadence | steps/min ÷ 2 for running (FIT stores one foot), rpm for cycling |
| power_w | watts, when a power source was present |
| temp_c, temp_f | watch temperature (skin-warmed, reads high) |

Blank cells mean the device did not record that field at that moment.

## Notes for analysis
- Speed and distance are what the watch computed; GPS points were also recorded at ${recs.length ? r(recs.length / Math.max(1, s.timer || s.elapsed || recs.length), 2) : '?'} Hz on average.
- Heart rate zones use the user's settings at the time (max HR ${s.userMaxHr ?? '?'}).
- \`fit-parsed.json\` → \`messages.recordMesgs\` has the raw per-record values, including anything not mapped to a CSV column.
`;

  const files = {
    'README.md': strToU8(readme),
    [`${id}_ACTIVITY.fit`]: fitBytes,
    'fit-parsed.json': strToU8(JSON.stringify({ id, name, type, startLocal, startGMT, session: fit.session, laps: fit.laps, sets: fit.sets, messageCounts: fit.messageCounts, messages: fit.messages, garminSummary: summary, garminDetail: detail }, null, 1)),
    'records.csv': strToU8(records),
    'laps.csv': strToU8(laps),
    'session.csv': strToU8(session),
  };
  if (sets) files['sets.csv'] = strToU8(sets);
  const safe = String(name).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'activity';
  return { buffer: Buffer.from(zipSync(files, { level: 6 })), filename: `${(startLocal || '').slice(0, 10) || 'activity'}_${safe}_${id}.zip` };
}

module.exports = { buildActivityBundle };
