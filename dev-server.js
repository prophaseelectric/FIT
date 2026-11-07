#!/usr/bin/env node
// Local dev server: serves app/ and routes /api/* to the same handlers Azure runs.
// No Azure tools needed. Data goes to ./.data unless STORAGE_CONNECTION is set.
//   GARMIN_MOCK=1 node dev-server.js                        (fake data, app key "dev")
//   GARMIN_API_KEY=... APP_SECRET=... node dev-server.js    (your real Garmin data)
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

process.env.APP_SECRET ||= 'dev';
const { handle } = require('./api/src/lib/handlers');

const ROOT = path.join(__dirname, 'app');
const PORT = +process.env.PORT || 8787;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    for await (const c of req) raw += c;
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
    const out = await handle({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: req.headers, body });
    res.writeHead(out.status, { ...(out.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(out.headers || {}) });
    return res.end(out.buffer || (out.json !== undefined ? JSON.stringify(out.json) : undefined));
  }
  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(ROOT, 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`FIT on http://localhost:${PORT}  (app key: ${process.env.APP_SECRET === 'dev' ? 'dev' : 'from APP_SECRET'}${process.env.GARMIN_MOCK === '1' ? ', MOCK data' : ''})`));
