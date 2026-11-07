// Workout template editor. Strength: exercises x sets x reps/weight/rest.
// Cardio: warm-up, N x (work + recovery) with HR-zone or pace targets, cool-down. Both export to a watch .fit.
import { h, card, toast, fmtDur, imperial, isNum } from '../ui.js';
import { LIFT, loadLift, saveDoc, exercise, toDisp, fromDisp, wLabel, uid } from '../lift.js';
import { pickExercise } from './session.js';
import { downloadWorkoutFit } from './lift.js';

export async function render(root, id) {
  await loadLift().catch(() => {});
  const isNew = id === 'new' || id === 'new-cardio';
  let t = isNew
    ? (id === 'new' ? { id: uid(), name: 'New workout', sport: 'strength', exercises: [] } : { id: uid(), name: 'Intervals', sport: 'running', cardio: { warmupSec: 600, repeats: 6, work: { type: 'distance', value: 400 }, target: { type: 'hr', zone: 4 }, recoverSec: 90, cooldownSec: 600 } })
    : structuredClone(LIFT.lift.templates.find((x) => x.id === id) || {});
  root.append(h('a', { class: 'back', href: '#/lift' }, '← Lift'));
  if (!t.id) { root.append(card(null, h('p', null, 'Template not found.'))); return; }

  const body = h('div');
  root.append(h('header', { class: 'page-head' }, h('input', { class: 'title-input', value: t.name, 'aria-label': 'Workout name', oninput: (e) => { t.name = e.target.value; } })), body);
  root.append(h('div', { class: 'actions sticky-actions' },
    h('button', { class: 'btn', onclick: save }, 'Save'),
    h('button', { class: 'btn ghost', onclick: () => downloadWorkoutFit(toFitTemplate(t)).catch((e) => toast(e.message)) }, '⌚ Export .fit'),
    !isNew ? h('button', { class: 'btn danger ghost', onclick: del }, 'Delete') : null));

  function draw() {
    body.replaceChildren();
    if (t.sport === 'strength') strength(); else cardio();
  }

  function strength() {
    t.exercises.forEach((te, i) => {
      const def = exercise(te.ex);
      const timed = def.kind === 't';
      const rows = te.sets.map((st, si) => h('tr', null,
        h('td', null, h('button', { class: 'set-type t-' + (st.warmup ? 'w' : 'n'), title: 'Toggle warm-up', onclick: () => { st.warmup = !st.warmup || undefined; draw(); } }, st.warmup ? 'W' : si + 1)),
        h('td', null, h('input', { type: 'number', inputmode: 'numeric', value: timed ? (st.sec ?? '') : (st.reps ?? ''), 'aria-label': timed ? 'Seconds' : 'Reps', oninput: (e) => { const v = parseInt(e.target.value, 10); if (timed) st.sec = isNum(v) ? v : undefined; else st.reps = isNum(v) ? v : undefined; } })),
        h('td', null, def.kind === 'bw' || timed ? h('span', { class: 'muted small' }, def.kind === 'bw' ? 'BW' : '') : h('input', { type: 'number', inputmode: 'decimal', step: 'any', value: isNum(st.kg) ? toDisp(st.kg) : '', placeholder: 'auto', 'aria-label': 'Weight', oninput: (e) => { const v = parseFloat(e.target.value); st.kg = isNum(v) ? fromDisp(v) : undefined; } })),
        h('td', null, h('button', { class: 'icon-btn', 'aria-label': 'Remove set', onclick: () => { te.sets.splice(si, 1); draw(); } }, '✕'))));
      body.append(h('section', { class: 'card ex-card' },
        h('div', { class: 'ex-head' }, h('h2', null, def.name), h('div', { class: 'ex-tools' },
          h('select', { 'aria-label': 'Rest', onchange: (e) => { te.rest = +e.target.value; } }, [0, 30, 45, 60, 90, 120, 150, 180, 240, 300].map((v) => h('option', { value: v, selected: v === te.rest }, v ? `Rest ${fmtDur(v)}` : 'Lap button'))),
          i > 0 ? h('button', { class: 'icon-btn', 'aria-label': 'Move up', onclick: () => { [t.exercises[i - 1], t.exercises[i]] = [t.exercises[i], t.exercises[i - 1]]; draw(); } }, '↑') : null,
          h('button', { class: 'icon-btn', 'aria-label': 'Remove exercise', onclick: () => { t.exercises.splice(i, 1); draw(); } }, '✕'))),
        h('table', { class: 'sets' }, h('thead', null, h('tr', null, h('th', null, 'Set'), h('th', null, timed ? 'Sec' : 'Reps'), h('th', null, timed ? '' : wLabel()), h('th'))), h('tbody', null, rows)),
        h('div', { class: 'ex-foot' }, h('button', { class: 'btn ghost small', onclick: () => { const l = te.sets[te.sets.length - 1] || { reps: 8 }; te.sets.push({ ...l, warmup: undefined }); draw(); } }, '+ Set'),
          h('input', { class: 'notes', placeholder: 'Notes / cues', value: te.notes || '', oninput: (e) => { te.notes = e.target.value; } }))));
    });
    body.append(h('button', { class: 'btn ghost', onclick: () => pickExercise((exId) => { t.exercises.push({ ex: exId, rest: 90, sets: exercise(exId).kind === 't' ? [{ sec: 45 }, { sec: 45 }, { sec: 45 }] : [{ reps: 8 }, { reps: 8 }, { reps: 8 }] }); draw(); }) }, '+ Add exercise'));
    body.append(h('p', { class: 'muted small' }, 'Leave weight blank ("auto") to let FIT suggest it from your last session.'));
  }

  function cardio() {
    const c = t.cardio;
    const num = (label, get, set, unit, step = 1) => h('label', { class: 'field' }, h('span', null, label), h('span', { class: 'field-in' }, h('input', { type: 'number', inputmode: 'decimal', step, value: get() ?? '', oninput: (e) => set(parseFloat(e.target.value)) }), unit ? h('span', { class: 'muted small' }, unit) : null));
    const sel = (label, val, opts, set) => h('label', { class: 'field' }, h('span', null, label), h('select', { onchange: (e) => { set(e.target.value); draw(); } }, opts.map(([v, l]) => h('option', { value: v, selected: String(v) === String(val) }, l))));
    const paceUnit = imperial() ? 'min/mi' : 'min/km';
    const toPace = (mps) => (mps ? +((imperial() ? 1609.344 : 1000) / mps / 60).toFixed(2) : '');
    const fromPace = (min) => (min > 0 ? (imperial() ? 1609.344 : 1000) / (min * 60) : undefined);
    body.append(card('Sport', sel('Sport', t.sport, [['running', 'Running'], ['cycling', 'Cycling'], ['walking', 'Walking'], ['cardio', 'Cardio/HIIT']], (v) => { t.sport = v; })));
    body.append(card('Warm-up', num('Warm-up', () => (c.warmupSec ? c.warmupSec / 60 : ''), (v) => { c.warmupSec = isNum(v) ? v * 60 : 0; }, 'min')));
    const workRows = [
      num('Repeats', () => c.repeats, (v) => { c.repeats = Math.max(1, Math.round(v || 1)); }, '×'),
      sel('Work by', c.work.type, [['distance', 'Distance'], ['time', 'Time']], (v) => { c.work.type = v; }),
      c.work.type === 'distance'
        ? num('Distance', () => c.work.value, (v) => { c.work.value = v; }, 'm')
        : num('Duration', () => (c.work.value ? c.work.value / 60 : ''), (v) => { c.work.value = isNum(v) ? v * 60 : 0; }, 'min', 0.25),
      sel('Target', c.target.type, [['open', 'None'], ['hr', 'HR zone'], ['hrRange', 'HR range'], ['pace', 'Pace range']], (v) => { c.target.type = v; }),
    ];
    if (c.target.type === 'hr') workRows.push(sel('Zone', c.target.zone || 4, [1, 2, 3, 4, 5].map((z) => [z, 'Zone ' + z]), (v) => { c.target.zone = +v; }));
    if (c.target.type === 'hrRange') workRows.push(num('HR low', () => c.target.low, (v) => { c.target.low = v; }, 'bpm'), num('HR high', () => c.target.high, (v) => { c.target.high = v; }, 'bpm'));
    if (c.target.type === 'pace') workRows.push(num('Pace fast', () => toPace(c.target.high), (v) => { c.target.high = fromPace(v); }, paceUnit, 0.05), num('Pace slow', () => toPace(c.target.low), (v) => { c.target.low = fromPace(v); }, paceUnit, 0.05));
    workRows.push(num('Recovery', () => (c.recoverSec ? c.recoverSec / 60 : ''), (v) => { c.recoverSec = isNum(v) ? v * 60 : 0; }, 'min', 0.25));
    body.append(card('Main set', h('div', { class: 'fields' }, workRows)));
    body.append(card('Cool-down', num('Cool-down', () => (c.cooldownSec ? c.cooldownSec / 60 : ''), (v) => { c.cooldownSec = isNum(v) ? v * 60 : 0; }, 'min (0 = lap button)')));
  }

  async function save() {
    try {
      const i = LIFT.lift.templates.findIndex((x) => x.id === t.id);
      t.updated = Date.now();
      if (i >= 0) LIFT.lift.templates[i] = t; else LIFT.lift.templates.push(t);
      await saveDoc('lift');
      toast('Saved');
      location.hash = '#/lift';
    } catch (e) { toast('Save failed: ' + e.message); }
  }
  async function del() {
    if (!confirm('Delete this template? Logged workouts stay.')) return;
    LIFT.lift.templates = LIFT.lift.templates.filter((x) => x.id !== t.id);
    await saveDoc('lift');
    location.hash = '#/lift';
  }
  draw();
}

// Convert a cardio template into the step list the server encodes.
export function toFitTemplate(t) {
  if (t.sport === 'strength') return t;
  const c = t.cardio || {};
  const steps = [];
  if (c.warmupSec) steps.push({ kind: 'warmup', dur: { type: 'time', value: c.warmupSec }, target: { type: 'hr', zone: 2 } });
  const work = { kind: 'work', dur: { type: c.work?.type, value: c.work?.value }, target: c.target };
  const rec = c.recoverSec ? { kind: 'recover', dur: { type: 'time', value: c.recoverSec } } : null;
  if ((c.repeats || 1) > 1) steps.push({ kind: 'repeat', repeat: c.repeats, steps: [work, rec].filter(Boolean) });
  else steps.push(work, ...(rec ? [rec] : []));
  steps.push({ kind: 'cooldown', dur: c.cooldownSec ? { type: 'time', value: c.cooldownSec } : { type: 'open' } });
  return { name: t.name, sport: t.sport, steps };
}
