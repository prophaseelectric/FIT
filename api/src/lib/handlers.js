// Framework-agnostic API router. Used by the Azure Function (src/functions/api.js)
// and by the local dev server (dev-server.js).
// req: { method, path, query, headers, body } -> { status, headers?, json? | buffer? }
'use strict';

const crypto = require('node:crypto');
const { getStore, getJson, putJson, updateJson } = require('./store');
const { getGarmin, GarminError } = require('./garmin');
const { runSync, readState, summarize, setBackfillFrom, iso, addDays, isDate } = require('./sync');
const { parseActivityFile } = require('./fit');
const { buildWorkoutFit } = require('./workout');

const ok = (json, headers) => ({ status: 200, json, headers });
const err = (status, message, extra) => ({ status, json: { error: message, ...extra } });

function authorized(headers) {
  const secret = process.env.APP_SECRET;
  if (!secret) return false;
  const given = String(headers['x-app-key'] || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

// Serve a stored doc with ETag so the PWA can revalidate cheaply.
async function serveDoc(key, headers) {
  const r = await getStore().getRaw(key);
  if (!r) return ok({});
  if (headers['if-none-match'] && headers['if-none-match'] === r.etag) return { status: 304, headers: { ETag: r.etag } };
  return { status: 200, buffer: r.buf, headers: { 'Content-Type': 'application/json', ETag: r.etag } };
}

// Raw explorer only proxies GETs to documented Personal API services.
const RAW_PREFIXES = [
  '/activity-service/', '/activitylist-service/', '/biometric-service/', '/fitnessage-service/', '/goal-service/',
  '/hrv-service/', '/nutrition-service/', '/periodichealth-service/', '/sleep-service/', '/userprofile-service/',
  '/usersummary-service/', '/weight-service/', '/wellness-service/', '/wellnessactivity-service/',
];

const ACTIVITY_ID = /^\d{1,20}$/;

async function originalFile(id) {
  const key = `fitfile/${id}.zip`;
  const cached = await getStore().getRaw(key);
  if (cached) return cached.buf;
  const zip = await getGarmin().get(`/download-service/files/activity/${id}`, {}, {
    raw: true, accept: 'application/zip, application/x-zip-compressed, application/octet-stream',
  });
  if (zip && zip.length) await getStore().putRaw(key, zip, { contentType: 'application/zip' }).catch(() => {});
  return zip;
}

// Whole-document user data (lift templates, logged sessions). Optimistic concurrency via If-Match.
const MANUAL_DOCS = new Set(['lift', 'sessions']);
const MAX_DOC = 3 * 1024 * 1024;
const TAG = /^[\p{L}\p{N} _\-+&']{1,32}$/u;

const routes = {
  'GET /status': async () => {
    const state = await readState();
    const { data: meta } = await getJson('meta/profile.json', {});
    return ok({
      app: 'FIT',
      garminConfigured: !!process.env.GARMIN_API_KEY || process.env.GARMIN_MOCK === '1',
      mock: process.env.GARMIN_MOCK === '1',
      sync: summarize(state),
      profile: meta?.profile && !meta.profile.error ? meta.profile : null,
      zones: Array.isArray(meta?.zones) ? meta.zones : null,
      fitnessAge: meta?.fitnessAge && !meta.fitnessAge.error ? meta.fitnessAge : null,
    });
  },

  'POST /sync': async ({ body }) => {
    const res = await runSync({ today: body?.today, from: body?.from, force: !!body?.force });
    return ok(res);
  },

  'POST /settings': async ({ body }) => {
    await setBackfillFrom(body?.from);
    return ok(summarize(await readState(), body?.today));
  },

  'GET /years': async () => {
    const keys = await getStore().list('days/');
    const actKeys = await getStore().list('act/');
    const years = new Set([...keys, ...actKeys].map((k) => +k.match(/(\d{4})\.json$/)?.[1]).filter(Boolean));
    return ok({ years: [...years].sort() });
  },

  'GET /days': async ({ query, headers }) => {
    if (!/^\d{4}$/.test(query.year || '')) return err(400, 'year required');
    return serveDoc(`days/${query.year}.json`, headers);
  },

  'GET /activities': async ({ query, headers }) => {
    if (!/^\d{4}$/.test(query.year || '')) return err(400, 'year required');
    return serveDoc(`act/${query.year}.json`, headers);
  },

  // Full activity: Garmin detail + decoded FIT streams (cached forever once fetched).
  'GET /activity': async ({ query }) => {
    const id = query.id;
    if (!ACTIVITY_ID.test(id || '')) return err(400, 'bad id');
    const cacheKey = `activity/${id}.json`;
    const cached = await getJson(cacheKey);
    if (cached.data && !query.refresh) return ok(cached.data);
    const g = getGarmin();
    const detail = await g.get(`/activity-service/activity/${id}`).catch((e) => ({ error: e.message }));
    let fit = null;
    try {
      const zip = await originalFile(id);
      if (zip) fit = await parseActivityFile(zip);
    } catch (e) {
      fit = { error: e.message };
    }
    const out = { id, detail, fit, fetched: Date.now() };
    if (!detail?.error && !fit?.error) await putJson(cacheKey, out);
    return ok(out);
  },

  // Original device file (the richest data there is). Cached in storage after the first download.
  'GET /activity/file': async ({ query }) => {
    if (!ACTIVITY_ID.test(query.id || '')) return err(400, 'bad id');
    const zip = await originalFile(query.id);
    if (!zip) return err(404, 'No file for this activity');
    return { status: 200, buffer: zip, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="activity-${query.id}.zip"` } };
  },

  // Intraday detail for one day (HR curve, HRV readings, Body Battery, SpO2, full sleep record).
  'GET /day': async ({ query }) => {
    const d = query.date;
    if (!isDate(d)) return err(400, 'date required');
    const today = isDate(query.today) ? query.today : iso(Date.now());
    const key = `detail/${d}.json`;
    const final = d < addDays(today, -2);
    if (final && !query.refresh) {
      const c = await getJson(key);
      if (c.data) return ok(c.data);
    }
    const g = getGarmin();
    const safe = (p) => p.catch((e) => ({ error: e.message }));
    const sleep = await safe(g.get('/sleep-service/sleep/dailySleep', { date: d }));
    const hr = await safe(g.get('/wellness-service/wellness/dailyHeartRate', { date: d }));
    const hrv = await safe(g.get(`/hrv-service/hrv/${d}`));
    const bb = await safe(g.get('/wellness-service/wellness/bodyBattery/reports/daily', { startDate: d, endDate: d }));
    const spo2 = await safe(g.get(`/wellness-service/wellness/daily/spo2acclimation/${d}`));
    const food = await safe(g.get(`/nutrition-service/food/logs/${d}`, { includeMedia: 'false' }));
    const wellness = await safe(g.get(`/wellnessactivity-service/activity/summary/range/${d}/${d}`));
    const out = { date: d, sleep, hr, hrv, bb: Array.isArray(bb) ? bb[0] || null : bb, spo2, food, wellness, fetched: Date.now() };
    if (final) await putJson(key, out);
    return ok(out);
  },

  'GET /weights': async ({ headers }) => serveDoc('manual/weights.json', headers),
  'POST /weights': async ({ body }) => {
    const { date, kg, fat, note } = body || {};
    if (!isDate(date) || !(kg > 20 && kg < 400)) return err(400, 'date and kg (20-400) required');
    const entry = { id: crypto.randomUUID(), date, kg: Math.round(kg * 100) / 100, at: Date.now() };
    if (fat > 1 && fat < 70) entry.fat = Math.round(fat * 10) / 10;
    if (note) entry.note = String(note).slice(0, 140);
    const doc = await updateJson('manual/weights.json', { entries: [] }, (d) => { d.entries.push(entry); d.entries.sort((a, b) => (a.date < b.date ? -1 : 1)); });
    return ok(doc);
  },
  'DELETE /weights': async ({ query }) => {
    const doc = await updateJson('manual/weights.json', { entries: [] }, (d) => { d.entries = d.entries.filter((e) => e.id !== query.id); });
    return ok(doc);
  },

  // Settings that should follow you across devices (goals, targets, custom tags).
  'GET /prefs': async ({ headers }) => serveDoc('manual/prefs.json', headers),
  'PUT /prefs': async ({ body }) => {
    const allowed = ['goalKg', 'sleepTargetH', 'stepGoal', 'units', 'customTags', 'goalDate'];
    const doc = await updateJson('manual/prefs.json', {}, (d) => {
      for (const k of allowed) if (k in (body || {})) d[k] = body[k];
    });
    return ok(doc);
  },

  'GET /journal': async ({ headers }) => serveDoc('manual/journal.json', headers),
  'PUT /journal': async ({ body }) => {
    const { date, tags, note } = body || {};
    if (!isDate(date) || !Array.isArray(tags)) return err(400, 'date and tags[] required');
    const clean = [...new Set(tags.map(String).filter((t) => TAG.test(t)))].slice(0, 20);
    const doc = await updateJson('manual/journal.json', {}, (d) => {
      const n = typeof note === 'string' ? note.slice(0, 500) : d[date]?.note;
      if (clean.length || n) d[date] = { tags: clean, ...(n ? { note: n } : {}) };
      else delete d[date];
    });
    return ok(doc);
  },

  'GET /m': async ({ query, headers }) => {
    if (!MANUAL_DOCS.has(query.name)) return err(400, 'unknown doc');
    return serveDoc(`manual/${query.name}.json`, headers);
  },
  'PUT /m': async ({ query, headers, body }) => {
    if (!MANUAL_DOCS.has(query.name)) return err(400, 'unknown doc');
    if (!body || typeof body !== 'object') return err(400, 'body required');
    const buf = Buffer.from(JSON.stringify(body));
    if (buf.length > MAX_DOC) return err(413, 'Document too large');
    const opts = headers['if-match'] ? { ifMatch: headers['if-match'] } : {};
    try {
      const etag = await getStore().putRaw(`manual/${query.name}.json`, buf, opts);
      return ok({ ok: true, etag }, { ETag: etag });
    } catch (e) {
      if (e.code === 'PRECONDITION') return err(409, 'Changed on another device. Reload and try again.');
      throw e;
    }
  },

  // Turn a workout template into a Garmin FIT workout file for the watch.
  'POST /workout/fit': async ({ body }) => {
    const buf = await buildWorkoutFit(body || {});
    const name = String(body?.name || 'workout').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'workout';
    return { status: 200, buffer: buf, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}.fit"` } };
  },

  'GET /raw': async ({ query }) => {
    const p = String(query.path || '');
    if (!p.startsWith('/') || p.includes('..') || !RAW_PREFIXES.some((x) => p.startsWith(x)) || p.startsWith('/download-service/')) {
      return err(400, 'path must be a Personal API GET path, e.g. /sleep-service/sleep/dailySleep');
    }
    const params = { ...query };
    delete params.path;
    return ok(await getGarmin().get(p, params));
  },

  // Everything we've stored, as one ZIP. Your data, your backup.
  'GET /export': async () => {
    const { zipSync } = require('fflate');
    const store = getStore();
    const files = {};
    for (const k of await store.list('')) {
      if (k.startsWith('state/token')) continue;
      const r = await store.getRaw(k);
      if (r) files[k] = new Uint8Array(r.buf);
    }
    return { status: 200, buffer: Buffer.from(zipSync(files, { level: 6 })), headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="fit-export-${iso(Date.now())}.zip"` } };
  },
};

async function handle(req) {
  const path = '/' + String(req.path || '').replace(/^\/+|\/+$/g, '').replace(/^api\/?/, '');
  const headers = Object.fromEntries(Object.entries(req.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  if (!process.env.APP_SECRET) return err(500, 'APP_SECRET is not set on the server. Add it in the Static Web App environment variables.');
  if (!authorized(headers)) return err(401, 'Wrong or missing app key');
  const route = routes[`${req.method} ${path}`];
  if (!route) return err(404, 'Not found');
  try {
    const res = await route({ ...req, headers, query: req.query || {} });
    res.headers = { 'Cache-Control': 'no-store', ...(res.headers || {}) };
    return res;
  } catch (e) {
    if (e instanceof GarminError) return err(502, e.message, { garminStatus: e.status, detail: e.body });
    if (e.status === 400) return err(400, e.message);
    console.error(e);
    return err(500, e.message || 'Server error');
  }
}

module.exports = { handle };
