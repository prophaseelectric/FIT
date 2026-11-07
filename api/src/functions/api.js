// One catch-all HTTP function: /api/* -> lib/handlers.js
'use strict';

const { app } = require('@azure/functions');
const { handle } = require('../lib/handlers');

app.http('api', {
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  authLevel: 'anonymous',
  route: '{*path}',
  handler: async (request) => {
    let body = null;
    if (request.method !== 'GET' && request.method !== 'DELETE') {
      try { body = await request.json(); } catch { body = null; }
    }
    const res = await handle({
      method: request.method,
      path: request.params.path || '',
      query: Object.fromEntries(request.query.entries()),
      headers: Object.fromEntries(request.headers.entries()),
      body,
    });
    if (res.buffer) return { status: res.status, headers: res.headers, body: res.buffer };
    if (res.json === undefined) return { status: res.status, headers: res.headers };
    return { status: res.status, headers: res.headers, jsonBody: res.json };
  },
});
