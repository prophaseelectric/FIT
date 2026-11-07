// Garmin Connect Personal API client.
// Docs: https://developer.garmin.com/gc-developer-program/personal/personal-api/
// The API key (from connect.garmin.com/app/settings/personalApiToken) is exchanged for a
// 24h JWT bearer token. No refresh tokens: we just exchange again. Pull-only, read-only.
// The API sends no CORS headers, so the browser can never call it directly: this runs server-side.
'use strict';

const crypto = require('node:crypto');
const { getJson, putJson } = require('./store');

const BASE = (process.env.GARMIN_BASE_URL || 'https://personal.connectapi.garmin.com').replace(/\/$/, '');
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const TOKEN_KEY = 'state/token.json';
const REFRESH_WINDOW_MS = 60 * 60 * 1000; // renew when <1h left, same as Garmin's own client

class GarminError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jwtExp(token) {
  try {
    const p = token.split('.')[1];
    const json = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return Number(json.exp) * 1000;
  } catch {
    return Date.now() + 23 * 3600 * 1000;
  }
}

class GarminClient {
  constructor(apiKey) {
    if (!apiKey) throw new GarminError(500, 'GARMIN_API_KEY is not set on the server.');
    this.apiKey = apiKey.trim();
    this.fingerprint = crypto.createHash('sha256').update(BASE + '\0' + this.apiKey).digest('hex');
    this.token = null;
    this.calls = 0;
  }

  async getToken(force = false) {
    const now = Date.now();
    if (!force && this.token && this.token.expiresAt - now > REFRESH_WINDOW_MS) return this.token.accessToken;
    if (!force) {
      const { data } = await getJson(TOKEN_KEY);
      if (data && data.fingerprint === this.fingerprint && data.expiresAt - now > REFRESH_WINDOW_MS) {
        this.token = data;
        return data.accessToken;
      }
    }
    const res = await fetch(BASE + TOKEN_PATH, {
      method: 'POST',
      headers: { Accept: '*/*', Authorization: 'ApiKey ' + this.apiKey },
      signal: AbortSignal.timeout(20000),
    });
    const text = (await res.text()).trim();
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403
        ? 'Garmin rejected the API key. It may be expired or deleted: create a new one at connect.garmin.com/app/settings/personalApiToken and update GARMIN_API_KEY.'
        : 'Garmin token exchange failed (' + res.status + ').';
      throw new GarminError(res.status, hint, text.slice(0, 500));
    }
    this.token = { accessToken: text, expiresAt: jwtExp(text), fingerprint: this.fingerprint };
    await putJson(TOKEN_KEY, this.token).catch(() => {});
    return text;
  }

  // GET a Personal API path. Returns parsed JSON (or Buffer when raw=true), null on 204/empty.
  async get(pathname, params, { raw = false, accept } = {}) {
    const url = new URL(BASE + pathname);
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
      else url.searchParams.set(k, String(v));
    }
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.getToken();
      this.calls++;
      let res;
      try {
        res = await fetch(url, {
          headers: { Accept: accept || 'application/json', Authorization: 'Bearer ' + token },
          signal: AbortSignal.timeout(25000),
        });
      } catch (e) {
        if (attempt < 3) { await sleep(500 * 2 ** attempt); continue; }
        throw new GarminError(504, 'Network error talking to Garmin: ' + e.message);
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.getToken(true);
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (res.status === 204 || res.status === 404) return null;
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new GarminError(res.status, 'Garmin ' + res.status + ' on ' + pathname, body.slice(0, 500));
      }
      if (raw) return Buffer.from(await res.arrayBuffer());
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
  }
}

let client;
function getGarmin() {
  if (process.env.GARMIN_MOCK === '1' || process.env.GARMIN_MOCK === 'true') {
    return require('./mock').getMock();
  }
  if (!client) client = new GarminClient(process.env.GARMIN_API_KEY);
  return client;
}

module.exports = { getGarmin, GarminClient, GarminError };
