// Health benchmarks: catalog, reference ranges, due dates, storage.
// Values are stored in canonical units (kg, cm, seconds, meters, US lab units) and converted for display.
import { api, ApiError, cacheGet, cacheSet } from './api.js';
import { imperial, isNum, todayStr, parseD, DAY } from './ui.js';
import { LIFT, loadLift, exerciseHistory } from './lift.js';
import { DB, latest, baseline } from './data.js';

export const BENCH = { doc: { entries: [] }, etag: null, loaded: false };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export async function loadBench() {
  const cached = await cacheGet('m:benchmarks');
  try {
    const r = await api('m', { query: { name: 'benchmarks' }, headers: cached?.etag ? { 'If-None-Match': cached.etag } : {} });
    if (r.notModified) { BENCH.doc = cached.data; BENCH.etag = cached.etag; }
    else {
      BENCH.doc = { entries: [], ...(r.json ?? r) };
      BENCH.etag = r.etag || null;
      await cacheSet('m:benchmarks', { etag: BENCH.etag, data: BENCH.doc });
    }
  } catch (e) {
    if (cached) { BENCH.doc = cached.data; BENCH.etag = cached.etag; } else if (!(e instanceof ApiError)) throw e;
  }
  BENCH.loaded = true;
  return BENCH.doc;
}
export async function saveBench() {
  const r = await api('m', { method: 'PUT', query: { name: 'benchmarks' }, body: BENCH.doc, headers: BENCH.etag ? { 'If-Match': BENCH.etag } : {} });
  BENCH.etag = r.json?.etag || r.etag || null;
  await cacheSet('m:benchmarks', { etag: BENCH.etag, data: BENCH.doc });
}
export async function addEntry(e) {
  BENCH.doc.entries.push({ id: uid(), at: Date.now(), ...e });
  BENCH.doc.entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  await saveBench();
}
export async function deleteEntry(id) {
  BENCH.doc.entries = BENCH.doc.entries.filter((e) => e.id !== id);
  await saveBench();
}

// Display units
const U = {
  cm: { label: () => (imperial() ? 'in' : 'cm'), to: (v) => (imperial() ? v / 2.54 : v), from: (v) => (imperial() ? v * 2.54 : v), d: 1 },
  kg: { label: () => (imperial() ? 'lb' : 'kg'), to: (v) => (imperial() ? v * 2.20462 : v), from: (v) => (imperial() ? v / 2.20462 : v), d: 1 },
  m: { label: () => (imperial() ? 'mi' : 'km'), to: (v) => (imperial() ? v / 1609.344 : v / 1000), from: (v) => (imperial() ? v * 1609.344 : v * 1000), d: 2 },
  w: { label: () => 'W', to: (v) => v, from: (v) => v, d: 0 },
  plain: (label, d = 0) => ({ label: () => label, to: (v) => v, from: (v) => v, d }),
};

// better: 'low' (good if v < good, warn if v < warn), 'high' (good if v > good, warn if v > warn), 'range' (good:[a,b], warn:[c,d]), 'trend' (no rating)
export const CATALOG = [
  // Vitals & body
  { key: 'bp', cat: 'Vitals & body', name: 'Blood pressure', kind: 'bp', unit: U.plain('mmHg'), every: 30, better: 'bp', how: 'Seated, 5 min rest, 3 readings in the morning, log the average.' },
  { key: 'waist', cat: 'Vitals & body', name: 'Waist circumference', kind: 'num', unit: U.cm, every: 30, better: 'low', good: 94, warn: 102, how: 'At the navel, relaxed, after exhaling. Men: under 37 in is low risk, over 40 in is high.' },
  { key: 'bodyfat', cat: 'Vitals & body', name: 'Body fat (scale)', kind: 'num', unit: U.plain('%', 1), every: 30, better: 'range', good: [10, 20], warn: [8, 25], how: 'Bioimpedance scale, same conditions each time. Trend only; the absolute number is rough.' },
  // Strength & fitness tests
  { key: 'grip', cat: 'Fitness tests', name: 'Grip strength', kind: 'num', unit: U.kg, every: 90, better: 'high', good: 45, warn: 35, how: 'Dynamometer, best of 3 per hand, log the stronger hand.' },
  { key: 'hang', cat: 'Fitness tests', name: 'Dead hang', kind: 'time', unit: U.plain('s'), every: 90, better: 'high', good: 60, warn: 30, how: 'Overhand grip, feet off the floor, until you drop.' },
  { key: 'plank', cat: 'Fitness tests', name: 'Plank hold', kind: 'time', unit: U.plain('s'), every: 90, better: 'high', good: 120, warn: 60, how: 'Forearm plank, hips level. Stop when form breaks.' },
  { key: '5k', cat: 'Fitness tests', name: '5K time trial', kind: 'time', unit: U.plain(''), every: 90, better: 'trend', lower: true, how: 'Flat route, rested, same course each time.' },
  { key: 'ftp', cat: 'Fitness tests', name: 'FTP (20-min test × 0.95)', kind: 'num', unit: U.w, every: 90, better: 'trend', how: 'Cycling: 20 min all-out after a warm-up, FTP = average power × 0.95.' },
  { key: 'cooper', cat: 'Fitness tests', name: 'Cooper 12-minute run', kind: 'num', unit: U.m, every: 90, better: 'trend', how: 'Distance covered in 12 minutes on a track.' },
  { key: 'maxhr', cat: 'Fitness tests', name: 'Max heart rate (measured)', kind: 'num', unit: U.plain('bpm'), every: 365, better: 'trend', how: 'Peak from hill repeats or a race finish. Set this in Garmin Connect too.' },
  { key: 'lthr', cat: 'Fitness tests', name: 'Lactate threshold HR', kind: 'num', unit: U.plain('bpm'), every: 180, better: 'trend', how: 'Garmin guided test (chest strap) or ~60-min race average HR.' },
  // Labs
  { key: 'apob', cat: 'Bloodwork', name: 'ApoB', kind: 'num', unit: U.plain('mg/dL'), every: 365, better: 'low', good: 90, warn: 120, how: 'Ask for it specifically; standard lipid panels skip it.' },
  { key: 'ldl', cat: 'Bloodwork', name: 'LDL cholesterol', kind: 'num', unit: U.plain('mg/dL'), every: 365, better: 'low', good: 100, warn: 130 },
  { key: 'hdl', cat: 'Bloodwork', name: 'HDL cholesterol', kind: 'num', unit: U.plain('mg/dL'), every: 365, better: 'high', good: 50, warn: 40 },
  { key: 'trig', cat: 'Bloodwork', name: 'Triglycerides', kind: 'num', unit: U.plain('mg/dL'), every: 365, better: 'low', good: 100, warn: 150, how: 'Fasting.' },
  { key: 'a1c', cat: 'Bloodwork', name: 'HbA1c', kind: 'num', unit: U.plain('%', 1), every: 365, better: 'low', good: 5.5, warn: 5.7 },
  { key: 'glucose', cat: 'Bloodwork', name: 'Fasting glucose', kind: 'num', unit: U.plain('mg/dL'), every: 365, better: 'low', good: 95, warn: 100 },
  { key: 'insulin', cat: 'Bloodwork', name: 'Fasting insulin', kind: 'num', unit: U.plain('µIU/mL', 1), every: 365, better: 'low', good: 8, warn: 12 },
  { key: 'crp', cat: 'Bloodwork', name: 'hs-CRP', kind: 'num', unit: U.plain('mg/L', 1), every: 365, better: 'low', good: 1, warn: 3 },
  { key: 'ferritin', cat: 'Bloodwork', name: 'Ferritin', kind: 'num', unit: U.plain('ng/mL'), every: 365, better: 'range', good: [50, 150], warn: [30, 300] },
  { key: 'vitd', cat: 'Bloodwork', name: 'Vitamin D (25-OH)', kind: 'num', unit: U.plain('ng/mL'), every: 365, better: 'range', good: [40, 60], warn: [30, 80] },
  { key: 'tsh', cat: 'Bloodwork', name: 'TSH', kind: 'num', unit: U.plain('mIU/L', 2), every: 365, better: 'range', good: [0.5, 2.5], warn: [0.4, 4] },
  { key: 'testo', cat: 'Bloodwork', name: 'Testosterone (total)', kind: 'num', unit: U.plain('ng/dL'), every: 365, better: 'range', good: [500, 900], warn: [300, 1100], how: 'Morning draw, fasted.' },
  // Scans & checkups
  { key: 'dexa_fat', cat: 'Scans & checkups', name: 'DEXA body fat', kind: 'num', unit: U.plain('%', 1), every: 365, better: 'range', good: [10, 20], warn: [8, 25], how: 'The body-fat number to trust. ~$100–150.' },
  { key: 'dexa_vat', cat: 'Scans & checkups', name: 'DEXA visceral fat (VAT area)', kind: 'num', unit: U.plain('cm²'), every: 365, better: 'low', good: 100, warn: 160 },
  { key: 'dexa_lean', cat: 'Scans & checkups', name: 'DEXA lean mass', kind: 'num', unit: U.kg, every: 365, better: 'trend' },
  { key: 'tscore', cat: 'Scans & checkups', name: 'Bone density (T-score)', kind: 'num', unit: U.plain('', 1), every: 730, better: 'high', good: -1, warn: -2.5 },
  { key: 'cac', cat: 'Scans & checkups', name: 'Coronary calcium score', kind: 'num', unit: U.plain('Agatston'), every: 1825, better: 'low', good: 1, warn: 100, how: 'One-time CT scan, 40+. Zero is the goal; repeat in 5 years if zero.' },
  { key: 'dental', cat: 'Scans & checkups', name: 'Dental checkup', kind: 'date', every: 180 },
  { key: 'skin', cat: 'Scans & checkups', name: 'Skin check', kind: 'date', every: 365 },
  { key: 'eye', cat: 'Scans & checkups', name: 'Eye exam', kind: 'date', every: 730 },
  { key: 'physical', cat: 'Scans & checkups', name: 'Annual physical', kind: 'date', every: 365 },
];
export const CATS = [...new Set(CATALOG.map((b) => b.cat))];
export const byKey = (k) => CATALOG.find((b) => b.key === k);

export function rate(b, v, v2) {
  if (!b || !isNum(v)) return null;
  if (b.better === 'bp') return v < 120 && v2 < 80 ? 'good' : v < 130 && v2 < 80 ? 'warn' : 'bad';
  if (b.better === 'low') return v < b.good ? 'good' : v < b.warn ? 'warn' : 'bad';
  if (b.better === 'high') return v > b.good ? 'good' : v > b.warn ? 'warn' : 'bad';
  if (b.better === 'range') return v >= b.good[0] && v <= b.good[1] ? 'good' : v >= b.warn[0] && v <= b.warn[1] ? 'warn' : 'bad';
  return null;
}
export const RATE_TEXT = { good: 'In range', warn: 'Borderline', bad: 'Out of range' };

export const fmtTime = (sec) => { sec = Math.round(sec); const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, '0')}`; };
export function fmtValue(b, e) {
  if (!e) return '–';
  if (b.kind === 'date') return 'Done';
  if (b.kind === 'bp') return `${e.value}/${e.value2}`;
  if (b.kind === 'time') return fmtTime(e.value);
  return `${b.unit.to(e.value).toFixed(b.unit.d ?? 0)}${b.unit.label() ? ' ' + b.unit.label() : ''}`;
}

export const entriesFor = (key) => BENCH.doc.entries.filter((e) => e.key === key);
export const lastEntry = (key) => entriesFor(key).slice(-1)[0] || null;

// Due state: { status: 'overdue'|'soon'|'ok'|'never', days } where days < 0 means overdue by that many.
export function due(b) {
  const last = lastEntry(b.key);
  if (!last) return { status: 'never', days: null };
  const dueDate = parseD(last.date) + b.every * DAY;
  const days = Math.round((dueDate - parseD(todayStr())) / DAY);
  return { status: days < 0 ? 'overdue' : days <= 14 ? 'soon' : 'ok', days, dueDate: new Date(dueDate).toISOString().slice(0, 10) };
}
export function dueList() {
  return CATALOG.map((b) => ({ b, ...due(b) })).filter((x) => x.status === 'overdue' || x.status === 'soon')
    .sort((a, c) => (a.days ?? 0) - (c.days ?? 0));
}

// Automatic benchmarks FIT already knows: read-only rows shown alongside the logged ones.
export async function autoRows() {
  const rows = [];
  const vo2 = DB.acts.find((a) => isNum(a.vo2));
  if (vo2) rows.push({ name: 'VO₂ max (Garmin)', value: `${vo2.vo2}`, sub: `from ${vo2.start.slice(0, 10)}`, href: '#/train', level: vo2.vo2 >= 50 ? 'good' : vo2.vo2 >= 40 ? 'warn' : 'bad' });
  const rhr = baseline('rhr', todayStr(), 30);
  if (isNum(rhr)) rows.push({ name: 'Resting HR (30-day avg)', value: `${Math.round(rhr)} bpm`, href: '#/trends?m=rhr', level: rhr < 60 ? 'good' : rhr < 70 ? 'warn' : 'bad' });
  const hrv = latest('hrv', 7);
  if (hrv) rows.push({ name: 'HRV (7-day avg)', value: `${DB.days.get(hrv.date)?.hrvWeek ?? hrv.value} ms`, sub: String(DB.days.get(hrv.date)?.hrvStatus || '').toLowerCase(), href: '#/sleep', level: /BALANCED/.test(DB.days.get(hrv.date)?.hrvStatus || '') ? 'good' : 'warn' });
  const fa = DB.status?.fitnessAge;
  if (isNum(fa?.fitnessAge)) rows.push({ name: 'Fitness age (Garmin)', value: fa.fitnessAge.toFixed(1), sub: `actual ${fa.chronologicalAge ?? '–'}`, level: fa.fitnessAge <= (fa.chronologicalAge ?? 99) ? 'good' : 'warn' });
  try {
    if (!LIFT.sessions.sessions.length) await loadLift();
    for (const [id, label] of [['squat', 'Squat e1RM'], ['bench', 'Bench press e1RM'], ['deadlift', 'Deadlift e1RM'], ['ohp', 'Overhead press e1RM']]) {
      const h = exerciseHistory(id);
      if (!h.length) continue;
      const best = h.reduce((m, x) => (x.e1rm > m.e1rm ? x : m));
      const w = imperial() ? `${Math.round(best.e1rm * 2.20462)} lb` : `${best.e1rm.toFixed(1)} kg`;
      rows.push({ name: label, value: w, sub: `${best.date} · from ${imperial() ? Math.round(best.kg * 2.20462) + ' lb' : best.kg + ' kg'} × ${best.reps}`, href: '#/lift' });
    }
  } catch { /* lift data optional */ }
  return rows;
}

export function benchCsv() {
  const esc = (v) => (v === undefined || v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const rows = BENCH.doc.entries.map((e) => { const b = byKey(e.key) || { name: e.key, unit: U.plain('') }; return [e.date, e.key, b.name, e.value ?? '', e.value2 ?? '', b.kind === 'num' ? b.unit.label() : b.kind === 'time' ? 'seconds' : b.kind === 'bp' ? 'mmHg' : '', e.note || '']; });
  return ['date,key,benchmark,value,value2,unit,note', ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

export { U };
