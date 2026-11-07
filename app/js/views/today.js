import { h, card, kpi, statusChip, fmtDur, fmtInt, fmtNum, fmtDate, fmtW, wUnit, toW, fromW, todayStr, addDays, weekStart, isNum, sum, mean, delta, toast } from '../ui.js';
import { DB, day, baseline, latest, weightTrend, trainingLoad, sleepTargetH } from '../data.js';
import { api } from '../api.js';
import { timeChart, chartBox, tok } from '../charts.js';
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

export function render(root) {
  const t = todayStr();
  const r = day(t);
  const { verdict, signals } = recovery(t);

  root.append(h('header', { class: 'page-head' },
    h('div', null, h('h1', null, 'Today'), h('div', { class: 'sub' }, fmtDate(t, { weekday: true, year: true })))));

  root.append(h('section', { class: `card verdict v-${verdict.level}` },
    h('div', { class: 'verdict-top' }, statusChip(verdict.level, verdict.title)),
    h('p', { class: 'verdict-text' }, verdict.text),
    signals.length ? h('ul', { class: 'signals' }, signals.map((s) => h('li', null, statusChip(s.level, s.name), h('span', { class: 'muted' }, s.why)))) : null,
    h('a', { class: 'link', href: `#/day/${t}` }, 'Last night in detail →')));

  // Week-to-date intensity minutes (Mon start), WHO goal 150
  const ws = weekStart(t);
  const wk = [];
  for (let d = ws; d <= t; d = addDays(d, 1)) wk.push(day(d));
  const im = sum(wk.map((x) => (x.imMod || 0) + 2 * (x.imVig || 0)));
  const imGoal = r.imGoal || 150;

  const trend = weightTrend();
  const tw = trend[trend.length - 1];
  const tw7 = trend[trend.length - 8];
  const sleepRow = isNum(r.sleepSec) ? r : (latest('sleepSec', 2) ? day(latest('sleepSec', 2).date) : {});
  const hrvL = latest('hrv', 2);
  const rhrBase = baseline('rhr', t, 30);

  const grid = h('div', { class: 'kpis' },
    kpi('Sleep', isNum(sleepRow.sleepSec) ? fmtDur(sleepRow.sleepSec, { short: true }) : '–', isNum(sleepRow.sleepScore) ? `Score ${sleepRow.sleepScore} · ${String(sleepRow.sleepQual || '').toLowerCase()}` : 'no data', { href: '#/sleep' }),
    kpi('HRV', hrvL ? `${hrvL.value} ms` : '–', hrvL ? `7d avg ${day(hrvL.date).hrvWeek ?? '–'} · ${String(day(hrvL.date).hrvStatus || '').toLowerCase()}` : 'no data', { href: '#/sleep' }),
    kpi('Resting HR', isNum(r.rhr) ? `${r.rhr} bpm` : '–', isNum(rhrBase) ? h('span', null, '30d ', fmtNum(rhrBase, 0), ' ', delta(isNum(r.rhr) ? r.rhr - rhrBase : undefined, { d: 0 })) : '', { href: '#/trends?m=rhr' }),
    kpi('Body Battery', isNum(r.bbMax) ? `${r.bbMax}` : '–', isNum(r.bbMin) ? `low ${r.bbMin} · +${r.bbCharged ?? '–'} / −${r.bbDrained ?? '–'}` : '', { href: '#/trends?m=bbMax' }),
    kpi('Steps', fmtInt(r.steps), h('span', null, h('progress', { max: r.stepGoal || DB.prefs.stepGoal || 10000, value: r.steps || 0 }), ` of ${fmtInt(r.stepGoal || DB.prefs.stepGoal || 10000)}`), { href: '#/trends?m=steps' }),
    kpi('Stress', isNum(r.stressAvg) ? `${r.stressAvg}` : '–', isNum(r.stressHighMin) ? `${r.stressHighMin} min high` : '', { href: '#/trends?m=stressAvg' }),
    kpi('Intensity min', `${fmtInt(im)}`, h('span', null, h('progress', { max: imGoal, value: Math.min(im, imGoal) }), ` of ${imGoal} this week`), { href: '#/train' }),
    kpi('Weight trend', tw?.trend ? fmtW(tw.trend) : '–', tw7?.trend && tw?.trend ? h('span', null, delta(toW(tw.trend) - toW(tw7.trend), { unit: ' ' + wUnit(), goodWhen: (DB.prefs.goalKg ?? 0) > (tw.trend ?? 0) ? 'up' : 'down' }), ' this week') : 'log a weigh-in', { href: '#/body' }),
  );
  root.append(grid);

  // 14-day sleep + HRV glance
  const dates = [];
  for (let i = 13; i >= 0; i--) dates.push(addDays(t, -i));
  if (dates.some((d) => isNum(day(d).sleepSec))) {
    const c1 = chartBox(150, 'Sleep hours, last 14 nights');
    root.append(card('Last 14 nights', c1.box));
    requestAnimationFrame(() => timeChart(c1.canvas, dates, [
      { label: 'Sleep', kind: 'bar', data: dates.map((d) => (isNum(day(d).sleepSec) ? day(d).sleepSec / 3600 : null)), color: tok('series-1') },
      { label: 'Target', data: dates.map(() => sleepTargetH()), color: tok('text-muted'), dash: true, width: 1.5 },
    ], { yFmt: (v) => `${v.toFixed(1)}h`, yMin: 0 }));
  }

  root.append(journalCard(t));
  root.append(quickWeight());

  const recent = DB.acts.slice(0, 4);
  root.append(card('Recent activities', recent.length ? h('div', { class: 'list' }, recent.map(activityRow)) : h('p', { class: 'empty' }, 'No activities yet.'),
    h('a', { class: 'link', href: '#/train' }, 'All training →')));
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

