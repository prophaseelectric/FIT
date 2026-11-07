// Any metric over time, compare two metrics, year heatmap, journal tag impact.
import { h, card, kpi, segmented, fmtDate, fmtNum, isNum, mean, rolling, pearson, addDays, todayStr, empty, delta, toW, wUnit } from '../ui.js';
import { DB, rangeDates, values, day } from '../data.js';
import { timeChart, scatterChart, heatmap, chartBox, tok } from '../charts.js';

export const METRICS = {
  rhr: { label: 'Resting HR', unit: 'bpm', good: 'down' },
  hrv: { label: 'HRV (overnight)', unit: 'ms', good: 'up' },
  sleepScore: { label: 'Sleep score', unit: '', good: 'up' },
  sleepSec: { label: 'Sleep duration', unit: 'h', f: (v) => v / 3600, good: 'up', d: 2 },
  deepSec: { label: 'Deep sleep', unit: 'h', f: (v) => v / 3600, good: 'up', d: 2 },
  remSec: { label: 'REM sleep', unit: 'h', f: (v) => v / 3600, good: 'up', d: 2 },
  sleepHr: { label: 'Sleeping HR', unit: 'bpm', good: 'down' },
  sleepResp: { label: 'Sleep breathing rate', unit: 'brpm', good: 'none' },
  sleepSpo2: { label: 'Sleep SpO₂', unit: '%', good: 'up' },
  sleepStress: { label: 'Sleep stress', unit: '', good: 'down' },
  steps: { label: 'Steps', unit: '', good: 'up', d: 0 },
  floors: { label: 'Floors climbed', unit: '', good: 'up', d: 0 },
  distM: { label: 'Walking distance', unit: 'km', f: (v) => v / 1000, good: 'up', d: 2 },
  calTotal: { label: 'Calories burned', unit: 'kcal', good: 'none', d: 0 },
  calActive: { label: 'Active calories', unit: 'kcal', good: 'up', d: 0 },
  stressAvg: { label: 'Avg stress', unit: '', good: 'down' },
  stressHighMin: { label: 'High-stress minutes', unit: 'min', good: 'down', d: 0 },
  bbMax: { label: 'Body Battery high', unit: '', good: 'up' },
  bbMin: { label: 'Body Battery low', unit: '', good: 'up' },
  bbCharged: { label: 'Body Battery charged', unit: '', good: 'up' },
  bbDrained: { label: 'Body Battery drained', unit: '', good: 'none' },
  imVig: { label: 'Vigorous minutes', unit: 'min', good: 'up', d: 0 },
  imMod: { label: 'Moderate minutes', unit: 'min', good: 'up', d: 0 },
  respAvg: { label: 'Breathing rate (day)', unit: 'brpm', good: 'none' },
  spo2Avg: { label: 'SpO₂ (day)', unit: '%', good: 'up' },
  waterMl: { label: 'Hydration', unit: 'ml', good: 'up', d: 0 },
  calIn: { label: 'Calories eaten (Garmin)', unit: 'kcal', good: 'none', d: 0 },
  weight: { label: 'Weight (Garmin)', unit: 'wt', f: (v) => toW(v), good: 'none' },
  bodyFat: { label: 'Body fat', unit: '%', good: 'down' },
};
const unitOf = (k) => (METRICS[k].unit === 'wt' ? wUnit() : METRICS[k].unit);
const fmtM = (k) => (v) => `${fmtNum(v, METRICS[k].d ?? 1)}${unitOf(k) ? ' ' + unitOf(k) : ''}`;
const vals = (dates, k) => values(dates, k, METRICS[k].f || ((v) => v));

let st = { a: 'rhr', b: '', range: 90, lag: 0 };

export function render(root, params) {
  if (params?.m && METRICS[params.m]) st.a = params.m;
  root.append(h('header', { class: 'page-head' }, h('h1', null, 'Trends')));
  const available = Object.keys(METRICS).filter((k) => [...DB.days.values()].some((r) => isNum(r[k])));
  if (!available.length) { root.append(card(null, empty('No data synced yet.'))); return; }
  if (!available.includes(st.a)) st.a = available[0];
  const mkSel = (val, allowNone, on) => h('select', { onchange: (e) => on(e.target.value) }, allowNone ? h('option', { value: '' }, '— compare with… —') : null, available.map((k) => h('option', { value: k, selected: k === val }, METRICS[k].label)));
  const body = h('div');
  root.append(h('div', { class: 'controls wrap' },
    mkSel(st.a, false, (v) => { st.a = v; draw(); }),
    mkSel(st.b, true, (v) => { st.b = v; draw(); }),
    segmented([[30, '30d'], [90, '90d'], [365, '1y'], ['all', 'All']], st.range, (v) => { st.range = v; draw(); })), body);

  function draw() {
    body.replaceChildren();
    const dates = rangeDates(st.range);
    const A = vals(dates, st.a);
    const t = todayStr();
    const win = (k, from, to) => mean(values([...Array(to - from + 1)].map((_, i) => addDays(t, -from - i)), k, METRICS[k].f || ((v) => v)));
    const m = METRICS[st.a];
    const last7 = win(st.a, 0, 6), prev7 = win(st.a, 7, 13), last30 = win(st.a, 0, 29), yr = win(st.a, 0, 364);
    body.append(h('div', { class: 'kpis' },
      kpi('Last 7 days', isNum(last7) ? fmtM(st.a)(last7) : '–', h('span', null, 'vs prior week ', delta(isNum(last7) && isNum(prev7) ? last7 - prev7 : undefined, { d: m.d ?? 1, goodWhen: m.good }))),
      kpi('30-day avg', isNum(last30) ? fmtM(st.a)(last30) : '–'),
      kpi('1-year avg', isNum(yr) ? fmtM(st.a)(yr) : '–', isNum(last30) && isNum(yr) ? h('span', null, 'now ', delta(last30 - yr, { d: m.d ?? 1, goodWhen: m.good })) : '')));

    const c1 = chartBox(230, m.label);
    body.append(card(m.label, c1.box));
    let c2, c3, corr;
    if (st.b) {
      c2 = chartBox(190, METRICS[st.b].label);
      body.append(card(METRICS[st.b].label, c2.box));
      const B = vals(dates, st.b);
      const shifted = st.lag ? B.slice(st.lag).concat(Array(st.lag).fill(null)) : B;
      corr = pearson(A, shifted);
      c3 = chartBox(240, 'Correlation');
      const r = corr.r;
      const strength = !isNum(r) ? 'not enough data' : Math.abs(r) < 0.1 ? 'no meaningful relationship' : Math.abs(r) < 0.3 ? 'weak' : Math.abs(r) < 0.5 ? 'moderate' : 'strong';
      body.append(card('Relationship',
        segmented([[0, 'Same day'], [1, `${METRICS[st.b].label} next day`]], st.lag, (v) => { st.lag = v; draw(); }),
        h('p', null, h('strong', null, isNum(r) ? `r = ${r.toFixed(2)}` : '–'), ` · ${strength}${isNum(r) && Math.abs(r) >= 0.1 ? (r > 0 ? ' (they rise together)' : ' (one rises as the other falls)') : ''} · ${corr.n} days`),
        h('p', { class: 'muted small' }, 'Correlation is not causation, but a consistent pattern over months is worth acting on.'), c3.box));
    }

    const hm = h('div', { class: 'heatmap-wrap' });
    const yDates = rangeDates(365);
    body.append(card(`${m.label}: last 12 months`, hm));
    heatmap(hm, yDates, (d) => { const v = day(d)[st.a]; return isNum(v) ? (m.f ? m.f(v) : v) : undefined; }, { fmt: fmtM(st.a) });

    body.append(tagImpact());

    requestAnimationFrame(() => {
      timeChart(c1.canvas, dates, [
        { label: 'Daily', kind: dates.length > 120 ? undefined : 'dots', data: A, color: dates.length > 120 ? tok('seq-250') : tok('seq-300'), width: 1 },
        { label: '7-day avg', data: rolling(A, 7, 3), color: tok('series-1') },
        { label: '28-day avg', data: rolling(A, 28, 10), color: tok('series-2') },
      ], { yFmt: fmtM(st.a) });
      if (c2) {
        const B = vals(dates, st.b);
        timeChart(c2.canvas, dates, [{ label: 'Daily', kind: 'dots', data: B, color: tok('seq-300') }, { label: '7-day avg', data: rolling(B, 7, 3), color: tok('series-3') }], { yFmt: fmtM(st.b) });
        const pts = [];
        dates.forEach((d, i) => { const x = A[i], y = st.lag ? vals([addDays(d, st.lag)], st.b)[0] : B[i]; if (isNum(x) && isNum(y)) pts.push({ x, y, d }); });
        let fit;
        if (pts.length > 4) {
          const mx = mean(pts.map((p) => p.x)), my = mean(pts.map((p) => p.y));
          const sl = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / pts.reduce((s, p) => s + (p.x - mx) ** 2, 0);
          const xs = pts.map((p) => p.x);
          const lo = Math.min(...xs), hi = Math.max(...xs);
          if (isNum(sl)) fit = [{ x: lo, y: my + sl * (lo - mx) }, { x: hi, y: my + sl * (hi - mx) }];
        }
        scatterChart(c3.canvas, pts, { xTitle: METRICS[st.a].label, yTitle: METRICS[st.b].label + (st.lag ? ' (next day)' : ''), xFmt: fmtM(st.a), yFmt: fmtM(st.b), color: tok('series-1'), fit });
      }
    });
  }
  draw();
}

// For each journal tag: how next night's HRV / sleep score / resting HR compare with untagged days.
function tagImpact() {
  const entries = Object.entries(DB.journal || {});
  const tags = new Map();
  for (const [d, e] of entries) for (const t of e.tags || []) { if (!tags.has(t)) tags.set(t, []); tags.get(t).push(d); }
  const outcomes = [['hrv', 'HRV', 'up', 'ms'], ['sleepScore', 'Sleep score', 'up', ''], ['rhr', 'Resting HR', 'down', 'bpm'], ['bbMax', 'Body Battery', 'up', '']];
  const rows = [];
  const tagged = new Set(entries.filter(([, e]) => e.tags?.length).map(([d]) => d));
  const first = entries.map(([d]) => d).sort()[0];
  if (!first) return card('Tag impact', empty('Tag days on the Today screen (alcohol, late meal, sauna…). After a few weeks this shows what each one does to your recovery.'));
  const allDays = [...DB.days.keys()].filter((d) => d >= first);
  for (const [tag, ds] of [...tags.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (ds.length < 3) continue;
    const cells = outcomes.map(([k, , good, unit]) => {
      const withT = mean(ds.map((d) => day(addDays(d, 1))[k]));
      const without = mean(allDays.filter((d) => !tagged.has(d)).map((d) => day(addDays(d, 1))[k]));
      if (!isNum(withT) || !isNum(without)) return h('td', null, '–');
      const diff = withT - without;
      const pct = without ? (diff / without) * 100 : 0;
      return h('td', null, delta(diff, { d: 1, unit: unit ? ' ' + unit : '', goodWhen: good }), h('span', { class: 'muted small' }, ` ${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`));
    });
    rows.push(h('tr', null, h('td', null, h('strong', null, tag), h('div', { class: 'muted small' }, `${ds.length} days`)), ...cells));
  }
  return card('Tag impact (next night vs untagged days)', rows.length
    ? h('div', { class: 'table-wrap' }, h('table', { class: 'table' }, h('thead', null, h('tr', null, h('th', null, 'Tag'), ...outcomes.map(([, l]) => h('th', null, l)))), h('tbody', null, rows)))
    : empty('Need at least 3 tagged days per tag.'));
}

export { fmtDate };
