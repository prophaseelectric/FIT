// Live workout logger: set-by-set entry, previous numbers, rest timer, PR detection.
import { h, card, empty, toast, fmtDur, isNum } from '../ui.js';
import { LIFT, loadLift, saveDoc, exercise, allExercises, getActive, setActive, sessionExercise, lastSets, bests, e1rm, toDisp, fromDisp, wLabel, finishSession, uid } from '../lift.js';
import { MUSCLES } from '../exercises.js';

let tick = null;
let rest = null; // { until, total }

export async function render(root) {
  await loadLift().catch(() => {});
  let s = getActive();
  root.append(h('a', { class: 'back', href: '#/lift' }, '← Lift'));
  if (!s) { root.append(card(null, empty('No workout in progress.'), h('a', { class: 'btn', href: '#/lift' }, 'Choose a workout'))); return; }

  const save = () => setActive(s);
  const clock = h('span', { class: 'clock' });
  const restBar = h('div', { class: 'rest-bar', hidden: true });
  const name = h('input', { class: 'title-input', value: s.name, 'aria-label': 'Workout name', oninput: (e) => { s.name = e.target.value; save(); } });
  root.append(h('header', { class: 'page-head session-head' }, h('div', null, name, h('div', { class: 'sub' }, clock)),
    h('button', { class: 'btn', onclick: finish }, 'Finish')));
  const list = h('div');
  root.append(list, restBar);
  root.append(h('div', { class: 'actions' },
    h('button', { class: 'btn ghost', onclick: () => pickExercise((id) => { s.exercises.push(sessionExercise(id)); save(); draw(); }) }, '+ Add exercise'),
    h('button', { class: 'btn danger ghost', onclick: () => { if (confirm('Discard this workout?')) { setActive(null); location.hash = '#/lift'; } } }, 'Discard')));

  clearInterval(tick);
  tick = setInterval(() => {
    if (!root.isConnected) { clearInterval(tick); return; }
    clock.textContent = `${fmtDur((Date.now() - s.start) / 1000)} elapsed`;
    if (rest) {
      const left = Math.ceil((rest.until - Date.now()) / 1000);
      restBar.hidden = false;
      if (left <= 0) { buzz(); rest = null; restBar.hidden = true; return; }
      restBar.replaceChildren(
        h('span', null, 'Rest ', h('strong', null, fmtDur(left))),
        h('progress', { max: rest.total, value: rest.total - left }),
        h('button', { class: 'btn ghost small', onclick: () => { rest.until -= 15000; } }, '−15s'),
        h('button', { class: 'btn ghost small', onclick: () => { rest.until += 15000; rest.total += 15; } }, '+15s'),
        h('button', { class: 'btn small', onclick: () => { rest = null; restBar.hidden = true; } }, 'Skip'));
    }
  }, 250);

  function draw() {
    list.replaceChildren();
    s.exercises.forEach((ex, ei) => list.append(exerciseCard(ex, ei)));
    if (!s.exercises.length) list.append(card(null, empty('Add your first exercise.')));
  }

  function exerciseCard(ex, ei) {
    const def = exercise(ex.ex);
    const prev = lastSets(ex.ex, s.start) || [];
    const timed = def.kind === 't';
    const best = bests(ex.ex, s.start);
    const rows = h('tbody');
    ex.sets.forEach((st, si) => rows.append(setRow(ex, st, si, prev[si], timed, best)));
    const restSel = h('select', { 'aria-label': 'Rest timer', onchange: (e) => { ex.rest = +e.target.value; save(); } },
      [0, 30, 45, 60, 90, 120, 150, 180, 240, 300].map((v) => h('option', { value: v, selected: v === ex.rest }, v ? `Rest ${fmtDur(v)}` : 'No timer')));
    return h('section', { class: 'card ex-card' },
      h('div', { class: 'ex-head' }, h('h2', null, def.name),
        h('div', { class: 'ex-tools' }, restSel,
          ei > 0 ? h('button', { class: 'icon-btn', title: 'Move up', 'aria-label': 'Move up', onclick: () => { [s.exercises[ei - 1], s.exercises[ei]] = [s.exercises[ei], s.exercises[ei - 1]]; save(); draw(); } }, '↑') : null,
          h('button', { class: 'icon-btn', title: 'Remove exercise', 'aria-label': 'Remove exercise', onclick: () => { if (confirm(`Remove ${def.name}?`)) { s.exercises.splice(ei, 1); save(); draw(); } } }, '✕'))),
      ex.hint ? h('p', { class: 'hint' }, '↗ ', ex.hint) : null,
      h('table', { class: 'sets' },
        h('thead', null, h('tr', null, h('th', null, 'Set'), h('th', null, 'Previous'), h('th', null, timed ? 'Sec' : wLabel()), h('th', null, timed ? '' : 'Reps'), h('th', null, 'RIR'), h('th', { 'aria-label': 'Done' }, '✓'))),
        rows),
      h('div', { class: 'ex-foot' },
        h('button', { class: 'btn ghost small', onclick: () => { const last = ex.sets[ex.sets.length - 1] || {}; ex.sets.push({ type: 'n', kg: last.kg, reps: last.reps, sec: last.sec, done: false }); save(); draw(); } }, '+ Set'),
        h('input', { class: 'notes', placeholder: 'Notes', value: ex.notes || '', oninput: (e) => { ex.notes = e.target.value; save(); } })));
  }

  function setRow(ex, st, si, prev, timed, best) {
    const TYPES = ['n', 'w', 'd', 'f'];
    const label = () => (st.type === 'w' ? 'W' : st.type === 'd' ? 'D' : st.type === 'f' ? 'F' : String(ex.sets.slice(0, si + 1).filter((x) => x.type !== 'w').length));
    const typeBtn = h('button', { class: 'set-type t-' + st.type, title: 'Tap: normal → warm-up → drop → failure. Long-press to delete.', onclick: () => { st.type = TYPES[(TYPES.indexOf(st.type) + 1) % 4]; save(); draw(); } }, label());
    let pressT;
    typeBtn.addEventListener('pointerdown', () => { pressT = setTimeout(() => { if (confirm('Delete this set?')) { ex.sets.splice(si, 1); save(); draw(); } }, 650); });
    ['pointerup', 'pointerleave'].forEach((ev) => typeBtn.addEventListener(ev, () => clearTimeout(pressT)));

    const prevTxt = prev ? (timed ? `${prev.sec || 0}s` : `${toDisp(prev.kg) || 0}×${prev.reps ?? 0}`) : '–';
    const w = h('input', { type: 'number', inputmode: 'decimal', step: 'any', value: timed ? (st.sec ?? '') : (isNum(st.kg) ? toDisp(st.kg) : ''), placeholder: prev ? (timed ? prev.sec : toDisp(prev.kg)) : '', 'aria-label': timed ? 'Seconds' : 'Weight',
      oninput: (e) => { const v = parseFloat(e.target.value); if (timed) st.sec = isNum(v) ? v : undefined; else st.kg = isNum(v) ? fromDisp(v) : undefined; save(); } });
    const r = timed ? h('span') : h('input', { type: 'number', inputmode: 'numeric', step: '1', value: st.reps ?? '', placeholder: prev?.reps ?? st.targetReps ?? '', 'aria-label': 'Reps',
      oninput: (e) => { const v = parseInt(e.target.value, 10); st.reps = isNum(v) ? v : undefined; save(); } });
    const rir = h('select', { 'aria-label': 'Reps in reserve', onchange: (e) => { st.rir = e.target.value === '' ? undefined : +e.target.value; save(); } },
      h('option', { value: '' }, '–'), [0, 1, 2, 3, 4, 5].map((v) => h('option', { value: v, selected: st.rir === v }, v === 5 ? '5+' : v)));
    const tr = h('tr', { class: st.done ? 'done' : '' });
    const check = h('button', { class: 'check' + (st.done ? ' on' : ''), 'aria-pressed': String(!!st.done), 'aria-label': 'Complete set', onclick: () => {
      // empty inputs take the placeholder (last time's numbers), like Strong/MacroFactor
      if (!st.done) {
        if (timed && !isNum(st.sec) && prev?.sec) st.sec = prev.sec;
        if (!timed && !isNum(st.kg) && prev?.kg !== undefined) st.kg = prev.kg;
        if (!timed && !isNum(st.reps)) st.reps = prev?.reps ?? st.targetReps;
      }
      st.done = !st.done;
      if (st.done) {
        st.at = Date.now();
        const pr = !timed && st.type !== 'w' && st.kg > 0 && st.reps > 0 && (e1rm(st.kg, st.reps) > best.e1rm + 0.01 && best.e1rm > 0);
        if (pr) { st.pr = true; toast(`🏆 New e1RM PR: ${toDisp(e1rm(st.kg, st.reps))} ${wLabel()}`); }
        if (ex.rest) rest = { until: Date.now() + ex.rest * 1000, total: ex.rest };
      }
      save(); draw();
    } }, '✓');
    tr.append(h('td', null, typeBtn), h('td', { class: 'prev' }, prevTxt, st.pr ? ' 🏆' : ''), h('td', null, w), h('td', null, r), h('td', null, rir), h('td', null, check));
    return tr;
  }

  async function finish() {
    const done = s.exercises.reduce((n, ex) => n + ex.sets.filter((x) => x.done).length, 0);
    if (!done) { if (confirm('No sets completed. Discard?')) { setActive(null); location.hash = '#/lift'; } return; }
    const tpl = LIFT.lift.templates.find((t) => t.id === s.templateId);
    const updateTpl = tpl && confirm('Save. Also update the template with today\'s weights and exercises?');
    try {
      const copy = JSON.parse(JSON.stringify(s));
      await finishSession(copy);
      if (updateTpl) {
        tpl.exercises = copy.exercises.map((ex) => ({ ex: ex.ex, rest: ex.rest, notes: ex.notes, sets: ex.sets.map((x) => ({ reps: x.reps, kg: x.kg, sec: x.sec, warmup: x.type === 'w' || undefined })) }));
        await saveDoc('lift');
      }
      setActive(null);
      toast('Workout saved');
      location.hash = '#/lift/log/' + copy.id;
    } catch (e) { toast('Save failed (kept on this device): ' + e.message, 5000); }
  }

  draw();
}

function buzz() {
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* */ }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(0.25, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.start(); o.stop(ctx.currentTime + 0.6);
  } catch { /* */ }
  toast('Rest done. Next set.');
}

// Exercise picker modal: search, muscle filter, create custom.
export function pickExercise(onPick) {
  let q = '', muscle = '';
  const listEl = h('div', { class: 'picker-list' });
  const close = () => dlg.remove();
  const render = () => {
    const items = allExercises().filter((e) => (!q || e.name.toLowerCase().includes(q)) && (!muscle || e.muscles?.includes(muscle)));
    listEl.replaceChildren(...items.map((e) => h('button', { class: 'picker-item', onclick: () => { close(); onPick(e.id); } }, h('span', null, e.name), h('span', { class: 'muted small' }, (e.muscles || []).join(', ')))));
    if (q) listEl.append(h('button', { class: 'picker-item new', onclick: async () => {
      const id = 'c-' + uid().slice(0, 8);
      const kind = confirm('Is it weighted (OK) or bodyweight/timed (Cancel)?') ? 'w' : 'bw';
      (LIFT.lift.customExercises ||= []).push({ id, name: q.replace(/\b\w/g, (c) => c.toUpperCase()), muscles: muscle ? [muscle] : [], kind, cat: 'unknown' });
      try { await saveDoc('lift'); } catch (err) { toast(err.message); }
      close(); onPick(id);
    } }, `+ Create “${q}”`));
  };
  const dlg = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose exercise', onclick: (e) => { if (e.target === dlg) close(); } },
    h('div', { class: 'modal-body' },
      h('div', { class: 'modal-head' }, h('strong', null, 'Add exercise'), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
      h('input', { type: 'search', placeholder: 'Search exercises', autofocus: true, oninput: (e) => { q = e.target.value.trim().toLowerCase(); render(); } }),
      h('div', { class: 'tags' }, ['', ...MUSCLES].map((m) => h('button', { class: 'tag' + (m === muscle ? ' on' : ''), onclick: (e) => { muscle = m; [...e.target.parentNode.children].forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); render(); } }, m || 'All'))),
      listEl));
  document.body.append(dlg);
  render();
  dlg.querySelector('input').focus();
}
