// In-memory data model + derived metrics (baselines, trends, training load, weight trend).
import { api, doc, cacheGet, cacheSet } from './api.js';
import { todayStr, addDays, dateRange, isNum, mean, parseD, setUnits, DAY } from './ui.js';

export const DB = {
  status: null,
  days: new Map(), // date -> metrics row
  acts: [], // slim activities, newest first
  actById: new Map(),
  weights: [], // manual entries
  journal: {},
  prefs: {},
  firstDate: null,
};

const listeners = new Set();
export const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (what) => listeners.forEach((fn) => fn(what));

export function applyUnits() {
  const fromProfile = DB.status?.profile?.measurementSystem === 'metric' ? 'metric' : 'imperial';
  setUnits(DB.prefs.units || fromProfile);
}

function ingestYears(dayDocs, actDocs) {
  const days = new Map();
  for (const d of dayDocs) for (const [k, v] of Object.entries(d || {})) days.set(k, v);
  DB.days = new Map([...days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
  DB.firstDate = DB.days.size ? DB.days.keys().next().value : null;
  const acts = [];
  for (const d of actDocs) for (const a of Object.values(d || {})) acts.push(a);
  acts.sort((a, b) => (a.start < b.start ? 1 : -1));
  DB.acts = acts;
  DB.actById = new Map(acts.map((a) => [String(a.id), a]));
}

// Load from cache first (instant), then revalidate from the server.
export async function loadAll({ cachedOnly = false } = {}) {
  if (cachedOnly) {
    const snap = await cacheGet('snapshot');
    if (snap) {
      Object.assign(DB, { status: snap.status, weights: snap.weights || [], journal: snap.journal || {}, prefs: snap.prefs || {} });
      ingestYears(snap.dayDocs || [], snap.actDocs || []);
      applyUnits();
      return true;
    }
    return false;
  }
  const [status, yearsRes, weights, journal, prefs] = await Promise.all([
    api('status'), api('years'), doc('weights', 'weights'), doc('journal', 'journal'), doc('prefs', 'prefs'),
  ]);
  const years = yearsRes.years || [];
  const dayDocs = await Promise.all(years.map((y) => doc('days:' + y, 'days', { year: y })));
  const actDocs = await Promise.all(years.map((y) => doc('act:' + y, 'activities', { year: y })));
  DB.status = status;
  DB.weights = weights?.entries || [];
  DB.journal = journal || {};
  DB.prefs = prefs || {};
  ingestYears(dayDocs, actDocs);
  applyUnits();
  await cacheSet('snapshot', { status, weights: DB.weights, journal: DB.journal, prefs: DB.prefs, dayDocs, actDocs });
  emit('data');
  return true;
}

// ---------- sync loop: keep calling /api/sync until the backfill is done
let syncing = null;
export const syncState = { running: false, last: null, error: null };
export function runSync({ force = false, from } = {}) {
  if (syncing) return syncing;
  syncState.running = true;
  syncState.error = null;
  emit('sync');
  syncing = (async () => {
    let lastPct = -1, stalls = 0;
    try {
      for (let i = 0; i < 400; i++) {
        const r = await api('sync', { method: 'POST', body: { today: todayStr(), force: force && i === 0, from: i === 0 ? from : undefined } });
        syncState.last = r;
        if (DB.status) DB.status.sync = r;
        emit('sync');
        if (r.lastError) { syncState.error = r.lastError.message; break; }
        if (r.busy) { await new Promise((res) => setTimeout(res, 4000)); if (++stalls > 10) break; continue; }
        // Refresh charts every few rounds during a long backfill so data appears as it lands.
        if (i % 3 === 0 || r.done) await loadAll().catch(() => {});
        if (r.done) break;
        const pct = Object.values(r.types || {}).reduce((s, t) => s + t.pct, 0);
        if (pct === lastPct && ++stalls > 3) break;
        lastPct = pct;
      }
      await loadAll();
    } catch (e) {
      syncState.error = e.message;
    } finally {
      syncState.running = false;
      syncing = null;
      emit('sync');
    }
  })();
  return syncing;
}

// ---------- series helpers
export const today = () => todayStr();
export const day = (d) => DB.days.get(d) || {};

export function rangeDates(days) {
  const end = todayStr();
  const start = days === 'all' ? (DB.firstDate || addDays(end, -30)) : addDays(end, -(days - 1));
  return [...dateRange(start, end)];
}
export const values = (dates, key, f = (x) => x) => dates.map((d) => { const v = DB.days.get(d)?.[key]; return isNum(v) ? f(v) : null; });

// Mean of a metric over the n days before `date` (not including it).
export function baseline(key, date, n = 30) {
  const v = [];
  for (let i = 1; i <= n; i++) { const x = DB.days.get(addDays(date, -i))?.[key]; if (isNum(x)) v.push(x); }
  return v.length >= Math.min(5, n / 2) ? mean(v) : undefined;
}

// Latest date (<= today) that has a value for key.
export function latest(key, maxBack = 7) {
  for (let i = 0; i <= maxBack; i++) {
    const d = addDays(todayStr(), -i);
    const v = DB.days.get(d)?.[key];
    if (isNum(v) || (typeof v === 'string' && v)) return { date: d, value: v };
  }
  return null;
}

// ---------- weight: Garmin weigh-ins + manual entries, plus an exponentially smoothed trend
export function weighIns() {
  const pts = [];
  for (const [d, row] of DB.days) if (isNum(row.weight)) pts.push({ date: d, kg: row.weight, fat: row.bodyFat, src: 'garmin' });
  for (const e of DB.weights) pts.push({ date: e.date, kg: e.kg, fat: e.fat, src: 'manual', id: e.id, note: e.note });
  pts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return pts;
}

// Daily trend (EWMA, alpha 0.1, the "Hacker's Diet" smoothing) over every calendar day since the first weigh-in.
export function weightTrend() {
  const pts = weighIns();
  if (!pts.length) return [];
  const byDay = new Map();
  for (const p of pts) { if (!byDay.has(p.date)) byDay.set(p.date, []); byDay.get(p.date).push(p.kg); }
  const out = [];
  let t = null;
  for (const d of dateRange(pts[0].date, todayStr())) {
    const v = byDay.get(d);
    if (v) { const m = mean(v); t = t === null ? m : t + 0.1 * (m - t); }
    out.push({ date: d, trend: t, raw: v ? mean(v) : null });
  }
  return out;
}

// ---------- training load: acute (7d) vs chronic (28d) exponentially weighted load
export function trainingLoad(type = null) {
  const loadByDay = new Map();
  for (const a of DB.acts) {
    if (type && a.type !== type) continue;
    const d = a.start?.slice(0, 10);
    const l = isNum(a.load) ? a.load : isNum(a.tss) ? a.tss : 0;
    loadByDay.set(d, (loadByDay.get(d) || 0) + l);
  }
  if (!loadByDay.size) return [];
  const first = [...loadByDay.keys()].sort()[0];
  const ka = 2 / (7 + 1), kc = 2 / (28 + 1);
  let acute = 0, chronic = 0;
  const out = [];
  for (const d of dateRange(first, todayStr())) {
    const l = loadByDay.get(d) || 0;
    acute = acute + ka * (l - acute);
    chronic = chronic + kc * (l - chronic);
    out.push({ date: d, load: l, acute, chronic, acwr: chronic > 5 ? acute / chronic : null });
  }
  return out;
}

export const actDate = (a) => a.start?.slice(0, 10);
export const actsBetween = (from, to) => DB.acts.filter((a) => { const d = actDate(a); return d >= from && d <= to; });

export async function savePrefs(patch) {
  DB.prefs = await api('prefs', { method: 'PUT', body: patch });
  applyUnits();
  emit('data');
}

export const sleepTargetH = () => DB.prefs.sleepTargetH || 7.5;
export const daysAgo = (d) => Math.round((parseD(todayStr()) - parseD(d)) / DAY);
