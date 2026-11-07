import { h, card, kpi, segmented, fmtDate, fmtW, toW, fromW, wUnit, todayStr, addDays, isNum, mean, delta, toast, empty, daysBetween, fmtInt } from '../ui.js';
import { DB, weighIns, weightTrend, day, savePrefs } from '../data.js';
import { api } from '../api.js';
import { timeChart, chartBox, tok } from '../charts.js';

let range = 90;

export function render(root) {
  root.append(h('header', { class: 'page-head' }, h('h1', null, 'Body')));

  // Log form
  const date = h('input', { type: 'date', value: todayStr(), max: todayStr(), 'aria-label': 'Date' });
  const w = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: `Weight (${wUnit()})`, required: true, 'aria-label': 'Weight' });
  const fat = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: 'Body fat % (optional)', 'aria-label': 'Body fat percent' });
  root.append(card('Log weigh-in', h('form', { class: 'stack-form', onsubmit: async (e) => {
    e.preventDefault();
    try {
      const d = await api('weights', { method: 'POST', body: { date: date.value, kg: fromW(parseFloat(w.value)), fat: parseFloat(fat.value) || undefined } });
      DB.weights = d.entries; w.value = ''; fat.value = '';
      toast('Saved'); draw();
    } catch (err) { toast(err.message); }
  } }, h('div', { class: 'row-fields' }, date, w, fat), h('button', { class: 'btn', type: 'submit' }, 'Save')),
  h('p', { class: 'muted small' }, 'Weigh-ins from a Garmin Index scale (or logged in Garmin Connect) sync automatically. Garmin\'s Personal API is read-only, so weights logged here stay in FIT.')));

  const body = h('div');
  root.append(h('div', { class: 'controls' }, segmented([[30, '30d'], [90, '90d'], [180, '6m'], [365, '1y'], ['all', 'All']], range, (v) => { range = v; draw(); })), body);

  function draw() {
    body.replaceChildren();
    const trend = weightTrend();
    if (!trend.length) { body.append(card(null, empty('No weigh-ins yet.'))); return; }
    const t = todayStr();
    const at = (n) => trend[trend.length - 1 - n]?.trend;
    const cur = at(0);
    const rate = isNum(at(28)) ? ((cur - at(28)) / 4) : isNum(at(14)) ? (cur - at(14)) / 2 : undefined; // kg/week
    const goal = DB.prefs.goalKg;
    let eta = '';
    if (isNum(goal) && isNum(rate) && Math.abs(rate) > 0.02 && Math.sign(goal - cur) === Math.sign(rate)) {
      const weeks = (goal - cur) / rate;
      eta = `at this rate: ${fmtDate(addDays(t, Math.round(weeks * 7)), { year: true })}`;
    } else if (isNum(goal)) eta = 'not trending toward goal';

    // Energy balance: Garmin total burn vs trend change (7700 kcal per kg)
    const n = 28;
    const burn = mean(Array.from({ length: n }, (_, i) => day(addDays(t, -i - 1)).calTotal));
    const dKg = isNum(at(n)) ? cur - at(n) : undefined;
    const implied = isNum(burn) && isNum(dKg) ? burn + (dKg * 7700) / n : undefined;
    const logged = mean(Array.from({ length: n }, (_, i) => day(addDays(t, -i - 1)).calIn));

    body.append(h('div', { class: 'kpis' },
      kpi('Trend weight', fmtW(cur), 'smoothed, ignores water noise'),
      kpi('Weekly rate', isNum(rate) ? h('span', null, delta(toW(rate), { unit: ' ' + wUnit() + '/wk', goodWhen: isNum(goal) && goal > cur ? 'up' : 'down' })) : '–', isNum(rate) ? `${(rate / cur * 100).toFixed(2)}% of bodyweight` : ''),
      kpi('30-day change', isNum(at(30)) ? h('span', null, delta(toW(cur - at(30)), { unit: ' ' + wUnit(), goodWhen: isNum(goal) && goal > cur ? 'up' : 'down' })) : '–'),
      kpi('Goal', isNum(goal) ? fmtW(goal) : h('button', { class: 'btn ghost small', onclick: setGoal }, 'Set goal'), eta, { cls: 'click' }),
      kpi('Est. intake', isNum(implied) ? `${fmtInt(implied)} kcal` : '–', isNum(implied) ? `Garmin burn ${fmtInt(burn)} − trend change, ${n}d${isNum(logged) ? ` · logged ${fmtInt(logged)}` : ''}` : 'needs 4 weeks of data'),
    ));

    const dates = range === 'all' ? trend.map((x) => x.date) : trend.filter((x) => x.date >= addDays(t, -(range - 1))).map((x) => x.date);
    const byDate = new Map(trend.map((x) => [x.date, x]));
    const c1 = chartBox(240, 'Weight and trend');
    body.append(card('Weight', h('p', { class: 'muted small' }, 'Dots are weigh-ins; the line is the trend (10% exponential smoothing). Watch the line, not the dots.'), c1.box));

    const comp = dates.filter((d) => isNum(day(d).bodyFat) || weighIns().some((p) => p.date === d && isNum(p.fat)));
    let c2;
    if (comp.length > 2) { c2 = chartBox(170, 'Body fat'); body.append(card('Body fat %', c2.box)); }

    const pts = weighIns().reverse().slice(0, 60);
    body.append(card('Weigh-ins', h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Weight'), h('th', null, 'Fat %'), h('th', null, 'Source'), h('th'))),
      h('tbody', null, pts.map((p) => h('tr', null, h('td', null, fmtDate(p.date, { year: true })), h('td', null, fmtW(p.kg)), h('td', null, p.fat ?? '–'), h('td', null, p.src === 'garmin' ? 'Garmin' : 'FIT'),
        h('td', null, p.src === 'manual' ? h('button', { class: 'icon-btn', 'aria-label': 'Delete', onclick: async () => { if (!confirm('Delete this weigh-in?')) return; const d = await api('weights', { method: 'DELETE', query: { id: p.id } }); DB.weights = d.entries; draw(); } }, '✕') : null))))))));

    requestAnimationFrame(() => {
      timeChart(c1.canvas, dates, [
        { label: 'Weigh-in', kind: 'dots', data: dates.map((d) => (isNum(byDate.get(d)?.raw) ? toW(byDate.get(d).raw) : null)), color: tok('seq-300') },
        { label: 'Trend', data: dates.map((d) => (isNum(byDate.get(d)?.trend) ? toW(byDate.get(d).trend) : null)), color: tok('series-1'), width: 2.5 },
        ...(isNum(goal) ? [{ label: 'Goal', data: dates.map(() => toW(goal)), color: tok('status-good'), dash: true, width: 1.5 }] : []),
      ], { yFmt: (v) => `${(+v).toFixed(1)} ${wUnit()}` });
      if (c2) {
        const fatBy = new Map();
        for (const p of weighIns()) if (isNum(p.fat)) fatBy.set(p.date, p.fat);
        timeChart(c2.canvas, dates, [{ label: 'Body fat', kind: 'dots', data: dates.map((d) => fatBy.get(d) ?? null), color: tok('series-2') }], { yFmt: (v) => `${(+v).toFixed(1)}%`, legend: false });
      }
    });
  }

  async function setGoal() {
    const v = prompt(`Goal weight (${wUnit()})`, DB.prefs.goalKg ? toW(DB.prefs.goalKg).toFixed(1) : '');
    if (v === null) return;
    const n = parseFloat(v);
    await savePrefs({ goalKg: isNum(n) && n > 0 ? fromW(n) : null });
    draw();
  }
  draw();
  void daysBetween;
}
