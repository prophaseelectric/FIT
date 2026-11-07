// One day in full: intraday heart rate, Body Battery, overnight HRV readings, sleep record, SpO2, food.
import { h, card, kpi, fmtDate, fmtDur, fmtClock, wallMinutes, isNum, addDays, todayStr, empty, fmtInt } from '../ui.js';
import { DB, day } from '../data.js';
import { api, cacheGet, cacheSet } from '../api.js';
import { xyChart, chartBox, tok } from '../charts.js';
import { activityRow } from './train.js';
import { journalCard } from './today.js';

// Garmin intraday arrays come with column descriptors; find the column index by key.
function cols(desc, values, valueKey) {
  if (!Array.isArray(values)) return [];
  const ti = (desc || []).find((d) => /timestamp/i.test(d.key))?.index ?? 0;
  const vi = (desc || []).find((d) => d.key === valueKey || new RegExp(valueKey, 'i').test(d.key))?.index ?? 1;
  return values.map((r) => [r[ti], r[vi]]).filter(([t, v]) => isNum(t) && isNum(v) && v >= 0);
}
// wall-clock hour of day from a GMT ms timestamp using the browser's offset
const hourOf = (ms) => { const d = new Date(ms); return d.getHours() + d.getMinutes() / 60; };
const hFmt = (v) => fmtClock(v * 60);

export async function render(root, date) {
  const t = todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) date = t;
  const r = day(date);
  root.append(h('div', { class: 'day-nav' },
    h('a', { class: 'btn ghost small', href: `#/day/${addDays(date, -1)}` }, '← Prev'),
    h('strong', null, fmtDate(date, { weekday: true, year: true })),
    date < t ? h('a', { class: 'btn ghost small', href: `#/day/${addDays(date, 1)}` }, 'Next →') : h('span')));

  root.append(h('div', { class: 'kpis' },
    kpi('Sleep', isNum(r.sleepSec) ? fmtDur(r.sleepSec, { short: true }) : '–', isNum(r.sleepStart) ? `${fmtClock(wallMinutes(r.sleepStart))} → ${fmtClock(wallMinutes(r.sleepEnd))}` : ''),
    kpi('Sleep score', r.sleepScore ?? '–', r.sleepQual ? String(r.sleepQual).toLowerCase() : ''),
    kpi('Stages', isNum(r.deepSec) ? `${fmtDur(r.deepSec, { short: true })} deep` : '–', isNum(r.remSec) ? `${fmtDur(r.remSec, { short: true })} REM · ${fmtDur(r.lightSec, { short: true })} light · ${fmtDur(r.awakeSec, { short: true })} awake` : ''),
    kpi('HRV', isNum(r.hrv) ? `${r.hrv} ms` : '–', r.hrvStatus ? `${String(r.hrvStatus).toLowerCase()} · 5-min high ${r.hrvHigh ?? '–'}` : ''),
    kpi('Resting HR', isNum(r.rhr) ? `${r.rhr} bpm` : '–', isNum(r.hrMax) ? `range ${r.hrMin}–${r.hrMax}` : ''),
    kpi('Body Battery', isNum(r.bbMax) ? `${r.bbMin}–${r.bbMax}` : '–', isNum(r.bbCharged) ? `+${r.bbCharged} / −${r.bbDrained}` : ''),
    kpi('Stress', r.stressAvg ?? '–', isNum(r.restMin) ? `${fmtDur(r.restMin * 60, { short: true })} rest · ${r.stressHighMin ?? 0}m high` : ''),
    kpi('Steps', fmtInt(r.steps), isNum(r.floors) ? `${r.floors} floors` : ''),
    kpi('Calories', fmtInt(r.calTotal), isNum(r.calActive) ? `${fmtInt(r.calActive)} active` : ''),
    kpi('Breathing', isNum(r.sleepResp) ? `${r.sleepResp} brpm` : '–', 'asleep'),
    kpi('SpO₂', isNum(r.sleepSpo2) ? `${r.sleepSpo2}%` : isNum(r.spo2Avg) ? `${r.spo2Avg}%` : '–', isNum(r.spo2Min) ? `low ${r.spo2Min}%` : ''),
    kpi('Intensity min', fmtInt((r.imMod || 0) + 2 * (r.imVig || 0)), `${r.imMod || 0} mod · ${r.imVig || 0} vig`)));
  if (r.sleepFeedback) root.append(h('p', { class: 'muted small' }, 'Garmin sleep feedback: ', String(r.sleepFeedback).replace(/_/g, ' ').toLowerCase()));

  const acts = DB.acts.filter((a) => a.start?.startsWith(date));
  if (acts.length) root.append(card('Activities', h('div', { class: 'list' }, acts.map(activityRow))));
  root.append(journalCard(date));

  const box = h('div', null, h('p', { class: 'muted' }, 'Loading intraday detail…'));
  root.append(box);
  let d = await cacheGet('day:' + date);
  if (!d || date >= addDays(t, -2)) {
    try {
      d = await api('day', { query: { date, today: t } });
      if (date < addDays(t, -2)) await cacheSet('day:' + date, d);
    } catch (e) {
      if (!d) { box.replaceChildren(empty('Intraday detail unavailable: ' + e.message)); return; }
    }
  }
  if (!root.isConnected) return;
  box.replaceChildren();

  const hr = cols(d.hr?.heartRateValueDescriptors, d.hr?.heartRateValues, 'heartrate');
  const bb = cols(d.bb?.bodyBatteryValueDescriptorDTOList, d.bb?.bodyBatteryValuesArray, 'bodyBatteryLevel');
  const hrv = (d.hrv?.hrvReadings || []).map((x) => [Date.parse(x.readingTimeGMT ? x.readingTimeGMT + 'Z' : x.readingTimeLocal), x.hrvValue]).filter(([a, b]) => isNum(a) && isNum(b));
  const charts = [];
  if (hr.length) charts.push(['Heart rate', hr, tok('series-8'), (v) => `${Math.round(v)} bpm`]);
  if (bb.length) charts.push(['Body Battery', bb, tok('series-3'), (v) => Math.round(v), true]);
  if (hrv.length) charts.push(['HRV readings (overnight, 5-min)', hrv, tok('series-1'), (v) => `${Math.round(v)} ms`]);
  for (const [label, pts, color, yFmt, fill] of charts) {
    const c = chartBox(170, label);
    box.append(card(label, c.box));
    requestAnimationFrame(() => xyChart(c.canvas, [{ label, data: pts.map(([ts, v]) => ({ x: (ts - Date.parse(date + 'T00:00:00')) / 3600000, y: v })), color, fill, fillColor: fill ? color + '33' : undefined }], { xFmt: hFmt, yFmt }));
  }
  const events = d.bb?.bodyBatteryActivityEvent || [];
  if (events.length) box.append(card('What moved your Body Battery', h('ul', { class: 'plain' }, events.map((e) => h('li', null, `${String(e.eventType || e.activityType || 'event').replace(/_/g, ' ').toLowerCase()}: ${e.bodyBatteryImpact > 0 ? '+' : ''}${e.bodyBatteryImpact ?? ''}${e.durationInMilliseconds ? ' · ' + fmtDur(e.durationInMilliseconds / 1000, { short: true }) : ''}`)))));

  const food = d.food && !d.food.error && !d.food.mock ? d.food : null;
  const meals = food?.mealDetails || food?.meals || food?.loggedFoods;
  if (food) box.append(card('Nutrition (from Garmin Connect)', h('pre', { class: 'json small' }, JSON.stringify(meals || food, null, 1).slice(0, 4000))));
  if (!charts.length) box.append(empty('No intraday data for this day.'));
  box.append(h('details', { class: 'card' }, h('summary', null, 'Raw Garmin data for this day'), h('pre', { class: 'json small' }, JSON.stringify(d, null, 1).slice(0, 60000))));
}
