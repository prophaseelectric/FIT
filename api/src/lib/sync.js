// Resumable sync from the Garmin Personal API into the document store.
//
// Each run: (1) catch every data type up to today, (2) walk backwards toward the backfill
// start date in chunks sized to Garmin's documented per-call range limits, newest first,
// until the time budget runs out. The client calls /api/sync again while `done` is false.
'use strict';

const { getJson, putJson, updateJson } = require('./store');
const { getGarmin } = require('./garmin');
const { TYPES, TYPE_KEYS, slimActivity } = require('./normalize');

const STATE_KEY = 'state/sync.json';
const DAY = 86400000;

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const parse = (d) => Date.parse(d + 'T00:00:00Z');
const addDays = (d, n) => iso(parse(d) + n * DAY);
const minD = (a, b) => (a < b ? a : b);
const maxD = (a, b) => (a > b ? a : b);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parse(s));

// max = Garmin's documented max days per request (Swagger: summaries 1y, sleep 31d, steps/stress 28d).
const SOURCES = {
  dailies: {
    label: 'Daily summaries', max: 365,
    fetch: (g, f, t) => g.get('/usersummary-service/v2/dailysummaries', { startDate: f, endDate: t }),
    items: (r) => r?.data || [], date: (it) => it.calendarDate,
  },
  sleep: {
    label: 'Sleep', max: 31,
    fetch: (g, f, t) => g.get('/sleep-service/sleep/dailySleepSummariesByDate', { startDate: f, endDate: t }),
    items: (r) => (Array.isArray(r) ? r : r?.data || []), date: (it) => it.calendarDate,
  },
  hrv: {
    label: 'HRV', max: 28,
    fetch: (g, f, t) => g.get(`/hrv-service/hrv/daily/${f}/${t}`),
    items: (r) => r?.hrvSummaries || [], date: (it) => it.calendarDate,
  },
  weight: {
    label: 'Weight', max: 90,
    fetch: (g, f, t) => g.get(`/weight-service/weight/range/${f}/${t}`, { includeAll: 'true' }),
    items: (r) => r?.dailyWeightSummaries || [], date: (it) => it.summaryDate,
  },
  activities: { label: 'Activities', max: 180 },
};
const TYPE_ORDER = Object.keys(SOURCES);

function defaultState() {
  return { from: null, types: {}, lastRecent: 0, lastSync: 0, lastExtras: '', lastError: null, lockUntil: 0, calls: 0 };
}

async function readState() {
  const { data } = await getJson(STATE_KEY, null);
  return Object.assign(defaultState(), data || {});
}

function yearsBetween(f, t) {
  const out = [];
  for (let y = +f.slice(0, 4); y <= +t.slice(0, 4); y++) out.push(y);
  return out;
}

// Write one fetched chunk of a day-keyed type into raw/<type>/<year>.json and days/<year>.json.
async function storeDayChunk(type, f, t, items) {
  const src = SOURCES[type];
  const byDate = new Map();
  for (const it of items) {
    const d = src.date(it);
    if (isDate(d) && d >= f && d <= t) byDate.set(d, it);
  }
  for (const y of yearsBetween(f, t)) {
    const yf = maxD(f, `${y}-01-01`), yt = minD(t, `${y}-12-31`);
    await updateJson(`raw/${type}/${y}.json`, {}, (doc) => {
      for (let d = yf; d <= yt; d = addDays(d, 1)) {
        if (byDate.has(d)) doc[d] = byDate.get(d); else delete doc[d];
      }
    });
    await updateJson(`days/${y}.json`, {}, (doc) => {
      for (let d = yf; d <= yt; d = addDays(d, 1)) {
        const row = doc[d] || {};
        for (const k of TYPE_KEYS[type]) delete row[k];
        if (byDate.has(d)) Object.assign(row, TYPES[type](byDate.get(d)));
        if (Object.keys(row).length) doc[d] = row; else delete doc[d];
      }
    });
  }
  return byDate.size;
}

async function fetchActivities(g, f, t) {
  const all = [];
  const limit = 100;
  for (let start = 0; start < 5000; start += limit) {
    const page = await g.get('/activitylist-service/activities/search/activities', {
      start, limit, startDate: f, endDate: t, sortOrder: 'asc',
    });
    const rows = Array.isArray(page) ? page : [];
    all.push(...rows);
    if (rows.length < limit) break;
  }
  return all;
}

async function storeActivityChunk(f, t, rows) {
  const byYear = new Map();
  for (const a of rows) {
    const d = String(a.startTimeLocal || a.startTimeGMT || '').slice(0, 10);
    if (!isDate(d)) continue;
    const y = +d.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(a);
  }
  for (const y of yearsBetween(f, t)) {
    const list = byYear.get(y) || [];
    const ids = new Set(list.map((a) => String(a.activityId)));
    const inRange = (start) => { const d = String(start || '').slice(0, 10); return d >= f && d <= t; };
    await updateJson(`raw/activities/${y}.json`, {}, (doc) => {
      for (const [id, a] of Object.entries(doc)) if (inRange(a.startTimeLocal) && !ids.has(id)) delete doc[id];
      for (const a of list) doc[a.activityId] = a;
    });
    await updateJson(`act/${y}.json`, {}, (doc) => {
      for (const [id, a] of Object.entries(doc)) if (inRange(a.start) && !ids.has(id)) delete doc[id];
      for (const a of list) doc[a.activityId] = slimActivity(a);
    });
  }
  return rows.length;
}

async function syncChunk(g, type, f, t) {
  if (type === 'activities') return storeActivityChunk(f, t, await fetchActivities(g, f, t));
  const src = SOURCES[type];
  return storeDayChunk(type, f, t, src.items(await src.fetch(g, f, t)));
}

// Profile, HR zones and fitness age: once a day is plenty.
async function syncExtras(g, today) {
  const safe = (p) => p.catch((e) => ({ error: e.message }));
  const [profile, zones, fitnessAge] = await Promise.all([
    safe(g.get('/userprofile-service/userprofile/settings')),
    safe(g.get('/biometric-service/heartRateZones/v2')),
    safe(g.get(`/fitnessage-service/fitnessage/v2/${today}`)),
  ]);
  await putJson('meta/profile.json', { profile, zones, fitnessAge, updated: Date.now() });
}

async function runSync({ today, from, budgetMs = 24000, force = false } = {}) {
  const t0 = Date.now();
  if (!isDate(today)) today = iso(Date.now());
  const g = getGarmin();
  const callsBefore = g.calls || 0;

  // Acquire a lease so two tabs/phones don't sync at once.
  let busy = false;
  let state = await updateJson(STATE_KEY, defaultState(), (s) => {
    s = Object.assign(defaultState(), s);
    if (s.lockUntil > Date.now()) { busy = true; return s; }
    s.lockUntil = Date.now() + budgetMs + 20000;
    if (isDate(from)) s.from = from;
    if (!s.from) s.from = addDays(today, -365);
    return s;
  });
  if (busy) return { busy: true, ...summarize(state, today) };

  const save = async (final = false) => {
    const extra = final ? (g.calls || 0) - callsBefore : 0;
    state = await updateJson(STATE_KEY, defaultState(), (s) => Object.assign(s, {
      types: state.types, lastRecent: state.lastRecent, lastExtras: state.lastExtras, lastError: state.lastError,
      lockUntil: state.lockUntil, lastSync: state.lastSync, from: state.from, calls: (s.calls || 0) + extra,
    }));
  };
  const timeLeft = () => budgetMs - (Date.now() - t0);
  const log = [];
  state.lastError = null;

  try {
    if (state.lastExtras !== today) {
      await syncExtras(g, today);
      state.lastExtras = today;
    }

    // 1) Forward: catch up to today (and refresh the last 3 days, which Garmin revises).
    const refreshRecent = force || Date.now() - (state.lastRecent || 0) > 5 * 60000;
    for (const type of TYPE_ORDER) {
      const max = SOURCES[type].max;
      const st = (state.types[type] ||= { oldest: null, newest: null });
      let start;
      if (!st.newest) start = maxD(state.from, addDays(today, -13));
      else if (st.newest < today || refreshRecent) start = maxD(state.from, addDays(minD(st.newest, today), -2));
      else continue;
      while (start <= today) {
        if (timeLeft() < 2500) break;
        const end = minD(today, addDays(start, max - 1));
        const n = await syncChunk(g, type, start, end);
        log.push(`${type} ${start}..${end}: ${n}`);
        st.newest = end;
        if (!st.oldest || start < st.oldest) st.oldest = start;
        start = addDays(end, 1);
        await save();
      }
    }
    if (timeLeft() > 2500) state.lastRecent = Date.now();

    // 2) Backward: fill history toward state.from, round-robin so every type moves together.
    let progressed = true;
    while (progressed && timeLeft() > 3000) {
      progressed = false;
      for (const type of TYPE_ORDER) {
        if (timeLeft() < 3000) break;
        const st = state.types[type];
        if (!st?.oldest || st.oldest <= state.from) continue;
        const end = addDays(st.oldest, -1);
        const start = maxD(state.from, addDays(end, -(SOURCES[type].max - 1)));
        const n = await syncChunk(g, type, start, end);
        log.push(`${type} ${start}..${end}: ${n}`);
        st.oldest = start;
        progressed = true;
        await save();
      }
    }
  } catch (e) {
    state.lastError = { at: Date.now(), message: e.message, status: e.status, body: e.body };
  } finally {
    state.lockUntil = 0;
    state.lastSync = Date.now();
    await save(true).catch(() => {});
  }
  return { ...summarize(state, today), log, ms: Date.now() - t0, calls: (g.calls || 0) - callsBefore };
}

function summarize(state, today) {
  today = isDate(today) ? today : iso(Date.now());
  const from = state.from;
  const span = from ? Math.max(1, (parse(today) - parse(from)) / DAY + 1) : 1;
  const types = {};
  let done = !!from;
  for (const type of TYPE_ORDER) {
    const st = state.types?.[type] || {};
    const covered = st.oldest && st.newest ? (parse(minD(st.newest, today)) - parse(maxD(st.oldest, from))) / DAY + 1 : 0;
    const pct = Math.max(0, Math.min(100, Math.round((covered / span) * 100)));
    const typeDone = !!(st.oldest && st.oldest <= from && st.newest >= today);
    if (!typeDone) done = false;
    types[type] = { label: SOURCES[type].label, oldest: st.oldest || null, newest: st.newest || null, pct, done: typeDone };
  }
  return {
    done: done && !state.lastError, from, types, lastSync: state.lastSync || null, lastError: state.lastError || null,
    syncing: state.lockUntil > Date.now(), calls: state.calls || 0,
  };
}

async function setBackfillFrom(from) {
  if (!isDate(from)) throw Object.assign(new Error('from must be YYYY-MM-DD'), { status: 400 });
  return updateJson(STATE_KEY, defaultState(), (s) => { s.from = from; });
}

module.exports = { runSync, readState, summarize, setBackfillFrom, SOURCES, iso, addDays, isDate };
