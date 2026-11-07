// More: sync & backfill, preferences, exports (bulk FIT, Claude bundle, full backup), raw API explorer.
import { h, card, toast, todayStr, addDays, ago, fmtDate, fmtDur, fmtDist, fmtW, fmtInt, isNum, typeLabel, setUnits, getUnits, imperial, fromW, toW, wUnit, mean, sum } from '../ui.js';
import { DB, runSync, syncState, onChange, savePrefs, loadAll, weightTrend, trainingLoad, actDate } from '../data.js';
import { api, getKey, setKey, cacheClear } from '../api.js';
import { LIFT, loadLift, exercise, sessionVolume, toDisp, wLabel } from '../lift.js';
import { DEFAULT_TAGS } from './today.js';
import { METRICS } from './trends.js';

export function renderMore(root) {
  root.append(h('header', { class: 'page-head' }, h('h1', null, 'More')));
  const links = [['#/body', '⚖️', 'Body & weight', 'Weigh-ins, trend, goal, body fat'], ['#/trends', '📈', 'Trends', 'Any metric, correlations, tag impact'], ['#/day/' + todayStr(), '📅', 'Day detail', 'Intraday HR, Body Battery, HRV readings'], ['#/data', '📦', 'Data & export', 'FIT files, Export for Claude, raw API'], ['#/settings', '⚙️', 'Settings & sync', 'Backfill, units, goals, app key']];
  root.append(h('div', { class: 'list card' }, links.map(([href, i, t, s]) => h('a', { class: 'row', href }, h('span', { class: 'row-icon' }, i), h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t), h('span', { class: 'row-sub' }, s)), h('span', { class: 'row-end' }, '›')))));
}

export function renderSettings(root) {
  root.append(h('header', { class: 'page-head' }, h('h1', null, 'Settings & sync')));
  const st = DB.status || {};
  const syncBox = h('div');
  const drawSync = () => {
    const s = syncState.last || st.sync || {};
    syncBox.replaceChildren(
      h('p', null, st.mock ? h('strong', null, 'Demo mode: showing generated data. ') : null, `Last sync ${ago(s.lastSync)}${syncState.running ? ' · syncing now…' : ''}`),
      syncState.error || s.lastError ? h('p', { class: 'error' }, syncState.error || s.lastError?.message) : null,
      h('div', { class: 'progress-list' }, Object.values(s.types || {}).map((ty) => h('div', { class: 'prog' },
        h('span', null, ty.label), h('progress', { max: 100, value: ty.pct }), h('span', { class: 'muted small' }, ty.oldest ? `${fmtDate(ty.oldest, { year: true })} → ${ty.newest ? fmtDate(ty.newest) : ''}` : 'not started')))),
      h('p', { class: 'muted small' }, `${fmtInt(s.calls)} Garmin API calls so far.`));
  };
  drawSync();
  const off = onChange((w) => { if (!root.isConnected) return off(); if (w === 'sync') drawSync(); });

  const from = h('input', { type: 'date', value: st.sync?.from || addDays(todayStr(), -365), max: todayStr(), 'aria-label': 'Backfill from' });
  root.append(card('Garmin sync', syncBox,
    h('label', { class: 'field' }, h('span', null, 'Pull history back to'), from),
    h('p', { class: 'muted small' }, 'FIT pulls newest data first, then walks back to this date in the background while the app is open. Go back as far as you like; Garmin keeps years.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => runSync({ from: from.value }).then(() => toast(syncState.error ? 'Sync error' : 'Sync complete')) }, 'Save & sync'),
      h('button', { class: 'btn ghost', onclick: () => runSync({ force: true }) }, 'Re-pull last 3 days'))));

  const unitSel = h('select', { onchange: async (e) => { setUnits(e.target.value); await savePrefs({ units: e.target.value }); toast('Saved'); } },
    h('option', { value: 'imperial', selected: getUnits() === 'imperial' }, 'Imperial (lb, mi, ft)'), h('option', { value: 'metric', selected: getUnits() === 'metric' }, 'Metric (kg, km, m)'));
  const sleepT = h('input', { type: 'number', step: '0.25', min: 4, max: 12, value: DB.prefs.sleepTargetH || 7.5 });
  const stepG = h('input', { type: 'number', step: '500', min: 1000, value: DB.prefs.stepGoal || 10000 });
  const goalW = h('input', { type: 'number', step: '0.1', value: DB.prefs.goalKg ? toW(DB.prefs.goalKg).toFixed(1) : '', placeholder: wUnit() });
  const tags = h('input', { type: 'text', value: (DB.prefs.customTags || []).join(', '), placeholder: 'e.g. Creatine, Cold plunge, Late screen' });
  root.append(card('Preferences',
    h('label', { class: 'field' }, h('span', null, 'Units'), unitSel),
    h('label', { class: 'field' }, h('span', null, 'Sleep target (hours)'), sleepT),
    h('label', { class: 'field' }, h('span', null, 'Daily step goal'), stepG),
    h('label', { class: 'field' }, h('span', null, `Goal weight (${wUnit()})`), goalW),
    h('label', { class: 'field' }, h('span', null, 'Extra journal tags (comma separated)'), tags),
    h('p', { class: 'muted small' }, 'Built-in tags: ' + DEFAULT_TAGS.join(', ')),
    h('button', { class: 'btn', onclick: async () => {
      const g = parseFloat(goalW.value);
      await savePrefs({ sleepTargetH: parseFloat(sleepT.value) || 7.5, stepGoal: parseInt(stepG.value, 10) || 10000, goalKg: isNum(g) ? fromW(g) : null, customTags: tags.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20) });
      toast('Saved');
    } }, 'Save preferences')));

  const prof = st.profile;
  const fa = st.fitnessAge;
  root.append(card('Garmin profile', prof ? h('ul', { class: 'plain' },
    h('li', null, `Display name: ${prof.displayName ?? '–'}`), h('li', null, `Time zone: ${prof.timeZone ?? '–'}`), h('li', null, `Units in Garmin: ${prof.measurementSystem ?? '–'}`),
    fa ? h('li', null, `Fitness age: ${isNum(fa.fitnessAge) ? fa.fitnessAge.toFixed(1) : '–'} (actual ${fa.chronologicalAge ?? '–'}, achievable ${isNum(fa.achievableFitnessAge) ? fa.achievableFitnessAge.toFixed(1) : '–'})`) : null,
    (st.zones || []).map((z) => h('li', null, `HR zones (${String(z.sport || '').toLowerCase()}, ${z.trainingMethod}): Z1 ${z.zone1Floor} · Z2 ${z.zone2Floor} · Z3 ${z.zone3Floor} · Z4 ${z.zone4Floor} · Z5 ${z.zone5Floor} · max ${z.maxHeartRateUsed}`))) : h('p', { class: 'muted' }, 'Syncs on the first sync of each day.')));

  root.append(card('This device', h('p', { class: 'muted small' }, 'The app key lets this phone/browser read your data. Clearing it signs this device out.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn ghost', onclick: async () => { await cacheClear(); toast('Cache cleared'); await loadAll(); } }, 'Clear offline cache'),
      h('button', { class: 'btn danger ghost', onclick: async () => { if (!confirm('Sign this device out?')) return; setKey(''); await cacheClear(); location.reload(); } }, 'Sign out'))));
}

// ---------------------------------------------------------------- Data & export
export function renderData(root) {
  root.append(h('header', { class: 'page-head' }, h('h1', null, 'Data & export')));
  const t = todayStr();
  const from = h('input', { type: 'date', value: addDays(t, -29), max: t, 'aria-label': 'From' });
  const to = h('input', { type: 'date', value: t, max: t, 'aria-label': 'To' });
  const status = h('p', { class: 'muted small', role: 'status', 'aria-live': 'polite' });
  const prog = h('progress', { max: 100, value: 0, hidden: true });
  const typeSel = h('select', null, h('option', { value: '' }, 'All activity types'), [...new Set(DB.acts.map((a) => a.type))].sort().map((ty) => h('option', { value: ty }, typeLabel(ty))));

  root.append(card('Date range', h('div', { class: 'row-fields' }, from, to, typeSel),
    h('div', { class: 'actions' }, [['7d', 7], ['30d', 30], ['90d', 90], ['1y', 365]].map(([l, n]) => h('button', { class: 'btn ghost small', onclick: () => { from.value = addDays(t, -(n - 1)); to.value = t; } }, l)))));

  root.append(card('Activity FIT files (originals)',
    h('p', { class: 'muted small' }, 'The original files your watch recorded: every sensor channel, second by second, laps, sets, developer fields. This is the richest form of your data and what to hand to Claude (or any analysis tool) for deep dives.'),
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: () => bulkFit(from.value, to.value, typeSel.value, status, prog) }, 'Download FIT files (.zip)')),
    prog, status));

  root.append(card('Export for Claude',
    h('p', { class: 'muted small' }, 'One ZIP with a Markdown briefing (baselines, trends, training, sleep, lifting, journal), a daily-metrics CSV, an activities CSV and lifting sets CSV for the range. Attach it to a Claude chat and ask for coaching. Add the FIT zip above for second-by-second detail.'),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: () => claudeBundle(from.value, to.value, typeSel.value, status) }, 'Download Claude bundle'),
      h('button', { class: 'btn ghost', onclick: async () => { await navigator.clipboard.writeText(briefing(from.value, to.value)); toast('Briefing copied: paste it into Claude'); } }, 'Copy briefing text'))));

  root.append(card('Full backup', h('p', { class: 'muted small' }, 'Everything stored on your server: every raw Garmin response, cached FIT files, weigh-ins, journal, lifting. JSON inside a ZIP.'),
    h('button', { class: 'btn ghost', onclick: () => fetchDownload('/api/export', `fit-backup-${t}.zip`, status) }, 'Download full backup')));

  root.append(explorer());
}

async function fetchDownload(url, name, status) {
  status.textContent = 'Preparing…';
  try {
    const res = await fetch(url, { headers: { 'x-app-key': getKey() } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    saveBlob(await res.blob(), name);
    status.textContent = 'Done.';
  } catch (e) { status.textContent = 'Failed: ' + e.message; }
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function zipFiles(files) {
  const { zipSync, strToU8 } = await import('../../vendor/fflate.js');
  const out = {};
  for (const [k, v] of Object.entries(files)) out[k] = typeof v === 'string' ? strToU8(v) : v;
  return new Blob([zipSync(out, { level: 6 })], { type: 'application/zip' });
}

async function bulkFit(from, to, type, status, prog) {
  const acts = DB.acts.filter((a) => actDate(a) >= from && actDate(a) <= to && (!type || a.type === type) && !a.manual);
  if (!acts.length) { status.textContent = 'No activities in that range.'; return; }
  if (acts.length > 150 && !confirm(`${acts.length} activities. This downloads each one from Garmin (cached after the first time) and may take a few minutes. Continue?`)) return;
  const { unzipSync } = await import('../../vendor/fflate.js');
  const files = {};
  const failed = [];
  prog.hidden = false;
  let i = 0;
  for (const a of acts) {
    i++;
    status.textContent = `Downloading ${i} of ${acts.length}: ${a.name}`;
    prog.value = (i / acts.length) * 100;
    try {
      const res = await fetch(`/api/activity/file?id=${a.id}`, { headers: { 'x-app-key': getKey() } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = new Uint8Array(await res.arrayBuffer());
      const base = `${actDate(a)}_${a.start.slice(11, 16).replace(':', '')}_${a.type}_${a.id}`;
      try {
        const inner = unzipSync(buf);
        for (const [n, data] of Object.entries(inner)) files[`${base}${n.toLowerCase().endsWith('.fit') ? '.fit' : '_' + n}`] = data;
      } catch { files[base + '.fit'] = buf; }
    } catch (e) { failed.push(`${a.id} (${e.message})`); }
  }
  files['index.csv'] = csv(['file', 'id', 'date', 'type', 'name', 'distance_m', 'duration_s', 'avg_hr', 'max_hr', 'training_load', 'aerobic_te', 'anaerobic_te', 'vo2max'],
    acts.map((a) => [`${actDate(a)}_${a.start.slice(11, 16).replace(':', '')}_${a.type}_${a.id}.fit`, a.id, a.start, a.type, a.name, a.dist, a.dur, a.avgHR, a.maxHR, a.load, a.teAer, a.teAna, a.vo2]));
  if (failed.length) files['failed.txt'] = failed.join('\n');
  status.textContent = 'Zipping…';
  saveBlob(await zipFiles(files), `fit-activities-${from}_to_${to}.zip`);
  status.textContent = `Done: ${acts.length - failed.length} files${failed.length ? `, ${failed.length} failed (see failed.txt)` : ''}.`;
  prog.hidden = true;
}

function csv(header, rows) {
  const esc = (v) => (v === undefined || v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [header.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

function dayRows(from, to) {
  const keys = new Set();
  const rows = [];
  for (const [d, r] of DB.days) if (d >= from && d <= to) { rows.push([d, r]); Object.keys(r).forEach((k) => keys.add(k)); }
  const cols = [...keys].sort();
  return csv(['date', ...cols], rows.map(([d, r]) => [d, ...cols.map((k) => r[k])]));
}

function briefing(from, to) {
  const ds = [...DB.days.keys()].filter((d) => d >= from && d <= to);
  const avg = (k, f = (x) => x) => { const v = mean(ds.map((d) => DB.days.get(d)[k]).filter(isNum).map(f)); return isNum(v) ? v : undefined; };
  const n = (v, d = 1) => (isNum(v) ? (+v).toFixed(d) : 'n/a');
  const acts = DB.acts.filter((a) => actDate(a) >= from && actDate(a) <= to);
  const byType = {};
  for (const a of acts) { const b = (byType[a.type] ||= { n: 0, dur: 0, dist: 0, load: 0 }); b.n++; b.dur += a.dur || 0; b.dist += a.dist || 0; b.load += a.load || 0; }
  const tr = weightTrend();
  const wAt = (d) => tr.find((x) => x.date === d)?.trend;
  const tl = trainingLoad();
  const tlEnd = tl.find((x) => x.date === to) || tl[tl.length - 1];
  const lifts = (LIFT.sessions.sessions || []).filter((s) => { const d = new Date(s.start).toISOString().slice(0, 10); return d >= from && d <= to; });
  const lines = [];
  lines.push(`# FIT health & training briefing: ${from} to ${to}`, '', `Generated ${new Date().toISOString().slice(0, 16)} from Garmin data synced into my personal FIT app. Units: ${imperial() ? 'imperial' : 'metric'}. ${ds.length} days with data.`, '');
  lines.push('## Averages', `- Sleep: ${n(avg('sleepSec', (v) => v / 3600), 2)} h/night, score ${n(avg('sleepScore'), 0)}, deep ${n(avg('deepSec', (v) => v / 3600), 2)} h, REM ${n(avg('remSec', (v) => v / 3600), 2)} h`,
    `- Overnight HRV: ${n(avg('hrv'), 0)} ms; resting HR: ${n(avg('rhr'), 0)} bpm; sleeping HR ${n(avg('sleepHr'), 0)} bpm; breathing ${n(avg('sleepResp'), 1)} brpm`,
    `- Stress avg: ${n(avg('stressAvg'), 0)}; Body Battery high ${n(avg('bbMax'), 0)}, low ${n(avg('bbMin'), 0)}`,
    `- Steps: ${n(avg('steps'), 0)}/day; calories burned ${n(avg('calTotal'), 0)}/day (active ${n(avg('calActive'), 0)}); intensity minutes moderate ${n(avg('imMod'), 0)}, vigorous ${n(avg('imVig'), 0)} per day`, '');
  if (isNum(wAt(to))) lines.push('## Weight', `- Trend weight ${fmtW(wAt(to))} at end of range${isNum(wAt(from)) ? `, change ${n(toW(wAt(to) - wAt(from)), 1)} ${wUnit()} over the range` : ''}${DB.prefs.goalKg ? `; goal ${fmtW(DB.prefs.goalKg)}` : ''}`, '');
  lines.push('## Training', `- ${acts.length} activities. Acute load (7d EWMA) ${n(tlEnd?.acute, 0)}, chronic (28d) ${n(tlEnd?.chronic, 0)}, ratio ${n(tlEnd?.acwr, 2)}`);
  for (const [ty, b] of Object.entries(byType).sort((a, b) => b[1].dur - a[1].dur)) lines.push(`- ${typeLabel(ty)}: ${b.n}×, ${fmtDur(b.dur, { short: true })}${b.dist ? `, ${fmtDist(b.dist, 1)}` : ''}, load ${fmtInt(b.load)}`);
  lines.push('');
  if (lifts.length) {
    lines.push('## Lifting', `- ${lifts.length} sessions, total volume ${fmtInt(toDisp(sum(lifts.map(sessionVolume))))} ${wLabel()}`);
    const best = {};
    for (const s of lifts) for (const ex of s.exercises || []) for (const st of ex.sets || []) if (st.kg && st.reps) { const e = st.kg * (1 + st.reps / 30); if (!best[ex.ex] || e > best[ex.ex].e) best[ex.ex] = { e, st }; }
    for (const [id, b] of Object.entries(best)) lines.push(`- ${exercise(id).name}: best ${toDisp(b.st.kg)} ${wLabel()} × ${b.st.reps} (e1RM ${toDisp(b.e)})`);
    lines.push('');
  }
  const jr = Object.entries(DB.journal || {}).filter(([d]) => d >= from && d <= to);
  if (jr.length) { lines.push('## Journal tags'); for (const [d, e] of jr) lines.push(`- ${d}: ${(e.tags || []).join(', ')}${e.note ? ' — ' + e.note : ''}`); lines.push(''); }
  lines.push('## Daily detail (date | sleep h | score | HRV | RHR | stress | BB high | steps | load)');
  const loadBy = new Map(tl.map((x) => [x.date, x.load]));
  for (const d of ds) { const r = DB.days.get(d); lines.push(`${d} | ${n(r.sleepSec / 3600, 1)} | ${r.sleepScore ?? ''} | ${r.hrv ?? ''} | ${r.rhr ?? ''} | ${r.stressAvg ?? ''} | ${r.bbMax ?? ''} | ${r.steps ?? ''} | ${loadBy.get(d) ? Math.round(loadBy.get(d)) : ''}`); }
  lines.push('', '## Metric glossary', ...Object.entries(METRICS).map(([k, m]) => `- ${k}: ${m.label}`), '- *Sec fields are seconds; sleepStart/sleepEnd are wall-clock epoch ms; weight in kg; distM meters.');
  return lines.join('\n');
}

async function claudeBundle(from, to, type, status) {
  status.textContent = 'Building…';
  await loadLift().catch(() => {});
  const acts = DB.acts.filter((a) => actDate(a) >= from && actDate(a) <= to && (!type || a.type === type));
  const actCsv = csv(['id', 'start', 'type', 'name', 'distance_m', 'duration_s', 'moving_s', 'elev_gain_m', 'avg_hr', 'max_hr', 'calories', 'avg_speed_mps', 'cadence', 'avg_power', 'norm_power', 'aerobic_te', 'anaerobic_te', 'training_load', 'vo2max', 'z1_s', 'z2_s', 'z3_s', 'z4_s', 'z5_s', 'sets', 'reps'],
    acts.map((a) => [a.id, a.start, a.type, a.name, a.dist, a.dur, a.moving, a.elev, a.avgHR, a.maxHR, a.cal, a.avgSpeed, a.cadence, a.power, a.np, a.teAer, a.teAna, a.load, a.vo2, ...(a.hrz || [null, null, null, null, null]), a.sets, a.reps]));
  const liftRows = [];
  for (const s of LIFT.sessions.sessions || []) {
    const d = new Date(s.start).toISOString().slice(0, 10);
    if (d < from || d > to) continue;
    for (const ex of s.exercises || []) ex.sets.forEach((st, i) => liftRows.push([d, s.name, exercise(ex.ex).name, i + 1, st.type, st.kg ? +st.kg.toFixed(2) : '', st.reps ?? '', st.sec ?? '', st.rir ?? '']));
  }
  const files = {
    'README.md': briefing(from, to),
    'daily_metrics.csv': dayRows(from, to),
    'activities.csv': actCsv,
    'lifting_sets.csv': csv(['date', 'workout', 'exercise', 'set', 'type', 'weight_kg', 'reps', 'seconds', 'rir'], liftRows),
    'weigh_ins.csv': csv(['date', 'kg', 'body_fat_pct', 'source'], [...DB.days].filter(([d, r]) => d >= from && d <= to && isNum(r.weight)).map(([d, r]) => [d, r.weight, r.bodyFat, 'garmin']).concat(DB.weights.filter((e) => e.date >= from && e.date <= to).map((e) => [e.date, e.kg, e.fat, 'fit']))),
  };
  saveBlob(await zipFiles(files), `fit-for-claude-${from}_to_${to}.zip`);
  status.textContent = 'Done.';
}

// Raw explorer: every Personal API GET endpoint, so no datapoint is out of reach.
const ENDPOINTS = [
  ['/usersummary-service/usersummary/daily', { calendarDate: 'D' }],
  ['/usersummary-service/v2/dailysummaries', { startDate: 'D-6', endDate: 'D' }],
  ['/usersummary-service/stats/steps/daily/{D-6}/{D}', {}],
  ['/usersummary-service/stats/stress/daily/{D-6}/{D}', {}],
  ['/usersummary-service/stats/hydration/daily/{D-6}/{D}', {}],
  ['/sleep-service/sleep/dailySleep', { date: 'D' }],
  ['/sleep-service/sleep/dailySleepSummariesByDate', { startDate: 'D-6', endDate: 'D' }],
  ['/hrv-service/hrv/{D}', {}],
  ['/hrv-service/hrv/daily/{D-6}/{D}', {}],
  ['/wellness-service/wellness/dailyHeartRate', { date: 'D' }],
  ['/wellness-service/wellness/bodyBattery/reports/daily', { startDate: 'D-6', endDate: 'D', chunks: '' }],
  ['/wellness-service/wellness/daily/spo2acclimation/{D}', {}],
  ['/wellnessactivity-service/activity/summary/range/{D-6}/{D}', {}],
  ['/weight-service/weight/range/{D-30}/{D}', { includeAll: 'true' }],
  ['/weight-service/weight/all/{D-30}/{D}', {}],
  ['/goal-service/goal/user/effective/weightgoal/{D-30}/{D}', {}],
  ['/nutrition-service/food/logs/{D}', { includeMedia: 'false' }],
  ['/fitnessage-service/fitnessage/v2/{D}', { fullHistoryScan: '' }],
  ['/biometric-service/heartRateZones/v2', {}],
  ['/userprofile-service/userprofile/settings', {}],
  ['/activitylist-service/activities/search/activities', { start: '0', limit: '20', startDate: '', endDate: '', activityType: '', search: '', sortOrder: 'desc' }],
  ['/activity-service/activity/{activityId}', {}],
  ['/activity-service/activity/{activityId}/workouts', {}],
  ['/periodichealth-service/menstrualcycle/summary/{D}', {}],
  ['/periodichealth-service/menstrualcycle/dayview/{D}', { todayDate: 'D' }],
];

function explorer() {
  const out = h('pre', { class: 'json small' });
  const date = h('input', { type: 'date', value: todayStr(), max: todayStr() });
  const actId = h('input', { type: 'text', inputmode: 'numeric', placeholder: 'activity id', value: DB.acts[0]?.id ?? '' });
  const paramsBox = h('div', { class: 'fields' });
  const sel = h('select', { onchange: () => fillParams() }, ENDPOINTS.map(([p], i) => h('option', { value: i }, p)));
  const resolve = (v) => {
    const D = date.value;
    return String(v).replace(/\{?D-(\d+)\}?/g, (_, n) => addDays(D, -n)).replace(/\{?\bD\b\}?/g, D).replace('{activityId}', actId.value.trim());
  };
  function fillParams() {
    const [, params] = ENDPOINTS[sel.value];
    paramsBox.replaceChildren(...Object.entries(params).map(([k, v]) => h('label', { class: 'field' }, h('span', null, k), h('input', { 'data-k': k, value: resolve(v) }))));
  }
  fillParams();
  date.addEventListener('change', fillParams);
  const run = async () => {
    const [path] = ENDPOINTS[sel.value];
    const query = { path: resolve(path) };
    for (const inp of paramsBox.querySelectorAll('input')) if (inp.value) query[inp.dataset.k] = inp.value;
    out.textContent = 'Loading…';
    try {
      const r = await api('raw', { query });
      out.textContent = JSON.stringify(r, null, 2);
      out._data = r;
    } catch (e) { out.textContent = 'Error: ' + e.message + (e.body?.detail ? '\n' + e.body.detail : ''); }
  };
  return card('Raw Garmin API explorer',
    h('p', { class: 'muted small' }, 'Every endpoint in Garmin\'s Personal API, live. Anything FIT doesn\'t chart yet is here.'),
    h('label', { class: 'field' }, h('span', null, 'Endpoint'), sel),
    h('div', { class: 'row-fields' }, date, actId),
    paramsBox,
    h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: run }, 'Fetch'),
      h('button', { class: 'btn ghost', onclick: () => { if (out._data) saveBlob(new Blob([JSON.stringify(out._data, null, 2)], { type: 'application/json' }), 'garmin-' + ENDPOINTS[sel.value][0].split('/')[1] + '.json'); } }, 'Save JSON')),
    out);
}

export { mean };
