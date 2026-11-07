// Talks to /api with the app key, and caches documents in IndexedDB so FIT opens instantly
// and works offline. Documents are revalidated with ETags (304 = nothing to download).

const KEY_LS = 'fit.appKey';
export const getKey = () => { try { return localStorage.getItem(KEY_LS) || ''; } catch { return ''; } };
export const setKey = (k) => { try { k ? localStorage.setItem(KEY_LS, k) : localStorage.removeItem(KEY_LS); } catch { /* private mode */ } };

export class ApiError extends Error {
  constructor(status, message, body) { super(message); this.status = status; this.body = body; }
}

export async function api(path, { method = 'GET', body, query, blob = false, headers = {} } = {}) {
  const url = new URL('/api/' + path.replace(/^\//, ''), location.origin);
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { 'x-app-key': getKey(), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) {
    let j = {};
    try { j = await res.json(); } catch { /* not json */ }
    throw new ApiError(res.status, j.error || `HTTP ${res.status}`, j);
  }
  if (blob) return res.blob();
  const etag = res.headers.get('ETag');
  const json = await res.json();
  return etag ? { json, etag } : json;
}

// ---------- tiny IndexedDB key/value store
let dbp;
function idb() {
  if (!('indexedDB' in self)) return Promise.reject(new Error('no idb'));
  return (dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('fit', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
export async function cacheGet(k) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  } catch { return undefined; }
}
export async function cacheSet(k, v) {
  try {
    const db = await idb();
    await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch { /* cache is best effort */ }
}
export async function cacheClear() {
  try {
    const db = await idb();
    await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').clear(); tx.oncomplete = res; tx.onerror = res; });
  } catch { /* ignore */ }
}

// Fetch a JSON doc with ETag revalidation; falls back to the cached copy when offline.
export async function doc(cacheKey, path, query) {
  const cached = await cacheGet(cacheKey);
  try {
    const r = await api(path, { query, headers: cached?.etag ? { 'If-None-Match': cached.etag } : {} });
    if (r.notModified) return cached.data;
    const data = r.json !== undefined ? r.json : r;
    await cacheSet(cacheKey, { etag: r.etag || null, data });
    return data;
  } catch (e) {
    if (cached && !(e instanceof ApiError && e.status === 401)) return cached.data;
    throw e;
  }
}
