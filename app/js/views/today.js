import { h, card, statusChip, fmtDur, fmtInt, fmtDate, wUnit, toW, fromW, todayStr, addDays, weekStart, isNum, sum, delta, toast } from '../ui.js';
import { DB, day, baseline, latest, weightTrend, trainingLoad, sleepTargetH } from '../data.js';
import { api, cacheGet, cacheSet } from '../api.js';
import { activityRow } from './train.js';

export const DEFAULT_TAGS = ['Alcohol', 'Late caffeine', 'Late meal', 'Sauna', 'Stretch/mobility', 'Sick', 'Travel', 'Stressful day', 'Rest day'];

// Recovery verdict. Transparent rules, not a black-box score: each signal says why.
export function recovery(date) {
  const r = day(date);
  const signals = [];
  if (isNum(r.hrv)) {
    let level = 'good', why = `${r.hrv} ms`;
    if (r.hrvStatus === 'LOW' || r.hrvStatus === 'POOR' || (isNum(r.hrvBalLow) && r.hrv < r.hrvBalLow - 5)) level = 'bad';
    else if (r.hrvStatus === 'UNBALANCED' || (isNum(r.hrvBalLow) && r.hrv < r.hrvBalLow)) level = 'warn';
    if (isNum(r.hrvBalLow)) why += ` (baseline ${r.hrvBalLow}–${r.hrvBalHigh})`;
    signals.push({ name: 'HRV', level, why });
  }
  if (isNum(r.sleepSec)) {
    const hrs = r.sleepSec / 3600, target = (r.sleepNeedMin ? r.sleepNeedMin / 60 : sleepTargetH());
    const sc = r.sleepScore;
    let level = 'good';
    if ((isNum(sc) && sc < 60) || hrs < target - 1.5) level = 'bad';
    else if ((isNum(sc) && sc < 75) || hrs < target - 0.75) level = 'warn';
    signals.push({ name: 'Sleep', level, why: `${fmtDur(r.sleepSec, { short: true })}${isNum(sc) ? `, score ${sc}` : ''}` });
  }
  const rhrBase = baseline('rhr', date, 30);
  if (isNum(r.rhr) && isNum(rhrBase)) {
    const d = r.rhr - rhrBase;
    signals.push({ name: 'Resting HR', level: d >= 5 ? 'bad' : d >= 3 ? 'warn' : 'good', why: `${r.rhr} bpm (${Math.round(d) === 0 ? 'same as' : (d > 0 ? '+' : '−') + Math.abs(Math.round(d)) + ' vs'} 30-day avg)` });
  }
  if (isNum(r.bbMax)) {
    signals.push({ name: 'Body Battery', level: r.bbMax < 40 ? 'bad' : r.bbMax < 65 ? 'warn' : 'good', why: `peaked at ${r.bbMax}` });
  }
  const tl = trainingLoad();
  const last = tl.find((x) => x.date === date) || tl[tl.length - 1];
  if (last && isNum(last.acwr)) {
    signals.push({ name: 'Load ratio', level: last.acwr > 1.5 ? 'bad' : last.acwr > 1.3 ? 'warn' : 'good', why: `${last.acwr.toFixed(2)} acute:chronic` });
  }
  const bad = signals.filter((s) => s.level === 'bad').length, warn = signals.filter((s) => s.level === 'warn').length;
  let verdict;
  if (!signals.length) verdict = { level: 'none', title: 'No recovery data yet', text: 'Wear the watch overnight and sync.' };
  else if (bad || warn >= 2) verdict = { level: 'bad', title: 'Take it easy', text: 'Easy aerobic work, mobility, or rest. Push tomorrow.' };
  else if (warn === 1) verdict = { level: 'warn', title: 'Moderate', text: 'Train, but keep the hard stuff short.' };
  else verdict = { level: 'good', title: 'Green light', text: 'Recovered. Good day for intensity or a long session.' };
  return { verdict, signals };
}

// Garmin Connect-style "My Day": a feed of glance cards, each with an icon, the number that matters,
// context, and a 7-day mini chart. Tap any card for the full view.
const ICONS = {
  sleep: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  hrv: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  bb: '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 11v2M7 10v4M10 10v4"/>',
  rhr: '<path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10z"/>',
  stress: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
  steps: '<path d="M8 4c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5zM16 10c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5z"/>',
  im: '<path d="M13 3L5 14h6l-1 7 8-11h-6z"/>',
  weight: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 9l3 3M12 12l3-3"/>',
  resp: '<path d="M4 9c3 0 3-3 6-3s3 3 6 3 3-3 4-3M4 15c3 0 3-3 6-3s3 3 6 3 3-3 4-3"/>',
};
const icon = (k, color) => h('span', { class: 'g-icon', style: { color, background: color + '22' }, html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>` });

// 7-day mini chart as inline SVG (bars or line), last point highlighted.
function spark(vals, color, kind = 'bars', goal) {
  const v = vals.map((x) => (isNum(x) ? x : null));
  const real = v.filter((x) => x !== null);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 112 44'); svg.setAttribute('class', 'g-spark'); svg.setAttribute('aria-hidden', 'true');
  if (!real.length) return svg;
  const hi = Math.max(...real, goal || 0), lo = kind === 'bars' ? 0 : Math.min(...real);
  const y = (x) => 40 - ((x - lo) / (hi - lo || 1)) * 34;
  const step = 112 / v.length;
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const [k, val] of Object.entries(attrs)) e.setAttribute(k, val); svg.append(e); return e; };
  if (goal) el('line', { x1: 0, x2: 112, y1: y(goal), y2: y(goal), stroke: 'currentColor', 'stroke-opacity': '.25', 'stroke-dasharray': '3 3' });
  if (kind === 'bars') {
    v.forEach((x, i) => { if (x === null) return; el('rect', { x: i * step + 3, y: y(x), width: step - 6, height: Math.max(2, 40 - y(x)), rx: 2, fill: color, 'fill-opacity': i === v.length - 1 ? 1 : 0.45 }); });
  } else {
    const pts = v.map((x, i) => (x === null ? null : [i * step + step / 2, y(x)])).filter(Boolean);
    el('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    const last = pts[pts.length - 1];
    el('circle', { cx: last[0], cy: last[1], r: 4, fill: color });
  }
  return svg;
}

function glance({ key, color, title, value, unit, sub, vals, kind, goal, href }) {
  return h('a', { class: 'glance', href, 'data-key': key },
    h('div', { class: 'g-main' },
      h('div', { class: 'g-head' }, icon(key, color), h('span', { class: 'g-title' }, title)),
      h('div', { class: 'g-value' }, value, unit ? h('span', { class: 'g-unit' }, unit) : null),
      sub ? h('div', { class: 'g-sub' }, sub) : null),
    h('div', { class: 'g-chart' }, spark(vals, color, kind, goal), h('span', { class: 'g-chev', 'aria-hidden': 'true' }, '›')));
}

// Reorderable, hideable card feed. Order/hidden live in server prefs so every device matches.
let editing = false;
function myDayFeed(cards) {
  const byKey = new Map(cards.map((c) => [c.dataset.key, c]));
  const order = [...(DB.prefs.myDayOrder || []).filter((k) => byKey.has(k)), ...cards.map((c) => c.dataset.key).filter((k) => !(DB.prefs.myDayOrder || []).includes(k))];
  const hidden = new Set(DB.prefs.myDayHidden || []);
  const wrap = h('div', { class: 'feed-wrap' });
  const persist = async () => {
    try {
      DB.prefs = await api('prefs', { method: 'PUT', body: { myDayOrder: order, myDayHidden: [...hidden] } });
      const snap = await cacheGet('snapshot');
      if (snap) await cacheSet('snapshot', { ...snap, prefs: DB.prefs });
    } catch (e) { toast('Could not save layout: ' + e.message); }
  };
  let sortable;
  const draw = () => {
    sortable?.destroy();
    const feed = h('div', { class: 'feed' + (editing ? ' editing' : '') });
    for (const k of order) {
      const c = byKey.get(k);
      if (!editing) { if (!hidden.has(k)) feed.append(c); continue; }
      const on = !hidden.has(k);
      feed.append(h('div', { class: 'glance-edit' + (on ? '' : ' off'), 'data-key': k },
        h('span', { class: 'g-drag', 'aria-label': 'Drag to reorder', title: 'Drag to reorder', html: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>' }),
        c.querySelector('.g-head').cloneNode(true),
        h('button', { class: 'g-toggle' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-label': (on ? 'Hide ' : 'Show ') + k, onclick: () => { on ? hidden.add(k) : hidden.delete(k); persist(); draw(); } }, h('span'))));
    }
    const btn = h('button', { class: 'btn ghost small', onclick: () => { editing = !editing; draw(); } }, editing ? 'Done' : 'Edit');
    wrap.replaceChildren(h('div', { class: 'card-head feed-head' }, h('h2', null, editing ? 'Drag to reorder · toggle to show' : 'Today'), btn), feed);
    if (editing && window.Sortable) {
      sortable = window.Sortable.create(feed, {
        handle: '.g-drag', animation: 160, ghostClass: 'g-ghost', delay: 0, touchStartThreshold: 4,
        onEnd: () => { order.splice(0, order.length, ...[...feed.children].map((el) => el.dataset.key)); persist(); },
      });
    }
  };
  draw();
  return wrap;
}

export function render(root) {
  const t = todayStr();
  const r = day(t);
  const { verdict, signals } = recovery(t);
  const last7 = [...Array(7)].map((_, i) => addDays(t, i - 6));
  const series = (k, f = (x) => x) => last7.map((d) => (isNum(day(d)[k]) ? f(day(d)[k]) : null));
  const C = { sleep: '#8b7cf6', hrv: '#2fc6b5', bb: '#2ea4f2', rhr: '#f2555a', stress: '#f5a524', steps: '#33c759', im: '#ff8a3d', weight: '#9aa4b2', resp: '#5ac8fa' };

  root.append(h('header', { class: 'page-head' }, h('div', null, h('div', { class: 'sub' }, fmtDate(t, { weekday: true, year: true })), h('h1', null, 'My Day'))));

  root.append(h('a', { class: `card verdict v-${verdict.level}`, href: `#/day/${t}` },
    h('div', { class: 'verdict-top' }, h('span', { class: 'eyebrow' }, 'Recovery'), statusChip(verdict.level, verdict.title)),
    h('p', { class: 'verdict-text' }, verdict.text),
    signals.length ? h('ul', { class: 'signals' }, signals.map((s) => h('li', null, statusChip(s.level, s.name), h('span', { class: 'muted' }, s.why)))) : null));

  const sleepRow = isNum(r.sleepSec) ? r : (latest('sleepSec', 2) ? day(latest('sleepSec', 2).date) : {});
  const hrvL = latest('hrv', 2);
  const rhrBase = baseline('rhr', t, 30);
  const ws = weekStart(t);
  const wk = [];
  for (let d = ws; d <= t; d = addDays(d, 1)) wk.push(day(d));
  const im = sum(wk.map((x) => (x.imMod || 0) + 2 * (x.imVig || 0)));
  const imGoal = r.imGoal || 150;
  const trend = weightTrend();
  const tw = trend[trend.length - 1], tw7 = trend[trend.length - 8];
  const stepGoal = r.stepGoal || DB.prefs.stepGoal || 10000;
  const hm = (sec) => { const m = Math.round(sec / 60); return [Math.floor(m / 60), m % 60]; };

  const [sh, sm] = isNum(sleepRow.sleepSec) ? hm(sleepRow.sleepSec) : [null, null];
  const cards = [
    glance({ key: 'sleep', color: C.sleep, title: 'Sleep', href: '#/sleep', value: sh !== null ? h('span', null, sh, h('span', { class: 'g-unit' }, 'h '), sm, h('span', { class: 'g-unit' }, 'm')) : '–',
      sub: isNum(sleepRow.sleepScore) ? `Score ${sleepRow.sleepScore} · ${String(sleepRow.sleepQual || '').toLowerCase()}` : 'No sleep recorded', vals: series('sleepSec', (v) => v / 3600), kind: 'bars', goal: sleepTargetH() }),
    glance({ key: 'bb', color: C.bb, title: 'Body Battery', href: '#/day/' + t, value: isNum(r.bbMax) ? r.bbMax : '–', sub: isNum(r.bbMin) ? `High today · low ${r.bbMin} · +${r.bbCharged ?? 0} / −${r.bbDrained ?? 0}` : '', vals: series('bbMax'), kind: 'line' }),
    glance({ key: 'hrv', color: C.hrv, title: 'HRV Status', href: '#/sleep', value: hrvL ? hrvL.value : '–', unit: hrvL ? 'ms' : '', sub: hrvL ? `${String(day(hrvL.date).hrvStatus || '').toLowerCase() || 'overnight'} · 7-day avg ${day(hrvL.date).hrvWeek ?? '–'} ms` : 'Wear your watch overnight', vals: series('hrv'), kind: 'line' }),
    glance({ key: 'rhr', color: C.rhr, title: 'Resting Heart Rate', href: '#/trends?m=rhr', value: isNum(r.rhr) ? r.rhr : '–', unit: isNum(r.rhr) ? 'bpm' : '', sub: isNum(rhrBase) && isNum(r.rhr) ? h('span', null, '30-day avg ', Math.round(rhrBase), ' · ', delta(r.rhr - rhrBase, { d: 0 })) : '', vals: series('rhr'), kind: 'line' }),
    glance({ key: 'stress', color: C.stress, title: 'Stress', href: '#/trends?m=stressAvg', value: isNum(r.stressAvg) ? r.stressAvg : '–', sub: isNum(r.stressHighMin) ? `${r.stressAvg < 26 ? 'Rest' : r.stressAvg < 51 ? 'Low' : r.stressAvg < 76 ? 'Medium' : 'High'} · ${r.stressHighMin} min high` : '', vals: series('stressAvg'), kind: 'bars' }),
    glance({ key: 'steps', color: C.steps, title: 'Steps', href: '#/trends?m=steps', value: fmtInt(r.steps), sub: `Goal ${fmtInt(stepGoal)}${isNum(r.floors) ? ` · ${r.floors} floors` : ''}`, vals: series('steps'), kind: 'bars', goal: stepGoal }),
    glance({ key: 'im', color: C.im, title: 'Intensity Minutes', href: '#/train', value: fmtInt(im), sub: `This week · goal ${imGoal}`, vals: last7.map((d) => (day(d).imMod || 0) + 2 * (day(d).imVig || 0)), kind: 'bars' }),
    glance({ key: 'resp', color: C.resp, title: 'Respiration', href: '#/trends?m=sleepResp', value: isNum(sleepRow.sleepResp) ? sleepRow.sleepResp : '–', unit: 'brpm', sub: isNum(sleepRow.sleepSpo2) ? `Asleep · SpO₂ ${sleepRow.sleepSpo2}%` : 'Asleep', vals: series('sleepResp'), kind: 'line' }),
    glance({ key: 'weight', color: C.weight, title: 'Weight', href: '#/body', value: tw?.trend ? toW(tw.trend).toFixed(1) : '–', unit: tw?.trend ? wUnit() : '', sub: tw7?.trend && tw?.trend ? h('span', null, 'Trend · ', delta(toW(tw.trend) - toW(tw7.trend), { unit: ' ' + wUnit(), goodWhen: (DB.prefs.goalKg ?? 0) > (tw.trend ?? 0) ? 'up' : 'down' }), ' this week') : 'Log a weigh-in', vals: last7.map((d) => { const x = trend.find((p) => p.date === d); return x?.trend ? toW(x.trend) : null; }), kind: 'line' }),
  ];
  root.append(myDayFeed(cards));

  const recent = DB.acts.slice(0, 3);
  root.append(h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Activities'), h('a', { class: 'link', href: '#/train' }, 'All')),
    recent.length ? h('div', { class: 'list' }, recent.map(activityRow)) : h('p', { class: 'empty' }, 'No activities yet.')));
  root.append(journalCard(t));
  root.append(quickWeight());
}

export function journalCard(date) {
  const entry = DB.journal[date] || { tags: [] };
  const tags = [...new Set([...DEFAULT_TAGS, ...(DB.prefs.customTags || [])])];
  const sel = new Set(entry.tags || []);
  const wrap = h('div', { class: 'tags' });
  const save = async () => {
    try {
      DB.journal = await api('journal', { method: 'PUT', body: { date, tags: [...sel] } });
    } catch (e) { toast('Could not save: ' + e.message); }
  };
  for (const tg of tags) {
    const b = h('button', { class: 'tag' + (sel.has(tg) ? ' on' : ''), 'aria-pressed': String(sel.has(tg)), onclick: () => {
      sel.has(tg) ? sel.delete(tg) : sel.add(tg);
      b.classList.toggle('on'); b.setAttribute('aria-pressed', String(sel.has(tg)));
      save();
    } }, tg);
    wrap.append(b);
  }
  return card('Journal · ' + fmtDate(date), h('p', { class: 'muted small' }, 'Tag what happened today. Trends → Tag impact shows what these do to your sleep, HRV and resting HR.'), wrap);
}

function quickWeight() {
  const input = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: `Weight (${wUnit()})`, 'aria-label': `Weight in ${wUnit()}` });
  const form = h('form', { class: 'inline-form', onsubmit: async (e) => {
    e.preventDefault();
    const v = parseFloat(input.value);
    if (!(v > 0)) return;
    try {
      const d = await api('weights', { method: 'POST', body: { date: todayStr(), kg: fromW(v) } });
      DB.weights = d.entries;
      input.value = '';
      toast('Weight saved');
    } catch (err) { toast(err.message); }
  } }, input, h('button', { class: 'btn', type: 'submit' }, 'Log'));
  return card('Weigh-in', form);
}

