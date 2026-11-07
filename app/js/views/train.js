import { h, card, kpi, segmented, fmtDur, fmtDist, fmtDate, fmtPace, fmtSpeed, fmtInt, fmtMonth, fmtElev, todayStr, addDays, weekStart, isNum, sum, typeLabel, isPaceType, toDist, dUnit, empty, shortDate } from '../ui.js';
import { DB, trainingLoad, actDate, actsBetween } from '../data.js';
import { timeChart, barChart, chartBox, tok } from '../charts.js';

const ICON = { running: '🏃', trail_running: '🏃', treadmill_running: '🏃', cycling: '🚴', road_biking: '🚴', mountain_biking: '🚵', indoor_cycling: '🚴', virtual_ride: '🚴', swimming: '🏊', lap_swimming: '🏊', open_water_swimming: '🏊', walking: '🚶', hiking: '🥾', strength_training: '🏋️', yoga: '🧘', golf: '⛳', rowing: '🚣', elliptical: '⚙️' };
export const icon = (t) => ICON[t] || '⏱️';

export function activityRow(a) {
  const pace = isPaceType(a.type) && a.avgSpeed ? fmtPace(a.avgSpeed) : a.avgSpeed ? fmtSpeed(a.avgSpeed) : null;
  return h('a', { class: 'row', href: `#/activity/${a.id}` },
    h('span', { class: 'row-icon', 'aria-hidden': 'true' }, icon(a.type)),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, a.name || typeLabel(a.type), a.pr ? h('span', { class: 'pill' }, 'PR') : null),
      h('span', { class: 'row-sub' }, `${fmtDate(actDate(a), { weekday: true })} · ${fmtDur(a.dur, { short: true })}${a.dist ? ' · ' + fmtDist(a.dist) : ''}${pace ? ' · ' + pace : ''}`)),
    h('span', { class: 'row-end' }, a.avgHR ? `${a.avgHR} bpm` : '', a.load ? h('span', { class: 'muted small' }, `load ${Math.round(a.load)}`) : null));
}

let state = { weeks: 26, type: 'all' };

export function render(root) {
  root.append(h('header', { class: 'page-head' }, h('h1', null, 'Training')));
  if (!DB.acts.length) { root.append(card(null, empty('No activities synced yet. Check Settings → Sync.'))); return; }

  const types = countTypes(DB.acts);
  const body = h('div');
  const controls = h('div', { class: 'controls' },
    segmented([[12, '12w'], [26, '26w'], [52, '1y'], [156, '3y']], state.weeks, (v) => { state.weeks = v; draw(); }),
    segmented([['all', 'All'], ...types.slice(0, 3).map(([t]) => [t, typeLabel(t).split(' ')[0]])], state.type, (v) => { state.type = v; draw(); }));
  root.append(controls, body);

  function draw() {
    body.replaceChildren();
    const t = todayStr();
    const from = addDays(weekStart(t), -7 * (state.weeks - 1));
    const acts = actsBetween(from, t).filter((a) => state.type === 'all' || a.type === state.type);

    // This week vs avg of previous 4
    const ws = weekStart(t);
    const thisWk = acts.filter((a) => actDate(a) >= ws);
    const prev4 = actsBetween(addDays(ws, -28), addDays(ws, -1)).filter((a) => state.type === 'all' || a.type === state.type);
    body.append(h('div', { class: 'kpis' },
      kpi('This week', fmtDur(sum(thisWk.map((a) => a.dur)), { short: true }), `${thisWk.length} sessions · 4-wk avg ${fmtDur(sum(prev4.map((a) => a.dur)) / 4, { short: true })}`),
      kpi('Distance', fmtDist(sum(thisWk.map((a) => a.dist)), 1), `4-wk avg ${fmtDist(sum(prev4.map((a) => a.dist)) / 4, 1)}`),
      kpi('Load', fmtInt(sum(thisWk.map((a) => a.load))), `4-wk avg ${fmtInt(sum(prev4.map((a) => a.load)) / 4)}`),
      kpi('Activities', fmtInt(acts.length), `in the last ${state.weeks} weeks`)));

    // Weekly volume, stacked by type (top 3 + other)
    const weeks = [];
    for (let w = from; w <= t; w = addDays(w, 7)) weeks.push(w);
    const top = types.slice(0, 3).map(([k]) => k);
    const groups = state.type === 'all' ? [...top, 'other'] : [state.type];
    const vol = groups.map((g, i) => ({
      label: g === 'other' ? 'Other' : typeLabel(g),
      color: g === 'other' ? tok('text-muted') : tok('series-' + (i + 1)),
      data: weeks.map((w) => sum(acts.filter((a) => actDate(a) >= w && actDate(a) < addDays(w, 7) && (g === 'other' ? !top.includes(a.type) : a.type === g)).map((a) => a.dur / 3600))),
    })).filter((d) => d.data.some((v) => v > 0));
    const c1 = chartBox(200, 'Weekly training hours');
    body.append(card('Weekly volume (hours)', c1.box));

    // Training load
    const tl = trainingLoad(state.type === 'all' ? null : state.type).filter((x) => x.date >= from);
    const c2 = chartBox(200, 'Training load'), c3 = chartBox(130, 'Acute to chronic load ratio');
    body.append(card('Training load', h('p', { class: 'muted small' }, 'Bars: daily load. Lines: 7-day (acute, fatigue) vs 28-day (chronic, fitness) weighted averages. Ratio 0.8–1.3 is the productive zone; above 1.5 is where injuries happen.'), c2.box, c3.box));

    // HR zones by week
    const zoneWeeks = weeks.map((w) => [1, 2, 3, 4, 5].map((z) => sum(acts.filter((a) => a.hrz && actDate(a) >= w && actDate(a) < addDays(w, 7)).map((a) => a.hrz[z - 1] / 3600))));
    const c4 = chartBox(200, 'Time in heart rate zones per week');
    const zTotals = [0, 1, 2, 3, 4].map((i) => sum(zoneWeeks.map((zw) => zw[i])));
    const zAll = sum(zTotals);
    body.append(card('Heart rate zones', h('p', { class: 'muted small' }, zAll ? `Polarization check: ${Math.round(((zTotals[0] + zTotals[1]) / zAll) * 100)}% easy (Z1–2), ${Math.round((zTotals[2] / zAll) * 100)}% Z3, ${Math.round(((zTotals[3] + zTotals[4]) / zAll) * 100)}% hard (Z4–5). Most endurance gains come from ~80% easy.` : 'No zone data.'), c4.box));

    // VO2 max
    const vo2 = DB.acts.filter((a) => isNum(a.vo2) && actDate(a) >= from).sort((a, b) => (a.start < b.start ? -1 : 1));
    let c5;
    if (vo2.length > 1) { c5 = chartBox(160, 'VO2 max'); body.append(card('VO₂ max (from runs/rides)', c5.box)); }

    // PRs (running fastest splits across all time)
    const prs = bestSplits();
    if (prs.length) {
      body.append(card('Best efforts (all time)', h('table', { class: 'table' },
        h('thead', null, h('tr', null, h('th', null, 'Distance'), h('th', null, 'Time'), h('th', null, 'Pace'), h('th', null, 'Date'))),
        h('tbody', null, prs.map((p) => h('tr', { onclick: () => { location.hash = `#/activity/${p.a.id}`; }, class: 'click' },
          h('td', null, p.label), h('td', null, fmtDur(p.sec)), h('td', null, fmtPace(p.m / p.sec)), h('td', null, fmtDate(actDate(p.a), { year: true }))))))));
    }

    // Activity list, grouped by month
    const list = h('div', { class: 'list' });
    let month = '';
    const shown = state.showAll ? acts : acts.slice(0, 40);
    for (const a of shown) {
      const m = actDate(a).slice(0, 7);
      if (m !== month) { month = m; list.append(h('div', { class: 'list-head' }, fmtMonth(m + '-01'))); }
      list.append(activityRow(a));
    }
    body.append(card(`Activities (${acts.length})`, acts.length ? list : empty('Nothing in this range.'),
      acts.length > shown.length ? h('button', { class: 'btn ghost', onclick: () => { state.showAll = true; draw(); } }, `Show all ${acts.length}`) : null));

    requestAnimationFrame(() => {
      barChart(c1.canvas, weeks, vol, { stacked: true, yFmt: (v) => `${(+v).toFixed(1)}h`, xLabels: (w) => shortDate(w), titleFmt: (w) => 'Week of ' + fmtDate(w, { year: true }) });
      const labels = tl.map((x) => x.date);
      timeChart(c2.canvas, labels, [
        { label: 'Daily load', kind: 'bar', data: tl.map((x) => x.load || null), color: tok('seq-250') },
        { label: 'Acute (7d)', data: tl.map((x) => x.acute), color: tok('series-2') },
        { label: 'Chronic (28d)', data: tl.map((x) => x.chronic), color: tok('series-1') },
      ], { yFmt: (v) => Math.round(v), yMin: 0 });
      timeChart(c3.canvas, labels, [
        { label: 'Ratio', data: tl.map((x) => x.acwr), color: tok('text-primary') },
        { label: 'Upper sweet spot', data: labels.map(() => 1.3), color: tok('status-warning'), dash: true, width: 1, noLegend: true },
        { label: 'Lower sweet spot', data: labels.map(() => 0.8), color: tok('text-muted'), dash: true, width: 1, noLegend: true },
      ], { yFmt: (v) => (+v).toFixed(2), legend: false, noTooltipFor: ['Upper sweet spot', 'Lower sweet spot'] });
      barChart(c4.canvas, weeks, [1, 2, 3, 4, 5].map((z, i) => ({ label: 'Z' + z, data: zoneWeeks.map((zw) => zw[i]), color: tok(['seq-200', 'seq-300', 'seq-400', 'seq-550', 'seq-700'][i]) })), { stacked: true, yFmt: (v) => `${(+v).toFixed(1)}h`, xLabels: (w) => shortDate(w), titleFmt: (w) => 'Week of ' + fmtDate(w, { year: true }) });
      if (c5) {
        const labels5 = [...new Set(vo2.map(actDate))];
        const byDay = new Map(vo2.map((a) => [actDate(a), a.vo2]));
        timeChart(c5.canvas, labels5, [{ label: 'VO₂ max', data: labels5.map((d) => byDay.get(d)), color: tok('series-1'), kind: 'dots' }, { label: 'trend', data: labels5.map((d) => byDay.get(d)), color: tok('series-1'), width: 1.5, noLegend: true }], { yFmt: (v) => Math.round(v), legend: false, noTooltipFor: ['trend'] });
      }
    });
  }
  draw();
}

function countTypes(acts) {
  const m = new Map();
  for (const a of acts) m.set(a.type, (m.get(a.type) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const SPLITS = [[400, '400 m'], [1000, '1 km'], [1609, '1 mile'], [5000, '5K'], [10000, '10K'], [21098, 'Half marathon'], [42195, 'Marathon']];
function bestSplits() {
  const out = [];
  for (const [m, label] of SPLITS) {
    let best = null;
    for (const a of DB.acts) {
      if (!/running/.test(a.type)) continue;
      const s = a.splits?.[m];
      if (s && (!best || s < best.sec)) best = { sec: s, a };
    }
    if (best) out.push({ label, m, ...best });
  }
  return out;
}

