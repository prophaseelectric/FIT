// Offline app shell. Data lives in IndexedDB (see js/api.js); /api is never cached here.
const VERSION = 'fit-v1';
const SHELL = ['/', '/index.html', '/app.css', '/manifest.webmanifest', '/vendor/chart.umd.js', '/vendor/leaflet.js', '/vendor/leaflet.css', '/vendor/fflate.js',
  '/js/app.js', '/js/ui.js', '/js/api.js', '/js/data.js', '/js/charts.js', '/js/lift.js', '/js/exercises.js',
  '/js/views/today.js', '/js/views/sleep.js', '/js/views/train.js', '/js/views/activity.js', '/js/views/body.js', '/js/views/trends.js',
  '/js/views/day.js', '/js/views/lift.js', '/js/views/session.js', '/js/views/template.js', '/js/views/settings.js', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Network first (so deploys show up immediately), cache fallback when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.auth/')) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});
