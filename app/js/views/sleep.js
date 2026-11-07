import { h, card, kpi, segmented, fmtDur, fmtDate, fmtClock, wallMinutes, isNum, mean, sd, sum, rolling, dow, WEEKDAYS, empty } from '../ui.js';
import { DB, rangeDates, values, sleepTargetH, day } from '../data.js';
import { timeChart, barChart, rangeBars, chartBox, tok } from '../charts.js';

let range = 30;

export function render(root) {
  root.append(h('header', { class: 'page-head' }, h('h1', null, 'Sleep')));
  const body = h('div');
  root.append(h('div', { class: 'controls' }, segmented([[14, '2w'], [30, '30d'], [90, '90d'], [365, '1y'], ['all', 'All']], range, (v) => { range = v; draw(); })), body);

  function draw() {
    body.replaceChildren();
    const dates = rangeDates(range);
    const nights = dates.filter((d) => isNum(day(d).sleepSec));
    if (!nights.length) { body.append(card(null, empty('No sleep data in this range yet.'))); return; }

    const target = sleepTargetH();
    const durs = nights.map((d) => day(d).sleepSec / 3600);
    const bed = nights.map((d) => day(d).sleepStart).filter(isNum).map((ms) => { const m = wallMinutes(ms); return m < 12 * 60 ? m + 1440 : m; });
    const wake = nights.map((d) => day(d).sleepEnd).filter(isNum).map(wallMinutes);
    const need = nights.map((d) => (day(d).sleepNeedMin ? day(d).sleepNeedMin / 60 : target));
    const debt7 = sum(nights.slice(-7).map((d, i, arr) => (need[need.length - arr.length + i]) - day(d).sleepSec / 3600));
    const bedSd = sd(bed);

    body.append(h('div', { class: 'kpis' },
      kpi('Avg sleep', fmtDur(mean(durs) * 3600, { short: true }), `${nights.length} nights · target ${target}h`),
      kpi('Avg score', isNum(mean(values(nights, 'sleepScore'))) ? Math.round(mean(values(nights, 'sleepScore'))) : '–', ''),
      kpi('Bedtime', bed.length ? fmtClock(mean(bed)) : '–', isNum(bedSd) ? `±${Math.round(bedSd)} min${bedSd > 45 ? ' · irregular' : bedSd < 25 ? ' · consistent' : ''}` : ''),
      kpi('Wake time', wake.length ? fmtClock(mean(wake)) : '–', isNum(sd(wake)) ? `±${Math.round(sd(wake))} min` : ''),
      kpi('7-night debt', `${debt7 > 0 ? '' : '+'}${fmtDur(Math.abs(debt7) * 3600, { short: true })}`, debt7 > 0 ? 'short of your need' : 'surplus vs need'),
      kpi('Avg HRV', isNum(mean(values(nights, 'hrv'))) ? `${Math.round(mean(values(nights, 'hrv')))} ms` : '–', 'overnight')));

    const c1 = chartBox(220, 'Sleep stages per night');
    body.append(card('Sleep stages', c1.box));
    const c2 = chartBox(170, 'Sleep score');
    body.append(card('Sleep score', c2.box));
    const c3 = chartBox(200, 'Sleep window');
    body.append(card('Sleep window', h('p', { class: 'muted small' }, 'When you fell asleep and woke up. Consistency matters as much as duration.'), c3.box));
    const c4 = chartBox(180, 'HRV overnight');
    body.append(card('HRV (overnight average)', h('p', { class: 'muted small' }, 'Shaded band is your balanced baseline range from Garmin. Dropping below it for several days usually means stress, illness, or overreaching.'), c4.box));
    const c5 = chartBox(150, 'Sleeping heart rate'), c6 = chartBox(150, 'Respiration');
    body.append(card('Sleeping heart rate', c5.box), card('Breathing rate', c6.box));
    const c7 = chartBox(170, 'Average sleep by weekday');
    body.append(card('By weekday', c7.box));

    const tbl = h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Night of'), h('th', null, 'Sleep'), h('th', null, 'Score'), h('th', null, 'Bed'), h('th', null, 'Wake'), h('th', null, 'HRV'))),
      h('tbody', null, [...nights].reverse().slice(0, 60).map((d) => {
        const r = day(d);
        return h('tr', { class: 'click', onclick: () => { location.hash = `#/day/${d}`; } },
          h('td', null, fmtDate(d, { weekday: true })), h('td', null, fmtDur(r.sleepSec, { short: true })), h('td', null, r.sleepScore ?? '–'),
          h('td', null, isNum(r.sleepStart) ? fmtClock(wallMinutes(r.sleepStart)) : '–'), h('td', null, isNum(r.sleepEnd) ? fmtClock(wallMinutes(r.sleepEnd)) : '–'), h('td', null, r.hrv ?? '–'));
      })));
    body.append(card('Nights', h('div', { class: 'table-wrap' }, tbl)));

    requestAnimationFrame(() => {
      const hrs = (k) => values(dates, k, (v) => v / 3600);
      timeChart(c1.canvas, dates, [
        { label: 'Deep', kind: 'bar', stack: 's', data: hrs('deepSec'), color: tok('seq-650') },
        { label: 'REM', kind: 'bar', stack: 's', data: hrs('remSec'), color: tok('seq-450') },
        { label: 'Light', kind: 'bar', stack: 's', data: hrs('lightSec'), color: tok('seq-250') },
        { label: 'Awake', kind: 'bar', stack: 's', data: hrs('awakeSec'), color: tok('awake') },
        { label: 'Need', data: dates.map((d) => (day(d).sleepNeedMin ? day(d).sleepNeedMin / 60 : (isNum(day(d).sleepSec) ? target : null))), color: tok('text-primary'), dash: true, width: 1.5, spanGaps: false },
      ], { stacked: true, yFmt: (v) => `${(+v).toFixed(1)}h`, yMin: 0 });

      const sc = values(dates, 'sleepScore');
      timeChart(c2.canvas, dates, [
        { label: 'Score', kind: 'dots', data: sc, color: tok('series-1') },
        { label: '7-day avg', data: rolling(sc, 7, 3), color: tok('series-1'), width: 2 },
      ], { yFmt: (v) => Math.round(v), yMax: 100 });

      const toWin = (d) => {
        const r = day(d);
        if (!isNum(r.sleepStart) || !isNum(r.sleepEnd)) return null;
        let s = wallMinutes(r.sleepStart), e = wallMinutes(r.sleepEnd);
        if (s < 12 * 60) s += 1440; // after-midnight bedtimes
        e += 1440;
        if (e <= s) e += 1440;
        return [s, e];
      };
      rangeBars(c3.canvas, dates, dates.map(toWin), { color: tok('series-7'), yFmt: (v) => fmtClock(v), yReverse: true, label: 'Asleep' });

      const hrv = values(dates, 'hrv');
      timeChart(c4.canvas, dates, [
        { label: 'Balanced high', data: values(dates, 'hrvBalHigh'), color: 'transparent', fillTo: '+1', fillColor: tok('band'), width: 0, noLegend: true },
        { label: 'Balanced low', data: values(dates, 'hrvBalLow'), color: 'transparent', width: 0, noLegend: true },
        { label: 'Nightly', kind: 'dots', data: hrv, color: tok('series-1') },
        { label: '7-day avg', data: rolling(hrv, 7, 3), color: tok('series-1') },
      ], { yFmt: (v) => `${Math.round(v)} ms`, noTooltipFor: ['Balanced high', 'Balanced low'] });

      timeChart(c5.canvas, dates, [{ label: 'Sleeping HR', data: values(dates, 'sleepHr'), color: tok('series-8') }, { label: 'Resting HR', data: values(dates, 'rhr'), color: tok('series-2'), dash: true }], { yFmt: (v) => `${Math.round(v)} bpm` });
      timeChart(c6.canvas, dates, [{ label: 'Breaths/min', data: values(dates, 'sleepResp'), color: tok('series-3') }], { yFmt: (v) => (+v).toFixed(1) });

      const byWd = [1, 2, 3, 4, 5, 6, 0].map((w) => mean(nights.filter((d) => dow(d) === w).map((d) => day(d).sleepSec / 3600)));
      barChart(c7.canvas, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], [{ label: 'Avg sleep', data: byWd, color: tok('series-1') }], { yFmt: (v) => `${(+v).toFixed(1)}h`, yMin: 0, legend: false, titleFmt: (l) => `${l} (night before)` });
    });
  }
  draw();
}

