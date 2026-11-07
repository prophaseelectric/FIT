// Chart.js wrappers. Colors come from CSS custom properties so light/dark both work.
// Rules followed: one y-axis per chart, thin marks, legend for >=2 series, hover tooltip on everything.
/* global Chart */
import { shortDate, fmtDate } from './ui.js';

const live = new Set();
export function destroyAll() { for (const c of live) c.destroy(); live.clear(); }

export function tok(name) { return getComputedStyle(document.documentElement).getPropertyValue('--' + name).trim(); }
export const series = (i) => tok('series-' + i);
export const seq = (step) => tok('seq-' + step);

function base({ yFmt, xFmt, legend, stacked, yMin, yMax, yReverse, xTitle, tooltipTitle, tooltipLabel } = {}) {
  const ink2 = tok('text-secondary'), muted = tok('text-muted'), grid = tok('grid'), axis = tok('axis');
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    layout: { padding: { top: 4, right: 4 } },
    plugins: {
      legend: legend ? { display: true, position: 'top', align: 'start', labels: { color: ink2, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', padding: 12, font: { size: 12 } } } : { display: false },
      tooltip: {
        backgroundColor: tok('surface-raised'), titleColor: tok('text-primary'), bodyColor: ink2, borderColor: axis, borderWidth: 1,
        padding: 10, cornerRadius: 8, usePointStyle: true, boxWidth: 8, boxHeight: 8,
        callbacks: {
          title: tooltipTitle || ((items) => items[0]?.label || ''),
          label: tooltipLabel || ((c) => { const v = c.parsed.y; return v === null || v === undefined ? null : ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${yFmt ? yFmt(v) : v}`; }),
        },
      },
    },
    scales: {
      x: {
        stacked: !!stacked, grid: { display: false }, border: { color: axis },
        title: xTitle ? { display: true, text: xTitle, color: muted, font: { size: 11 } } : undefined,
        ticks: { color: muted, maxRotation: 0, autoSkip: true, autoSkipPadding: 14, font: { size: 11 }, ...(xFmt ? { callback: xFmt } : {}) },
      },
      y: {
        stacked: !!stacked, reverse: !!yReverse, min: yMin, max: yMax, grid: { color: grid }, border: { display: false },
        ticks: { color: muted, font: { size: 11 }, maxTicksLimit: 5, ...(yFmt ? { callback: (v) => yFmt(v) } : {}) },
      },
    },
  };
}

function mount(canvas, cfg) {
  const c = new Chart(canvas, cfg);
  live.add(c);
  return c;
}

// Wrap a canvas in a sized box + a hidden data table (accessibility: a table view always exists).
export function chartBox(height = 200, label = 'Chart') {
  const box = document.createElement('div');
  box.className = 'chart';
  box.style.height = height + 'px';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  box.append(canvas);
  return { box, canvas };
}

const dateTick = (labels) => function (v) { const l = labels[v]; return l ? shortDate(l) : ''; };
const dateTitle = (labels) => (items) => fmtDate(labels[items[0].dataIndex], { weekday: true, year: true });

// Daily time series on a category axis of dates. datasets: {label, data, color, kind:'line'|'bar'|'dots', dash, width, fillTo, hidden}
export function timeChart(canvas, labels, datasets, opts = {}) {
  const o = base({ ...opts, xFmt: dateTick(labels), tooltipTitle: dateTitle(labels), legend: opts.legend ?? datasets.filter((d) => d.label && !d.noLegend).length > 1 });
  if (opts.noTooltipFor) o.plugins.tooltip.filter = (it) => !opts.noTooltipFor.includes(it.dataset.label);
  if (o.plugins.legend.labels) o.plugins.legend.labels.filter = (l) => !datasets[l.datasetIndex]?.noLegend;
  return mount(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d) => {
        if (d.kind === 'bar') {
          return { type: 'bar', label: d.label, data: d.data, backgroundColor: d.color, borderRadius: 3, borderSkipped: 'start', barPercentage: 0.9, categoryPercentage: 0.9, maxBarThickness: 18, stack: d.stack, order: 2 };
        }
        const dots = d.kind === 'dots';
        return {
          type: 'line', label: d.label, data: d.data, borderColor: d.color, backgroundColor: d.fillColor || d.color,
          borderWidth: dots ? 0 : d.width || 2, borderDash: d.dash ? [5, 4] : undefined,
          pointRadius: dots ? 3.5 : 0, pointHoverRadius: dots ? 5 : 4, pointBackgroundColor: d.color,
          pointBorderColor: tok('surface'), pointBorderWidth: dots ? 1.5 : 0,
          showLine: !dots, spanGaps: d.spanGaps ?? true, tension: 0.25, fill: d.fillTo ?? false, order: d.order ?? 1, hidden: d.hidden,
        };
      }),
    },
    options: o,
  });
}

// Generic category bar chart (weeks, weekdays, zones...).
export function barChart(canvas, labels, datasets, opts = {}) {
  const o = base({ ...opts, legend: opts.legend ?? datasets.length > 1 });
  if (opts.xLabels) { o.scales.x.ticks.callback = function (v) { return opts.xLabels(labels[v], v); }; }
  if (opts.titleFmt) o.plugins.tooltip.callbacks.title = (items) => opts.titleFmt(labels[items[0].dataIndex]);
  if (opts.horizontal) {
    o.indexAxis = 'y';
    [o.scales.x, o.scales.y] = [o.scales.y, o.scales.x];
    if (opts.yFmt) o.scales.x.ticks.callback = (v) => opts.yFmt(v); else delete o.scales.x.ticks.callback;
    delete o.scales.y.ticks.callback;
    o.plugins.tooltip.callbacks.label = (c) => ` ${c.dataset.label ? c.dataset.label + ': ' : ''}${opts.yFmt ? opts.yFmt(c.parsed.x) : c.parsed.x}`;
  }
  return mount(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((d) => ({
        label: d.label, data: d.data, backgroundColor: d.color, borderRadius: 3, borderSkipped: 'start',
        borderColor: tok('surface'), borderWidth: opts.stacked ? { top: 2 } : 0, maxBarThickness: 28, barPercentage: 0.88, categoryPercentage: 0.88,
      })),
    },
    options: o,
  });
}

// Floating bars (e.g. sleep windows): data = [[start, end] | null]
export function rangeBars(canvas, labels, data, opts = {}) {
  const o = base({ ...opts, xFmt: dateTick(labels), tooltipTitle: dateTitle(labels) });
  o.plugins.tooltip.callbacks.label = (c) => { const r = c.raw; return r ? ` ${opts.yFmt(r[0])} → ${opts.yFmt(r[1])}` : null; };
  const flat = data.filter(Boolean).flat();
  if (flat.length) {
    o.scales.y.min = Math.floor((Math.min(...flat) - 30) / 60) * 60;
    o.scales.y.max = Math.ceil((Math.max(...flat) + 30) / 60) * 60;
    o.scales.y.ticks.stepSize = 120;
    o.scales.y.ticks.maxTicksLimit = 8;
  }
  return mount(canvas, {
    type: 'bar',
    data: { labels, datasets: [{ label: opts.label || '', data, backgroundColor: opts.color, borderRadius: 3, borderSkipped: false, maxBarThickness: 14, barPercentage: 0.8 }] },
    options: o,
  });
}

// x/y numeric line chart (activity streams).
export function xyChart(canvas, datasets, opts = {}) {
  const o = base({ ...opts, legend: opts.legend ?? false });
  o.scales.x.type = 'linear';
  if (opts.xFmt) o.scales.x.ticks.callback = (v) => opts.xFmt(v);
  o.scales.x.ticks.maxTicksLimit = 6;
  o.plugins.tooltip.callbacks.title = (items) => (opts.xFmt ? opts.xFmt(items[0].parsed.x) : items[0].parsed.x);
  return mount(canvas, {
    type: 'line',
    data: { datasets: datasets.map((d) => ({ label: d.label, data: d.data, borderColor: d.color, backgroundColor: d.fillColor || 'transparent', fill: d.fill ? 'start' : false, borderWidth: d.width || 1.5, pointRadius: 0, pointHoverRadius: 3, spanGaps: true, tension: 0.15 })) },
    options: o,
  });
}

export function scatterChart(canvas, points, opts = {}) {
  const o = base({ ...opts, legend: false });
  o.interaction = { mode: 'nearest', intersect: true };
  o.scales.x.type = 'linear';
  o.scales.x.grid = { color: tok('grid') };
  if (opts.xFmt) o.scales.x.ticks.callback = (v) => opts.xFmt(v);
  o.scales.x.title = { display: true, text: opts.xTitle, color: tok('text-muted'), font: { size: 11 } };
  o.scales.y.title = { display: true, text: opts.yTitle, color: tok('text-muted'), font: { size: 11 } };
  o.plugins.tooltip.callbacks.title = (items) => (items[0].raw.d ? fmtDate(items[0].raw.d, { weekday: true, year: true }) : '');
  o.plugins.tooltip.callbacks.label = (c) => ` ${opts.xTitle}: ${opts.xFmt ? opts.xFmt(c.raw.x) : c.raw.x} · ${opts.yTitle}: ${opts.yFmt ? opts.yFmt(c.raw.y) : c.raw.y}`;
  const ds = [{ type: 'scatter', data: points, backgroundColor: opts.color, borderColor: tok('surface'), borderWidth: 1, pointRadius: 4, pointHoverRadius: 6 }];
  if (opts.fit) ds.push({ type: 'line', data: opts.fit, borderColor: tok('text-secondary'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, label: 'fit' });
  return mount(canvas, { type: 'scatter', data: { datasets: ds }, options: o });
}

// Simple SVG year heatmap (GitHub style), sequential single hue.
export function heatmap(container, dates, valueOf, { fmt = (v) => v, steps = ['seq-100', 'seq-250', 'seq-400', 'seq-550', 'seq-700'] } = {}) {
  const vals = dates.map(valueOf).filter((v) => typeof v === 'number');
  if (!vals.length) { container.textContent = 'No data yet.'; return; }
  const sorted = [...vals].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const cuts = [q(0.2), q(0.4), q(0.6), q(0.8)];
  const cell = 11, gap = 2;
  const first = dates[0];
  const offset = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7;
  const cols = Math.ceil((dates.length + offset) / 7);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${cols * (cell + gap)} ${7 * (cell + gap)}`);
  svg.setAttribute('class', 'heatmap');
  svg.setAttribute('role', 'img');
  dates.forEach((d, i) => {
    const v = valueOf(d);
    const k = i + offset;
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', Math.floor(k / 7) * (cell + gap));
    r.setAttribute('y', (k % 7) * (cell + gap));
    r.setAttribute('width', cell); r.setAttribute('height', cell); r.setAttribute('rx', 2);
    const level = typeof v !== 'number' ? -1 : cuts.filter((c) => v > c).length;
    r.setAttribute('fill', level < 0 ? tok('grid') : tok(steps[level]));
    const t = document.createElementNS(NS, 'title');
    t.textContent = `${fmtDate(d, { weekday: true, year: true })}: ${typeof v === 'number' ? fmt(v) : 'no data'}`;
    r.append(t);
    svg.append(r);
  });
  container.replaceChildren(svg);
}
