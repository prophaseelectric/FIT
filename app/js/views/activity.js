/* global L */
import { h, card, kpi, fmtDur, fmtDist, fmtDate, fmtPace, fmtSpeed, fmtElev, fmtInt, isPaceType, typeLabel, toDist, dUnit, toElev, eUnit, toSpeed, paceSec, imperial, empty, toast, isNum, mean } from '../ui.js';
import { DB } from '../data.js';
import { api, getKey, cacheGet, cacheSet } from '../api.js';
import { xyChart, barChart, scatterChart, chartBox, tok } from '../charts.js';
import { icon } from './train.js';

export async function render(root, id) {
  const a = DB.actById.get(String(id));
  const back = h('a', { class: 'back', href: '#/train' }, '← Training');
  if (!a) { root.append(back, card(null, empty('Activity not found. It may not be synced yet.'))); return; }
  const pace = isPaceType(a.type);

  const subEl = h('div', { class: 'sub' }, `${fmtDate(a.start.slice(0, 10), { weekday: true, year: true })} · ${a.start.slice(11, 16)}${a.loc ? ' · ' + a.loc : ''}`);
  root.append(back, h('header', { class: 'page-head' }, h('div', null, h('h1', null, icon(a.type), ' ', a.name || typeLabel(a.type)), subEl)));

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

  const zonesCard = (zones, bounds) => {
    const c = chartBox(130, 'Time in heart rate zones');
    const labels = bounds?.length >= 6 ? [1, 2, 3, 4, 5].map((z) => `Z${z} ${bounds[z - 1] + 1}–${bounds[z]}`) : ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'];
    requestAnimationFrame(() => barChart(c.canvas, labels, [{ label: 'Time', data: zones.map((v) => v / 60), color: ['seq-200', 'seq-300', 'seq-400', 'seq-550', 'seq-700'].map(tok) }], { horizontal: true, yFmt: (v) => `${Math.round(v)} min`, legend: false }));
    return card('Heart rate zones', c.box);
  };
  if (a.hrz) root.append(zonesCard(a.hrz));

  const detailBox = h('div', null, h('p', { class: 'muted' }, 'Loading second-by-second data from the FIT file…'));
  root.append(detailBox);

  root.append(h('div', { class: 'actions' },
    h('button', { class: 'btn', onclick: () => download(`/api/activity/bundle?id=${a.id}&year=${a.start.slice(0, 4)}`, `activity-${a.id}-for-claude.zip`) }, 'Export for Claude (.zip)'),
    h('button', { class: 'btn ghost', onclick: () => download(`/api/activity/file?id=${a.id}`, `activity-${a.id}.zip`) }, 'Original FIT'),
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
  const fs = fit.session || {};
  if (fs.device) subEl.append(` · ${String(fs.device).replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase())}`);
  if (!a.hrz && fs.hrZoneSec?.some((v) => v > 0)) detailBox.append(zonesCard(fs.hrZoneSec, fs.hrZoneBounds));

  if (fit.track?.length > 1 && window.L) {
    const mapEl = h('div', { class: 'map', role: 'img', 'aria-label': 'Route map' });
    detailBox.append(card('Route', mapEl));
    requestAnimationFrame(() => {
      const map = L.map(mapEl, { attributionControl: true, zoomControl: false, scrollWheelZoom: false });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
      // Shade the route by speed (5 quantile bands, slow → fast) when the track carries speed.
      const SPEED_RAMP = ['#2a78d6', '#6f86d8', '#9d8fcd', '#cf7a9a', '#e34948'];
      const speeds = fit.track.map((p) => p[2]).filter(isNum).sort((x, y) => x - y);
      const cuts = speeds.length > 10 ? [0.2, 0.4, 0.6, 0.8].map((q) => speeds[Math.floor(q * speeds.length)]) : null;
      const bandOf = (v) => (cuts && isNum(v) ? cuts.filter((c) => v > c).length : 0);
      const bounds = L.latLngBounds(fit.track.map((p) => [p[0], p[1]]));
      map.fitBounds(bounds, { padding: [16, 16] });
      if (cuts) {
        let run = [fit.track[0]], band = bandOf(fit.track[0][2]);
        for (let i = 1; i < fit.track.length; i++) {
          const b = bandOf(fit.track[i][2]);
          run.push(fit.track[i]);
          if (b !== band || i === fit.track.length - 1) { L.polyline(run.map((p) => [p[0], p[1]]), { color: SPEED_RAMP[band], weight: 4, opacity: 0.95 }).addTo(map); run = [fit.track[i]]; band = b; }
        }
        const legend = L.control({ position: 'bottomleft' });
        legend.onAdd = () => { const d = L.DomUtil.create('div', 'map-legend'); d.innerHTML = `slow <span style="background:linear-gradient(90deg,${SPEED_RAMP.join(',')})"></span> fast`; return d; };
        legend.addTo(map);
      } else L.polyline(fit.track.map((p) => [p[0], p[1]]), { color: tok('series-2'), weight: 4, opacity: 0.95 }).addTo(map);
      L.control.scale({ imperial: imperial(), metric: !imperial(), position: 'bottomright' }).addTo(map);
      L.circleMarker([fit.track[0][0], fit.track[0][1]], { radius: 6, color: tok('surface'), weight: 2, fillColor: tok('status-good'), fillOpacity: 1 }).addTo(map).bindTooltip('Start');
      L.circleMarker([fit.track[fit.track.length - 1][0], fit.track[fit.track.length - 1][1]], { radius: 6, color: tok('surface'), weight: 2, fillColor: tok('status-critical'), fillOpacity: 1 }).addTo(map).bindTooltip('Finish');
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

  // ---- Analysis: how the effort was distributed (the stuff a dashboard would show)
  if (s.spd && t.length > 10) {
    const secPer = (a.dur || t[t.length - 1] || t.length) / t.length;
    const sp = s.spd.map((v) => (isNum(v) ? toSpeed(v) : null));
    const spdUnit = imperial() ? 'mph' : 'km/h';
    const MOVING = imperial() ? 1 : 1.6; // 1 mph
    const moving = sp.filter((v) => v !== null && v > MOVING).length * secPer;
    const total = sp.filter((v) => v !== null).length * secPer;
    const pct = total ? Math.round((moving / total) * 100) : 0;
    detailBox.append(card('Moving time',
      h('div', { class: 'split-bar', role: 'img', 'aria-label': `Moving ${pct}%` }, h('span', { style: { width: pct + '%' } })),
      h('p', { class: 'muted small' }, `Moving ${fmtDur(moving)} (${pct}%) · stopped or under ${MOVING} ${spdUnit} ${fmtDur(Math.max(0, total - moving))}`)));

    if (s.hr) {
      const pts = [];
      const stride = Math.max(1, Math.floor(t.length / 500));
      for (let i = 0; i < t.length; i += stride) if (sp[i] !== null && isNum(s.hr[i])) pts.push({ x: sp[i], y: s.hr[i] });
      if (pts.length > 10) {
        const c = chartBox(220, 'Speed vs heart rate');
        detailBox.append(card('Speed vs heart rate', h('p', { class: 'muted small' }, 'Each dot is a moment in the activity. A tight upward band means heart rate tracks effort; a flat cloud means HR was driven by something else (heat, terrain, nerves).'), c.box));
        requestAnimationFrame(() => scatterChart(c.canvas, pts, { xTitle: `Speed (${spdUnit})`, yTitle: 'Heart rate (bpm)', xFmt: (v) => (+v).toFixed(1), yFmt: (v) => Math.round(v), color: tok('series-8') }));
      }
    }

    const mx = Math.max(...sp.filter((v) => v !== null));
    if (mx > 0) {
      const raw = mx / 8, mag = 10 ** Math.floor(Math.log10(raw)), width = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((w) => w >= raw) || mag * 10;
      const bins = [];
      for (let lo = 0; lo < mx; lo += width) bins.push({ label: `${+lo.toFixed(2)}–${+(lo + width).toFixed(2)}`, min: sp.filter((v) => v !== null && v >= lo && v < lo + width).length * secPer / 60 });
      const c = chartBox(170, 'Time per speed band');
      detailBox.append(card(`Time per speed band (${spdUnit})`, c.box));
      requestAnimationFrame(() => barChart(c.canvas, bins.map((b) => b.label), [{ label: 'Minutes', data: bins.map((b) => b.min), color: tok('series-1') }], { legend: false, yFmt: (v) => `${(+v).toFixed(1)} min` }));
    }

    // Timed splits when the watch recorded no laps worth showing
    const dur = a.dur || t[t.length - 1];
    if (!(fit.laps?.length > 1) && dur >= 60) {
      const block = dur < 600 ? 30 : dur < 3600 ? 300 : 600;
      const rows = [];
      const distAt = (sec) => { let best = null; for (let i = 0; i < t.length; i++) { if (t[i] <= sec && s.dist?.[i] !== null && s.dist?.[i] !== undefined) best = s.dist[i]; else if (t[i] > sec) break; } return best; };
      for (let start = 0; start < dur; start += block) {
        const end = Math.min(dur, start + block);
        const idx = t.map((v, i) => (v >= start && v < end ? i : -1)).filter((i) => i >= 0);
        if (!idx.length) continue;
        const spd = idx.map((i) => sp[i]).filter((v) => v !== null), hr = idx.map((i) => s.hr?.[i]).filter(isNum);
        const d0 = distAt(start) ?? 0, d1 = distAt(end) ?? d0;
        rows.push(h('tr', null, h('td', null, `${fmtDur(start)}–${fmtDur(end)}`), a.dist ? h('td', null, fmtDist(d1 - d0, 2)) : null,
          h('td', null, spd.length ? `${mean(spd).toFixed(1)}` : '–'), h('td', null, spd.length ? `${Math.max(...spd).toFixed(1)}` : '–'),
          h('td', null, hr.length ? Math.round(mean(hr)) : '–'), h('td', null, hr.length ? Math.max(...hr) : '–'),
          h('td', null, fmtDur(spd.filter((v) => v > MOVING).length * secPer))));
      }
      if (rows.length > 1) {
        detailBox.append(card(`${block < 60 ? block + '-second' : block / 60 + '-minute'} splits`, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
          h('thead', null, h('tr', null, h('th', null, 'Block'), a.dist ? h('th', null, 'Dist') : null, h('th', null, `Avg ${spdUnit}`), h('th', null, 'Max'), h('th', null, 'Avg HR'), h('th', null, 'Max HR'), h('th', null, 'Moving'))),
          h('tbody', null, rows)))));
      }
    }
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

async function download(url, fallbackName) {
  try {
    const res = await fetch(url, { headers: { 'x-app-key': getKey() } });
    if (!res.ok) { let m = 'HTTP ' + res.status; try { m = (await res.json()).error || m; } catch { /* */ } throw new Error(m); }
    const cd = res.headers.get('Content-Disposition') || '';
    const name = /filename="([^"]+)"/.exec(cd)?.[1] || fallbackName;
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const link = h('a', { href, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 5000);
  } catch (e) { toast('Download failed: ' + e.message); }
}
