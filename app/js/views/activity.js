/* global L */
import { h, card, kpi, fmtDur, fmtDist, fmtDate, fmtPace, fmtSpeed, fmtElev, fmtInt, isPaceType, typeLabel, toDist, dUnit, toElev, eUnit, toSpeed, paceSec, imperial, empty, toast, isNum } from '../ui.js';
import { DB } from '../data.js';
import { api, getKey, cacheGet, cacheSet } from '../api.js';
import { xyChart, barChart, chartBox, tok } from '../charts.js';
import { icon } from './train.js';

export async function render(root, id) {
  const a = DB.actById.get(String(id));
  const back = h('a', { class: 'back', href: '#/train' }, '← Training');
  if (!a) { root.append(back, card(null, empty('Activity not found. It may not be synced yet.'))); return; }
  const pace = isPaceType(a.type);

  root.append(back, h('header', { class: 'page-head' },
    h('div', null, h('h1', null, icon(a.type), ' ', a.name || typeLabel(a.type)),
      h('div', { class: 'sub' }, `${fmtDate(a.start.slice(0, 10), { weekday: true, year: true })} · ${a.start.slice(11, 16)}${a.loc ? ' · ' + a.loc : ''}`))));

  const stats = [
    kpi('Time', fmtDur(a.dur), a.moving && a.moving < a.dur - 30 ? `moving ${fmtDur(a.moving)}` : ''),
    a.dist ? kpi('Distance', fmtDist(a.dist)) : null,
    a.avgSpeed ? kpi(pace ? 'Pace' : 'Speed', pace ? fmtPace(a.avgSpeed) : fmtSpeed(a.avgSpeed), a.gap && pace ? `GAP ${fmtPace(a.gap)}` : '') : null,
    a.avgHR ? kpi('Heart rate', `${a.avgHR} bpm`, `max ${a.maxHR ?? '–'}`) : null,
    a.elev ? kpi('Elevation gain', fmtElev(a.elev)) : null,
    a.load ? kpi('Training load', fmtInt(a.load), a.teLabel ? a.teLabel.replace(/_/g, ' ').toLowerCase() : '') : null,
    isNum(a.teAer) ? kpi('Training effect', `${a.teAer} / ${a.teAna ?? 0}`, 'aerobic / anaerobic') : null,
    a.power ? kpi('Power', `${a.power} W`, a.np ? `NP ${a.np} W` : '') : null,
    a.cadence ? kpi('Cadence', `${Math.round(a.cadence)}`, pace ? 'spm' : 'rpm') : null,
    a.cal ? kpi('Calories', fmtInt(a.cal)) : null,
    a.vo2 ? kpi('VO₂ max', a.vo2) : null,
    a.sets ? kpi('Sets / reps', `${a.sets} / ${a.reps ?? '–'}`) : null,
    isNum(a.bb) ? kpi('Body Battery', `${a.bb > 0 ? '+' : ''}${a.bb}`) : null,
  ].filter(Boolean);
  root.append(h('div', { class: 'kpis' }, stats));

  if (a.hrz) {
    const c = chartBox(130, 'Time in heart rate zones');
    root.append(card('Heart rate zones', c.box));
    requestAnimationFrame(() => barChart(c.canvas, ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'], [{ label: 'Time', data: a.hrz.map((s) => s / 60), color: ['seq-200', 'seq-300', 'seq-400', 'seq-550', 'seq-700'].map(tok) }], { horizontal: true, yFmt: (v) => `${Math.round(v)} min`, legend: false }));
  }

  const detailBox = h('div', null, h('p', { class: 'muted' }, 'Loading second-by-second data from the FIT file…'));
  root.append(detailBox);

  root.append(h('div', { class: 'actions' },
    h('button', { class: 'btn ghost', onclick: () => downloadFit(a.id) }, 'Download original FIT'),
    h('a', { class: 'btn ghost', href: `https://connect.garmin.com/modern/activity/${a.id}`, target: '_blank', rel: 'noopener' }, 'Open in Garmin Connect')));

  let full = await cacheGet('activity:' + a.id);
  if (!full) {
    try {
      full = await api('activity', { query: { id: a.id } });
      if (full?.fit && !full.fit.error) await cacheSet('activity:' + a.id, full);
    } catch (e) {
      detailBox.replaceChildren(h('p', { class: 'muted' }, 'Could not load detail: ' + e.message));
      return;
    }
  }
  if (!root.isConnected) return;
  const fit = full?.fit;
  if (!fit || fit.error) { detailBox.replaceChildren(h('p', { class: 'muted' }, fit?.error ? 'No FIT detail: ' + fit.error : 'No detail available for this activity.')); return; }
  detailBox.replaceChildren();

  if (fit.track?.length > 1 && window.L) {
    const mapEl = h('div', { class: 'map', role: 'img', 'aria-label': 'Route map' });
    detailBox.append(card('Route', mapEl));
    requestAnimationFrame(() => {
      const map = L.map(mapEl, { attributionControl: true, zoomControl: false, scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      const line = L.polyline(fit.track, { color: tok('series-2'), weight: 4, opacity: 0.95 }).addTo(map);
      L.circleMarker(fit.track[0], { radius: 6, color: tok('surface'), weight: 2, fillColor: tok('status-good'), fillOpacity: 1 }).addTo(map).bindTooltip('Start');
      L.circleMarker(fit.track[fit.track.length - 1], { radius: 6, color: tok('surface'), weight: 2, fillColor: tok('status-critical'), fillOpacity: 1 }).addTo(map).bindTooltip('Finish');
      map.fitBounds(line.getBounds(), { padding: [16, 16] });
    });
  }

  const s = fit.streams || {};
  const t = s.t || [];
  const useDist = s.dist && s.dist.some((v) => v > 0) && a.dist > 500;
  const xs = useDist ? s.dist.map((m) => (m === null ? null : toDist(m))) : t.map((v) => v / 60);
  const xFmt = useDist ? (v) => `${(+v).toFixed(1)} ${dUnit()}` : (v) => fmtDur(v * 60, { short: true });
  const pts = (arr, f = (v) => v) => xs.map((x, i) => (x === null || arr[i] === null || arr[i] === undefined ? null : { x, y: f(arr[i]) })).filter(Boolean);

  const charts = [];
  if (s.hr) charts.push(['Heart rate', pts(s.hr), tok('series-8'), (v) => `${Math.round(v)} bpm`]);
  if (s.spd && a.dist) {
    if (pace) {
      // pace chart: clamp silly values (stops), lower is faster so reverse the axis
      const p = pts(s.spd, (v) => paceSec(v) / 60).filter((d) => d.y && d.y < (imperial() ? 30 : 20));
      charts.push(['Pace', p, tok('series-1'), (v) => `${fmtDur(v * 60)} /${dUnit()}`, { yReverse: true }]);
    } else charts.push(['Speed', pts(s.spd, toSpeed), tok('series-1'), (v) => `${(+v).toFixed(1)} ${imperial() ? 'mph' : 'km/h'}`]);
  }
  if (s.alt) charts.push(['Elevation', pts(s.alt, toElev), tok('text-muted'), (v) => `${Math.round(v)} ${eUnit()}`, { fill: true }]);
  if (s.cad) charts.push(['Cadence', pts(s.cad, (v) => (pace ? v * 2 : v)), tok('series-3'), (v) => `${Math.round(v)} ${pace ? 'spm' : 'rpm'}`]);
  if (s.pwr) charts.push(['Power', pts(s.pwr), tok('series-4'), (v) => `${Math.round(v)} W`]);
  if (s.temp) charts.push(['Temperature', pts(s.temp, (v) => (imperial() ? v * 9 / 5 + 32 : v)), tok('series-5'), (v) => `${Math.round(v)}°`]);

  for (const [label, data, color, yFmt, extra = {}] of charts) {
    if (data.length < 2) continue;
    const c = chartBox(150, label);
    detailBox.append(card(label, c.box));
    requestAnimationFrame(() => xyChart(c.canvas, [{ label, data, color, fill: extra.fill, fillColor: extra.fill ? color + '33' : undefined }], { xFmt, yFmt, yReverse: extra.yReverse }));
  }

  if (fit.laps?.length > 1) {
    detailBox.append(card(`Laps (${fit.laps.length})`, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Time'), a.dist ? h('th', null, 'Dist') : null, a.dist ? h('th', null, pace ? 'Pace' : 'Speed') : null, h('th', null, 'Avg HR'), h('th', null, 'Max HR'))),
      h('tbody', null, fit.laps.map((l) => h('tr', null, h('td', null, l.n), h('td', null, fmtDur(l.dur)), a.dist ? h('td', null, fmtDist(l.dist)) : null,
        a.dist ? h('td', null, pace ? fmtPace(l.spd) : fmtSpeed(l.spd)) : null, h('td', null, l.avgHR ?? '–'), h('td', null, l.maxHR ?? '–'))))))));
  }
  if (fit.sets?.length) {
    detailBox.append(card(`Sets (${fit.sets.length})`, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Exercise'), h('th', null, 'Reps'), h('th', null, 'Weight'), h('th', null, 'Time'))),
      h('tbody', null, fit.sets.map((st, i) => h('tr', null, h('td', null, i + 1), h('td', null, st.cat ? typeLabel(String(st.cat).toLowerCase()) : '–'), h('td', null, st.reps ?? '–'),
        h('td', null, st.kg ? (imperial() ? `${Math.round(st.kg * 2.20462)} lb` : `${st.kg} kg`) : '–'), h('td', null, fmtDur(st.dur))))))));
  }
}

async function downloadFit(id) {
  try {
    const res = await fetch(`/api/activity/file?id=${id}`, { headers: { 'x-app-key': getKey() } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = h('a', { href: url, download: `activity-${id}.zip` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { toast('Download failed: ' + e.message); }
}
