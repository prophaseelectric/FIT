// Benchmarks: what's due, every benchmark by category with last value + rating, detail with chart + history + log form.
import { h, card, empty, toast, fmtDate, statusChip, todayStr, isNum, daysBetween } from '../ui.js';
import { BENCH, CATALOG, CATS, byKey, rate, RATE_TEXT, fmtValue, fmtTime, entriesFor, lastEntry, due, dueList, autoRows, addEntry, deleteEntry, loadBench } from '../bench.js';
import { timeChart, chartBox, tok } from '../charts.js';

export function dueText(d) {
  if (d.status === 'never') return 'Never logged';
  if (d.status === 'overdue') return `${-d.days} day${d.days === -1 ? '' : 's'} overdue`;
  if (d.status === 'soon') return d.days === 0 ? 'Due today' : `Due in ${d.days} day${d.days === 1 ? '' : 's'}`;
  return `Next ${fmtDate(d.dueDate, { year: true })}`;
}

export async function render(root, key) {
  root.append(h('header', { class: 'page-head' }, h('div', null, h('div', { class: 'sub' }, 'Health'), h('h1', null, 'Benchmarks'))));
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  root.append(body);
  try { await loadBench(); } catch (e) { body.replaceChildren(card(null, empty('Could not load: ' + e.message))); return; }
  if (!root.isConnected) return;
  if (key) return detail(root, body, key);
  overview(body);
}

function overview(body) {
  body.replaceChildren();
  const dues = dueList();
  const never = CATALOG.filter((b) => !lastEntry(b.key));
  body.append(h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/bench/log' }, '+ Log a result')));

  if (dues.length) {
    body.append(card('Due', h('div', { class: 'list' }, dues.slice(0, 6).map(({ b, ...d }) => h('a', { class: 'row', href: `#/bench/${b.key}` },
      h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, b.name), h('span', { class: 'row-sub' }, dueText(d))),
      h('span', { class: 'row-end' }, statusChip(d.status === 'overdue' ? 'bad' : 'warn', d.status === 'overdue' ? 'Overdue' : 'Soon')))))));
  } else body.append(card('Due', h('p', { class: 'muted small' }, never.length ? `Nothing due in the next two weeks. ${never.length} of ${CATALOG.length} benchmarks never logged; start with blood pressure.` : 'Nothing due in the next two weeks.')));

  const autoBox = h('div', { class: 'list' }, h('p', { class: 'muted small' }, 'Loading…'));
  body.append(card('Tracked automatically', autoBox));
  autoRows().then((rows) => autoBox.replaceChildren(...(rows.length ? rows.map((r) => h(r.href ? 'a' : 'div', { class: 'row', href: r.href },
    h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, r.name), r.sub ? h('span', { class: 'row-sub' }, r.sub) : null),
    h('span', { class: 'row-end' }, r.value, r.level ? statusChip(r.level, '') : null))) : [h('p', { class: 'muted small' }, 'Sync Garmin and log a few lifts to fill this in.')])));

  for (const cat of CATS) {
    body.append(card(cat, h('div', { class: 'list' }, CATALOG.filter((b) => b.cat === cat).map((b) => {
      const last = lastEntry(b.key);
      const d = due(b);
      const level = last ? rate(b, last.value, last.value2) : null;
      return h('a', { class: 'row', href: `#/bench/${b.key}` },
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, b.name), h('span', { class: 'row-sub' }, last ? `${fmtDate(last.date, { year: true })} · ${dueText(d)}` : `Never logged · every ${cadence(b.every)}`)),
        h('span', { class: 'row-end' }, last ? fmtValue(b, last) : h('span', { class: 'muted' }, '–'), level ? statusChip(level, RATE_TEXT[level]) : null));
    }))));
  }
  body.append(h('p', { class: 'muted small' }, 'Reference ranges are general adult guidelines (male where sex-specific), not medical advice. Your doctor\'s targets win.'));
}

const cadence = (days) => (days >= 365 ? `${Math.round(days / 365)} yr${days >= 730 ? 's' : ''}` : days >= 60 ? `${Math.round(days / 30)} months` : `${days} days`);

function detail(root, body, key) {
  if (key === 'log') return logForm(body, null);
  const b = byKey(key);
  if (!b) { body.replaceChildren(card(null, empty('Unknown benchmark.'))); return; }
  root.querySelector('h1').textContent = b.name;
  root.querySelector('.page-head').prepend(h('a', { class: 'back', href: '#/bench' }, '← Benchmarks'));
  body.replaceChildren();
  const entries = entriesFor(key);
  const last = entries.slice(-1)[0];
  const d = due(b);
  const level = last ? rate(b, last.value, last.value2) : null;

  body.append(h('div', { class: 'kpis' },
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, 'Latest'), h('div', { class: 'kpi-value' }, last ? fmtValue(b, last) : '–'), h('div', { class: 'kpi-sub' }, last ? fmtDate(last.date, { year: true }) : 'never logged')),
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, 'Status'), h('div', { class: 'kpi-value' }, level ? statusChip(level, RATE_TEXT[level]) : h('span', { class: 'muted' }, b.better === 'trend' ? 'Trend only' : '–')), h('div', { class: 'kpi-sub' }, rangeText(b))),
    h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, 'Repeat'), h('div', { class: 'kpi-value' }, `every ${cadence(b.every)}`), h('div', { class: 'kpi-sub' }, dueText(d)))));
  if (b.how) body.append(h('p', { class: 'muted small' }, b.how));

  if (entries.length > 1 && b.kind !== 'date') {
    const c = chartBox(200, b.name + ' over time');
    body.append(card('Trend', c.box));
    const labels = entries.map((e) => e.date);
    const toDisp = (v) => (b.kind === 'num' ? +b.unit.to(v).toFixed(b.unit.d ?? 1) : v);
    const fmt = (v) => (b.kind === 'time' ? fmtTime(v) : `${(+v).toFixed(b.unit.d ?? 0)}${b.kind === 'num' && b.unit.label() ? ' ' + b.unit.label() : ''}`);
    const sets = [{ label: b.kind === 'bp' ? 'Systolic' : b.name, data: entries.map((e) => toDisp(e.value)), color: tok('series-1'), kind: 'dots' }, { label: 'line', data: entries.map((e) => toDisp(e.value)), color: tok('series-1'), noLegend: true, width: 1.5 }];
    if (b.kind === 'bp') sets.push({ label: 'Diastolic', data: entries.map((e) => e.value2), color: tok('series-2'), kind: 'dots' }, { label: 'line2', data: entries.map((e) => e.value2), color: tok('series-2'), noLegend: true, width: 1.5 });
    const goal = b.better === 'low' || b.better === 'high' ? b.good : b.better === 'range' ? b.good[0] : null;
    if (isNum(goal)) sets.push({ label: 'Target', data: labels.map(() => (b.kind === 'num' ? toDisp(goal) : goal)), color: tok('status-good'), dash: true, width: 1.5, noLegend: true });
    if (b.better === 'range') sets.push({ label: 'Target high', data: labels.map(() => toDisp(b.good[1])), color: tok('status-good'), dash: true, width: 1.5, noLegend: true });
    requestAnimationFrame(() => timeChart(c.canvas, labels, sets, { yFmt: fmt, legend: b.kind === 'bp', noTooltipFor: ['line', 'line2', 'Target', 'Target high'], yReverse: !!b.lower && false }));
  }

  body.append(card('Log ' + b.name.toLowerCase(), logFields(b, () => detail(root, body, key))));

  if (entries.length) {
    body.append(card('History', h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
      h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Value'), h('th', null, 'Note'), h('th'))),
      h('tbody', null, [...entries].reverse().map((e) => h('tr', null, h('td', null, fmtDate(e.date, { year: true })), h('td', null, fmtValue(b, e)), h('td', { class: 'muted' }, e.note || ''),
        h('td', null, h('button', { class: 'icon-btn', 'aria-label': 'Delete', onclick: async () => { if (!confirm('Delete this entry?')) return; await deleteEntry(e.id); detail(root, body, key); } }, '✕')))))))));
  }
}

function rangeText(b) {
  const u = b.kind === 'num' && b.unit.label() ? ' ' + b.unit.label() : '';
  const f = (v) => (b.kind === 'num' ? +b.unit.to(v).toFixed(b.unit.d ?? 1) : b.kind === 'time' ? fmtTime(v) : v);
  if (b.better === 'bp') return 'Good under 120/80';
  if (b.better === 'low') return `Good under ${f(b.good)}${u}, borderline to ${f(b.warn)}${u}`;
  if (b.better === 'high') return `Good over ${f(b.good)}${u}, borderline to ${f(b.warn)}${u}`;
  if (b.better === 'range') return `Good ${f(b.good[0])}–${f(b.good[1])}${u}`;
  if (b.kind === 'date') return 'Just log the date';
  return b.lower ? 'Lower is better' : 'Track the trend';
}

// Generic log form; `fixed` pins the benchmark (detail page), otherwise a picker is shown.
function logFields(fixed, onSaved) {
  const sel = h('select', { 'aria-label': 'Benchmark' }, CATS.map((cat) => h('optgroup', { label: cat }, CATALOG.filter((b) => b.cat === cat).map((b) => h('option', { value: b.key, selected: fixed?.key === b.key }, b.name)))));
  const date = h('input', { type: 'date', value: todayStr(), max: todayStr(), 'aria-label': 'Date' });
  const v1 = h('input', { type: 'number', inputmode: 'decimal', step: 'any', 'aria-label': 'Value' });
  const v2 = h('input', { type: 'number', inputmode: 'numeric', step: '1', placeholder: 'Diastolic', 'aria-label': 'Diastolic' });
  const mm = h('input', { type: 'number', inputmode: 'numeric', min: 0, placeholder: 'min', 'aria-label': 'Minutes' });
  const ss = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 59, placeholder: 'sec', 'aria-label': 'Seconds' });
  const note = h('input', { type: 'text', placeholder: 'Note (lab, device, conditions)', maxlength: 140 });
  const fields = h('div', { class: 'row-fields' });
  const draw = () => {
    const b = byKey(sel.value);
    fields.replaceChildren(date);
    if (b.kind === 'num') { v1.placeholder = b.unit.label() || b.name; fields.append(v1); }
    if (b.kind === 'bp') { v1.placeholder = 'Systolic'; fields.append(v1, v2); }
    if (b.kind === 'time') fields.append(mm, ss);
    fields.append(note);
  };
  sel.addEventListener('change', draw);
  draw();
  const form = h('form', { class: 'stack-form', onsubmit: async (e) => {
    e.preventDefault();
    const b = byKey(sel.value);
    const entry = { key: b.key, date: date.value, note: note.value.trim() || undefined };
    if (b.kind === 'num') { const v = parseFloat(v1.value); if (!isNum(v)) return toast('Enter a value'); entry.value = +b.unit.from(v).toFixed(4); }
    if (b.kind === 'bp') { const a = parseInt(v1.value, 10), c = parseInt(v2.value, 10); if (!(a > 50 && a < 260 && c > 30 && c < 160)) return toast('Enter systolic and diastolic'); entry.value = a; entry.value2 = c; }
    if (b.kind === 'time') { const s = (parseInt(mm.value, 10) || 0) * 60 + (parseInt(ss.value, 10) || 0); if (!(s > 0)) return toast('Enter a time'); entry.value = s; }
    if (b.kind === 'date') entry.value = null;
    try { await addEntry(entry); toast('Logged'); v1.value = v2.value = mm.value = ss.value = note.value = ''; onSaved(b.key); } catch (err) { toast('Save failed: ' + err.message); }
  } }, fixed ? null : h('label', { class: 'field' }, h('span', null, 'Benchmark'), sel), fields, h('button', { class: 'btn', type: 'submit' }, 'Save'));
  return form;
}

function logForm(body) {
  body.replaceChildren(h('a', { class: 'back', href: '#/bench' }, '← Benchmarks'), card('Log a result', logFields(null, (key) => { location.hash = '#/bench/' + key; })));
}

export { BENCH, daysBetween };
