// Lift hub: templates, active workout, history, progress per exercise, sets per muscle.
import { h, card, kpi, empty, toast, fmtDate, fmtDur, fmtInt, isNum, todayStr, addDays, weekStart, parseD, segmented } from '../ui.js';
import { LIFT, loadLift, saveDoc, exercise, allExercises, getActive, setActive, newSessionFrom, exerciseHistory, bests, sessionVolume, sessionSets, setsPerMuscle, toDisp, wLabel, uid } from '../lift.js';
import { MUSCLES } from '../exercises.js';
import { api, getKey } from '../api.js';
import { getUnits } from '../ui.js';
import { timeChart, barChart, chartBox, tok } from '../charts.js';
import { toFitTemplate } from './template.js';

export const STARTERS = [
  { name: 'Push', exercises: [['bench', 4, 6, 150], ['incline-db', 3, 10, 90], ['ohp', 3, 8, 120], ['lat-raise', 3, 15, 60], ['pushdown', 3, 12, 60]] },
  { name: 'Pull', exercises: [['deadlift', 3, 5, 180], ['pullup', 4, 8, 120], ['bb-row', 3, 10, 90], ['face-pull', 3, 15, 60], ['db-curl', 3, 12, 60]] },
  { name: 'Legs', exercises: [['squat', 4, 6, 180], ['rdl', 3, 10, 120], ['split-squat', 3, 10, 90], ['leg-curl', 3, 12, 60], ['calf', 4, 12, 60]] },
  { name: 'Full Body', exercises: [['squat', 3, 8, 150], ['bench', 3, 8, 120], ['bb-row', 3, 10, 90], ['plank', 3, 0, 60]] },
];

export function starterTemplate(s) {
  return { id: uid(), name: s.name, sport: 'strength', exercises: s.exercises.map(([ex, n, reps, rest]) => ({ ex, rest, sets: Array.from({ length: n }, () => (exercise(ex).kind === 't' ? { sec: 45 } : { reps })) })) };
}

export async function downloadWorkoutFit(tpl) {
  tpl = toFitTemplate(tpl);
  const body = { ...tpl, units: getUnits() };
  if (tpl.exercises) body.exercises = tpl.exercises.map((te) => { const d = exercise(te.ex); return { ...te, name: d.name, cat: d.cat, fit: d.fit }; });
  const res = await fetch('/api/workout/fit', { method: 'POST', headers: { 'x-app-key': getKey(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) { let m = 'HTTP ' + res.status; try { m = (await res.json()).error; } catch { /* */ } throw new Error(m); }
  const url = URL.createObjectURL(await res.blob());
  const a = h('a', { href: url, download: (tpl.name || 'workout').replace(/[^\w\- ]+/g, '').replace(/\s+/g, '_') + '.fit' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

let progressEx = null;
let tab = 'workouts';

export async function render(root) {
  root.append(h('header', { class: 'page-head' }, h('h1', null, 'Lift')));
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  root.append(h('div', { class: 'controls' }, segmented([['workouts', 'Workouts'], ['history', 'History'], ['progress', 'Progress']], tab, (v) => { tab = v; draw(); })), body);
  try { await loadLift(); } catch (e) { body.replaceChildren(card(null, empty('Could not load: ' + e.message))); return; }
  if (!root.isConnected) return;
  draw();

  function draw() {
    body.replaceChildren();
    if (tab === 'workouts') workouts(body);
    else if (tab === 'history') history(body);
    else progress(body);
  }
}

function workouts(body) {
  const active = getActive();
  if (active) {
    body.append(h('section', { class: 'card active-banner' },
      h('div', null, h('strong', null, active.name), h('div', { class: 'muted small' }, `In progress · started ${fmtDur((Date.now() - active.start) / 1000, { short: true })} ago`)),
      h('a', { class: 'btn', href: '#/lift/session' }, 'Resume')));
  }
  body.append(h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: () => start(null) }, 'Start empty workout'),
    h('a', { class: 'btn ghost', href: '#/lift/edit/new' }, '+ Strength template'),
    h('a', { class: 'btn ghost', href: '#/lift/edit/new-cardio' }, '+ Run/ride intervals')));

  const tpls = LIFT.lift.templates || [];
  if (!tpls.length) {
    body.append(card('Start from a template', h('p', { class: 'muted small' }, 'Add a starter split, then edit it to match your program.'),
      h('div', { class: 'actions' }, STARTERS.map((s) => h('button', { class: 'btn ghost', onclick: async () => { LIFT.lift.templates.push(starterTemplate(s)); await saveDoc('lift'); workoutsRedraw(body); } }, '+ ' + s.name)))));
  }
  const list = h('div', { class: 'tpl-grid' });
  for (const t of tpls) {
    const lastDone = LIFT.sessions.sessions.filter((s) => s.templateId === t.id).sort((a, b) => b.start - a.start)[0];
    list.append(h('div', { class: 'tpl card' },
      h('div', { class: 'tpl-head' }, h('strong', null, t.name), h('span', { class: 'muted small' }, t.sport === 'strength' ? `${t.exercises?.length || 0} exercises` : t.sport)),
      t.exercises ? h('div', { class: 'muted small tpl-ex' }, t.exercises.map((e) => `${e.sets.length}× ${exercise(e.ex).name}`).join(' · ')) : h('div', { class: 'muted small' }, cardioSummary(t)),
      h('div', { class: 'muted small' }, lastDone ? 'Last: ' + fmtDate(new Date(lastDone.start).toISOString().slice(0, 10)) : 'Not done yet'),
      h('div', { class: 'actions' },
        t.sport === 'strength' ? h('button', { class: 'btn small', onclick: () => start(t) }, 'Start') : null,
        h('a', { class: 'btn ghost small', href: `#/lift/edit/${t.id}` }, 'Edit'),
        h('button', { class: 'btn ghost small', onclick: () => downloadWorkoutFit(t).catch((e) => toast(e.message)) }, '⌚ .fit'))));
  }
  if (tpls.length) body.append(list);
  body.append(h('p', { class: 'muted small' }, '⌚ .fit = workout file for your watch. Garmin\'s Personal API can\'t push workouts, so copy the file into GARMIN/NewFiles on the watch over USB, or import it at connect.garmin.com → Training → Workouts.'));

  const recent = [...LIFT.sessions.sessions].sort((a, b) => b.start - a.start).slice(0, 5);
  if (recent.length) body.append(card('Recent', h('div', { class: 'list' }, recent.map(sessionRow))));
}
function workoutsRedraw(body) { body.replaceChildren(); workouts(body); }

export function cardioSummary(t) {
  const c = t.cardio || {};
  return `${c.warmupSec ? fmtDur(c.warmupSec, { short: true }) + ' warm-up · ' : ''}${c.repeats || 1}× ${c.work?.type === 'distance' ? c.work.value + ' m' : fmtDur(c.work?.value || 0, { short: true })}${c.recoverSec ? ' / ' + fmtDur(c.recoverSec, { short: true }) + ' easy' : ''}${c.cooldownSec ? ' · cool-down' : ''}`;
}

function start(tpl) {
  if (getActive() && !confirm('A workout is already in progress. Replace it?')) return;
  setActive(newSessionFrom(tpl));
  location.hash = '#/lift/session';
}

function sessionRow(s) {
  const d = new Date(s.start).toISOString().slice(0, 10);
  return h('a', { class: 'row', href: `#/lift/log/${s.id}` },
    h('span', { class: 'row-icon', 'aria-hidden': 'true' }, '🏋️'),
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, s.name), h('span', { class: 'row-sub' }, `${fmtDate(d, { weekday: true })} · ${s.end ? fmtDur((s.end - s.start) / 1000, { short: true }) : ''} · ${sessionSets(s)} sets`)),
    h('span', { class: 'row-end' }, `${fmtInt(toDisp(sessionVolume(s)))} ${wLabel()}`, h('span', { class: 'muted small' }, 'volume')));
}

function history(body) {
  const all = [...LIFT.sessions.sessions].sort((a, b) => b.start - a.start);
  if (!all.length) { body.append(card(null, empty('No workouts logged yet.'))); return; }
  const t = todayStr();
  const weeks = [];
  for (let i = 11; i >= 0; i--) weeks.push(addDays(weekStart(t), -7 * i));
  const c = chartBox(160, 'Workouts per week');
  body.append(card('Sessions per week', c.box), card(`All workouts (${all.length})`, h('div', { class: 'list' }, all.slice(0, 100).map(sessionRow))));
  requestAnimationFrame(() => barChart(c.canvas, weeks, [{ label: 'Workouts', data: weeks.map((w) => all.filter((s) => { const d = new Date(s.start).toISOString().slice(0, 10); return d >= w && d < addDays(w, 7); }).length), color: tok('series-1') }], { legend: false, xLabels: (w) => `${+w.slice(5, 7)}/${+w.slice(8)}`, titleFmt: (w) => 'Week of ' + fmtDate(w) }));
}

function progress(body) {
  const used = new Map();
  for (const s of LIFT.sessions.sessions) for (const ex of s.exercises || []) used.set(ex.ex, (used.get(ex.ex) || 0) + 1);
  if (!used.size) { body.append(card(null, empty('Log a few workouts to see progress.'))); return; }
  const ids = [...used.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  if (!progressEx || !used.has(progressEx)) progressEx = ids[0];

  // weekly hard sets per muscle (last 7 days) with 10–20 guideline
  const now = Date.now();
  const m = setsPerMuscle(now - 7 * 864e5, now);
  const c0 = chartBox(220, 'Hard sets per muscle, last 7 days');
  body.append(card('Sets per muscle (last 7 days)', h('p', { class: 'muted small' }, 'Primary muscle counts 1, secondary 0.5. Roughly 10–20 hard sets per muscle per week is the evidence-based range for growth.'), c0.box));

  const sel = h('select', { 'aria-label': 'Exercise', onchange: (e) => { progressEx = e.target.value; body.replaceChildren(); progress(body); } },
    ids.map((id) => h('option', { value: id, selected: id === progressEx }, exercise(id).name)));
  const hist = exerciseHistory(progressEx);
  const b = bests(progressEx);
  const byDay = new Map();
  for (const x of hist) {
    const cur = byDay.get(x.date) || { e1rm: 0, top: 0, vol: 0 };
    cur.e1rm = Math.max(cur.e1rm, x.e1rm); cur.top = Math.max(cur.top, x.kg); cur.vol += x.kg * x.reps;
    byDay.set(x.date, cur);
  }
  const days = [...byDay.keys()].sort();
  const c1 = chartBox(200, 'Estimated 1RM'), c2 = chartBox(160, 'Volume');
  body.append(card('Exercise progress', sel,
    h('div', { class: 'kpis' }, kpi('Est. 1RM', b.e1rm ? `${toDisp(b.e1rm)} ${wLabel()}` : '–'), kpi('Heaviest', b.weight ? `${toDisp(b.weight)} ${wLabel()}` : '–'), kpi('Best set', b.setVolume ? `${fmtInt(toDisp(b.setVolume))} ${wLabel()}` : '–', 'weight × reps'), kpi('Sessions', used.get(progressEx))),
    days.length > 1 ? c1.box : h('p', { class: 'muted small' }, 'Charts appear after two sessions.'), days.length > 1 ? c2.box : null));

  requestAnimationFrame(() => {
    const ms = MUSCLES.filter((x) => m[x]);
    barChart(c0.canvas, MUSCLES, [{ label: 'Sets', data: MUSCLES.map((x) => m[x] || 0), color: MUSCLES.map((x) => ((m[x] || 0) >= 10 ? tok('series-1') : tok('seq-250'))) }], { horizontal: true, legend: false, yFmt: (v) => `${(+v).toFixed(1).replace(/\.0$/, '')}`, xLabels: (l) => l });
    void ms;
    if (days.length > 1) {
      timeChart(c1.canvas, days, [{ label: 'Est. 1RM', data: days.map((d) => toDisp(byDay.get(d).e1rm) || null), color: tok('series-1'), kind: 'dots' }, { label: 'Top set', data: days.map((d) => toDisp(byDay.get(d).top) || null), color: tok('series-2') }], { yFmt: (v) => `${Math.round(v)} ${wLabel()}` });
      timeChart(c2.canvas, days, [{ label: 'Volume', kind: 'bar', data: days.map((d) => toDisp(byDay.get(d).vol)), color: tok('series-3') }], { yFmt: (v) => fmtInt(v), legend: false });
    }
  });
}

// Read-only view of a logged session (with delete).
export async function renderLog(root, id) {
  await loadLift();
  const s = LIFT.sessions.sessions.find((x) => x.id === id);
  root.append(h('a', { class: 'back', href: '#/lift' }, '← Lift'));
  if (!s) { root.append(card(null, empty('Workout not found.'))); return; }
  const d = new Date(s.start).toISOString().slice(0, 10);
  root.append(h('header', { class: 'page-head' }, h('div', null, h('h1', null, s.name), h('div', { class: 'sub' }, `${fmtDate(d, { weekday: true, year: true })} · ${s.end ? fmtDur((s.end - s.start) / 1000, { short: true }) : ''}`))));
  root.append(h('div', { class: 'kpis' }, kpi('Volume', `${fmtInt(toDisp(sessionVolume(s)))} ${wLabel()}`), kpi('Hard sets', sessionSets(s)), kpi('Exercises', s.exercises.length)));
  for (const ex of s.exercises) {
    const def = exercise(ex.ex);
    root.append(card(def.name, ex.notes ? h('p', { class: 'muted small' }, ex.notes) : null, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Set'), h('th', null, def.kind === 't' ? 'Time' : 'Weight'), h('th', null, def.kind === 't' ? '' : 'Reps'), h('th', null, 'RIR'), h('th', null, 'e1RM'))),
      h('tbody', null, ex.sets.map((st, i) => h('tr', null, h('td', null, st.type === 'w' ? 'W' : st.type === 'd' ? 'D' : st.type === 'f' ? 'F' : i + 1),
        h('td', null, def.kind === 't' ? fmtDur(st.sec || 0) : `${toDisp(st.kg) || 0} ${wLabel()}`), h('td', null, def.kind === 't' ? '' : st.reps ?? '–'), h('td', null, isNum(st.rir) ? st.rir : '–'),
        h('td', null, st.kg && st.reps ? `${toDisp(st.kg * (1 + st.reps / 30))}` : '–')))))));
  }
  root.append(h('div', { class: 'actions' }, h('button', { class: 'btn danger', onclick: async () => {
    if (!confirm('Delete this workout?')) return;
    LIFT.sessions.sessions = LIFT.sessions.sessions.filter((x) => x.id !== id);
    await saveDoc('sessions'); location.hash = '#/lift';
  } }, 'Delete workout')));
}

export { allExercises, parseD };
