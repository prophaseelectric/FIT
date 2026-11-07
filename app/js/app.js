// FIT: boot, sign-in, hash router, tab bar, background sync.
import { h, $, toast, ago } from './ui.js';
import { api, getKey, setKey, ApiError } from './api.js';
import { DB, loadAll, runSync, syncState, onChange } from './data.js';
import { destroyAll } from './charts.js';
import * as Today from './views/today.js';
import * as Sleep from './views/sleep.js';
import * as Train from './views/train.js';
import * as Activity from './views/activity.js';
import * as Body from './views/body.js';
import * as Trends from './views/trends.js';
import * as Day from './views/day.js';
import * as Lift from './views/lift.js';
import * as Session from './views/session.js';
import * as Template from './views/template.js';
import { renderMore, renderSettings, renderData } from './views/settings.js';

const TABS = [
  ['today', 'Today', '<path d="M12 21s-7-4.35-7-10a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 5.65-7 10-7 10z"/>'],
  ['sleep', 'Sleep', '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>'],
  ['train', 'Train', '<path d="M13 4a2 2 0 1 0 0 .01M7 21l3-6 3 2v4M10 15l1-5 4 2 3-1M8 9l3-1"/>'],
  ['lift', 'Lift', '<path d="M3 10v4M6 8v8M18 8v8M21 10v4M6 12h12"/>'],
  ['more', 'More', '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'],
];

const ROUTES = {
  today: (r) => Today.render(r),
  sleep: (r) => Sleep.render(r),
  train: (r) => Train.render(r),
  activity: (r, a) => Activity.render(r, a[0]),
  lift: (r, a) => (a[0] === 'session' ? Session.render(r) : a[0] === 'edit' ? Template.render(r, a[1]) : a[0] === 'log' ? Lift.renderLog(r, a[1]) : Lift.render(r)),
  body: (r) => Body.render(r),
  trends: (r, a, q) => Trends.render(r, q),
  day: (r, a) => Day.render(r, a[0]),
  more: (r) => renderMore(r),
  settings: (r) => renderSettings(r),
  data: (r) => renderData(r),
};
const TAB_OF = { activity: 'train', body: 'more', trends: 'more', day: 'today', settings: 'more', data: 'more' };

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '') || 'today';
  const [path, qs] = raw.split('?');
  const [name, ...args] = path.split('/');
  return { name: ROUTES[name] ? name : 'today', args, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

let lastRoute = '';
async function route({ keepScroll = false } = {}) {
  const { name, args, query } = parseHash();
  const main = $('#main');
  const sameRoute = lastRoute === location.hash;
  lastRoute = location.hash;
  const y = window.scrollY;
  destroyAll();
  const root = h('div', { class: 'view' });
  main.replaceChildren(root);
  const tab = TAB_OF[name] || name;
  document.querySelectorAll('.tabbar a').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'));
  try {
    await ROUTES[name](root, args, query);
  } catch (e) {
    console.error(e);
    root.append(h('section', { class: 'card' }, h('p', { class: 'error' }, 'Something broke on this screen: ' + e.message)));
  }
  if (keepScroll && sameRoute) window.scrollTo(0, y); else if (!sameRoute) window.scrollTo(0, 0);
}

function shell() {
  document.body.replaceChildren(
    h('div', { class: 'topbar' }, h('span', { class: 'brand' }, 'FIT'), h('button', { id: 'syncpill', class: 'syncpill', onclick: () => runSync() }, '')),
    h('main', { id: 'main' }),
    h('nav', { class: 'tabbar', 'aria-label': 'Sections' }, TABS.map(([id, label, path]) => h('a', { href: '#/' + id, 'data-tab': id },
      h('span', { class: 'tab-icon', 'aria-hidden': 'true', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>` }),
      h('span', null, label)))));
  updatePill();
}

function updatePill() {
  const p = $('#syncpill');
  if (!p) return;
  const s = syncState.last || DB.status?.sync || {};
  const types = Object.values(s.types || {});
  const pct = types.length ? Math.round(types.reduce((a, t) => a + t.pct, 0) / types.length) : 0;
  p.classList.toggle('busy', syncState.running);
  p.classList.toggle('err', !!(syncState.error || s.lastError));
  p.textContent = syncState.running ? (s.done === false && pct < 100 ? `Syncing ${pct}%` : 'Syncing…') : syncState.error || s.lastError ? 'Sync error' : DB.status?.mock ? 'Demo data' : `Synced ${ago(s.lastSync)}`;
  p.title = syncState.error || s.lastError?.message || 'Tap to sync now';
}

function signIn(message) {
  const input = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'App key', required: true, 'aria-label': 'App key' });
  const err = h('p', { class: 'error' }, message || '');
  document.body.replaceChildren(h('main', { class: 'signin' },
    h('div', { class: 'brand big' }, 'FIT'),
    h('p', { class: 'muted' }, 'Your Garmin data, your server. Enter the APP_SECRET you set on the server.'),
    h('form', { onsubmit: async (e) => {
      e.preventDefault();
      setKey(input.value.trim());
      try { await api('status'); boot(); } catch (x) { err.textContent = x instanceof ApiError && x.status === 401 ? 'Wrong key.' : x.message; }
    } }, input, h('button', { class: 'btn', type: 'submit' }, 'Unlock')), err));
  input.focus();
}

let booted = false;
async function boot() {
  if (!getKey()) return signIn();
  shell();
  const hadCache = await loadAll({ cachedOnly: true });
  if (hadCache) await route();
  else $('#main').replaceChildren(h('p', { class: 'muted center' }, 'Loading your data…'));
  try {
    await loadAll();
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) { setKey(''); return signIn('That key no longer works.'); }
    if (!hadCache) { $('#main').replaceChildren(h('section', { class: 'card' }, h('p', { class: 'error' }, 'Could not reach the server: ' + e.message))); return; }
    toast('Offline: showing saved data');
  }
  if (!booted) {
    booted = true;
    window.addEventListener('hashchange', () => route());
    onChange((what) => {
      updatePill();
      // Re-render data views when fresh data lands, but never yank someone mid-workout or mid-edit.
      if (what === 'data' && !/#\/(lift|settings|data|body)/.test(location.hash)) route({ keepScroll: true });
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => route({ keepScroll: true }));
  }
  await route();
  updatePill();
  const last = DB.status?.sync?.lastSync || 0;
  if (DB.status?.garminConfigured && (Date.now() - last > 10 * 60000 || DB.status?.sync?.done === false)) runSync();
  if (!DB.status?.garminConfigured) toast('Garmin is not configured on the server yet (GARMIN_API_KEY).', 6000);
  setInterval(updatePill, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - (DB.status?.sync?.lastSync || 0) > 15 * 60000) runSync();
  });
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();
