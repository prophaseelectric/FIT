// DOM + formatting helpers shared by every view.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === undefined || kid === null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

// ---------- dates (all calendar dates are 'YYYY-MM-DD' strings in the user's local calendar)
export const DAY = 86400000;
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const parseD = (s) => Date.parse(s + 'T00:00:00Z');
export const isoD = (t) => new Date(t).toISOString().slice(0, 10);
export const addDays = (s, n) => isoD(parseD(s) + n * DAY);
export const daysBetween = (a, b) => Math.round((parseD(b) - parseD(a)) / DAY);
export function* dateRange(from, to) { for (let t = parseD(from); t <= parseD(to); t += DAY) yield isoD(t); }
export const dow = (s) => new Date(parseD(s)).getUTCDay(); // 0 = Sunday
export function weekStart(s) { const d = dow(s); return addDays(s, -((d + 6) % 7)); } // Monday

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS = WD;
export function fmtDate(s, { year = false, weekday = false } = {}) {
  if (!s) return '';
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return `${weekday ? WD[dow(s.slice(0, 10))] + ' ' : ''}${MONTHS[m - 1]} ${d}${year ? ', ' + y : ''}`;
}
export const fmtMonth = (s) => `${MONTHS[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
export const shortDate = (s) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`;

// "wall-clock ms" (Garmin *Local timestamps) -> minutes after midnight
export function wallMinutes(ms) { const d = new Date(ms); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
export function fmtClock(mins) {
  mins = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h24 = Math.floor(mins / 60), m = mins % 60;
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')}${h24 < 12 ? 'a' : 'p'}`;
}

export function ago(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

// ---------- numbers & units
let units = 'imperial';
export const setUnits = (u) => { units = u === 'metric' ? 'metric' : 'imperial'; };
export const getUnits = () => units;
export const imperial = () => units === 'imperial';

export const fmtInt = (v) => (v === undefined || v === null || Number.isNaN(v) ? '–' : Math.round(v).toLocaleString());
export const fmtNum = (v, d = 1) => (v === undefined || v === null || Number.isNaN(v) ? '–' : (+v).toFixed(d));

export function fmtDur(sec, { short = false } = {}) {
  if (sec === undefined || sec === null || Number.isNaN(sec)) return '–';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (short) return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export const hours = (sec) => (sec === undefined ? undefined : sec / 3600);

export const KG_LB = 2.20462;
export const wUnit = () => (imperial() ? 'lb' : 'kg');
export const toW = (kg) => (kg === undefined || kg === null ? undefined : imperial() ? kg * KG_LB : kg);
export const fromW = (v) => (imperial() ? v / KG_LB : v);
export const fmtW = (kg, d = 1) => (kg === undefined || kg === null ? '–' : `${toW(kg).toFixed(d)} ${wUnit()}`);

export const dUnit = () => (imperial() ? 'mi' : 'km');
export const toDist = (m) => (m === undefined || m === null ? undefined : imperial() ? m / 1609.344 : m / 1000);
export const fmtDist = (m, d = 2) => (!m ? '–' : `${toDist(m).toFixed(d)} ${dUnit()}`);
export const eUnit = () => (imperial() ? 'ft' : 'm');
export const toElev = (m) => (m === undefined || m === null ? undefined : imperial() ? m * 3.28084 : m);
export const fmtElev = (m) => (m === undefined || m === null ? '–' : `${Math.round(toElev(m)).toLocaleString()} ${eUnit()}`);

export const paceSec = (mps) => (mps > 0.2 ? (imperial() ? 1609.344 : 1000) / mps : undefined);
export const fmtPace = (mps) => { const p = paceSec(mps); return p ? `${fmtDur(p)} /${dUnit()}` : '–'; };
export const toSpeed = (mps) => (mps === undefined || mps === null ? undefined : mps * (imperial() ? 2.23694 : 3.6));
export const fmtSpeed = (mps) => (!mps ? '–' : `${toSpeed(mps).toFixed(1)} ${imperial() ? 'mph' : 'km/h'}`);

export const PACE_TYPES = /running|walking|hiking|trail|treadmill|track/;
export const isPaceType = (t) => PACE_TYPES.test(t || '');

export function typeLabel(t) {
  return String(t || 'other').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------- stats
export const mean = (a) => { const v = a.filter(isNum); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : undefined; };
export const sum = (a) => a.filter(isNum).reduce((s, x) => s + x, 0);
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export function sd(a) {
  const v = a.filter(isNum);
  if (v.length < 2) return undefined;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}
// trailing rolling mean over n slots, needs at least minN real values
export function rolling(vals, n, minN = Math.ceil(n / 2)) {
  return vals.map((_, i) => {
    const w = vals.slice(Math.max(0, i - n + 1), i + 1).filter(isNum);
    return w.length >= minN ? w.reduce((s, x) => s + x, 0) / w.length : null;
  });
}
export function pearson(xs, ys) {
  const pts = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => isNum(x) && isNum(y));
  const n = pts.length;
  if (n < 5) return { r: undefined, n };
  const mx = mean(pts.map((p) => p[0])), my = mean(pts.map((p) => p[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return { r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : undefined, n, pts };
}

// ---------- small UI pieces
export function statusChip(level, text) {
  const icon = { good: '●', warn: '▲', bad: '■', none: '○' }[level] || '○';
  return h('span', { class: `chip status-${level}` }, h('span', { class: 'chip-icon', 'aria-hidden': 'true' }, icon), text);
}

export function segmented(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'tablist' });
  for (const [val, label] of options) {
    wrap.append(h('button', {
      class: val === value ? 'on' : '', role: 'tab', 'aria-selected': String(val === value),
      onclick: () => { [...wrap.children].forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-selected', 'false'); }); const b = [...wrap.children].find((x) => x.textContent === label); b.classList.add('on'); b.setAttribute('aria-selected', 'true'); onChange(val); },
    }, label));
  }
  return wrap;
}

export function kpi(label, value, sub, opts = {}) {
  return h(opts.href ? 'a' : 'div', { class: 'kpi' + (opts.cls ? ' ' + opts.cls : ''), href: opts.href },
    h('div', { class: 'kpi-label' }, label),
    h('div', { class: 'kpi-value' }, value),
    sub ? h('div', { class: 'kpi-sub' }, sub) : null);
}

export function card(title, ...kids) {
  return h('section', { class: 'card' }, title ? h('h2', null, title) : null, ...kids);
}

export function empty(msg) { return h('p', { class: 'empty' }, msg); }

export function toast(msg, ms = 2600) {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), ms);
}

export function delta(v, { unit = '', d = 1, goodWhen = 'down' } = {}) {
  if (!isNum(v)) return h('span', { class: 'delta' }, '–');
  if (Math.abs(v) < 0.5 * 10 ** -d) v = 0;
  const s = v > 0 ? '+' : v < 0 ? '−' : '±';
  const good = goodWhen === 'none' ? null : (goodWhen === 'down' ? v < 0 : v > 0);
  return h('span', { class: 'delta' + (Math.abs(v) < 10 ** -d / 2 || good === null ? '' : good ? ' good' : ' bad') }, `${s}${Math.abs(v).toFixed(d)}${unit}`);
}
