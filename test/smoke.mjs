// End-to-end smoke test in demo mode: boots the dev server with mock Garmin data in a temp
// folder, signs in, backfills, opens every screen, logs a workout, and fails on any JS error.
//   node test/smoke.mjs [screenshotDir]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const dataDir = mkdtempSync(path.join(process.env.TMPDIR || tmpdir(), 'fit-test-'));
const PORT = 8790 + Math.floor(Math.random() * 100);
const server = spawn(process.execPath, ['dev-server.js'], { cwd: root, env: { ...process.env, PORT: String(PORT), GARMIN_MOCK: '1', APP_SECRET: 'test', DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res) => server.stdout.on('data', (d) => String(d).includes('FIT on') && res()));

const base = `http://localhost:${PORT}`;
const errors = [];
const browser = await chromium.launch();
let failed = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: process.env.THEME || 'dark' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/tile\.openstreetmap|ERR_|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());

  // Backfill 2 years before opening the UI so charts have data.
  for (let i = 0; i < 20; i++) {
    const r = await (await fetch(`${base}/api/sync`, { method: 'POST', headers: { 'x-app-key': 'test', 'content-type': 'application/json' }, body: JSON.stringify({ from: new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10) }) })).json();
    if (r.done) break;
  }

  await page.goto(base);
  await page.fill('input[type=password]', 'test');
  await page.click('button[type=submit]');
  await page.waitForSelector('.verdict', { timeout: 15000 });
  const snap = async (name) => { await page.waitForTimeout(500); if (shots) await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true }); };
  await snap('today');

  const firstAct = await page.evaluate(async () => (await import('/js/data.js')).DB.acts.find((a) => a.type === 'running')?.id);
  const routes = ['sleep', 'train', `activity/${firstAct}`, 'body', 'trends?m=hrv', 'day/' + new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10), 'more', 'settings', 'data', 'lift'];
  for (const r of routes) {
    await page.goto(`${base}/#/${r}`);
    await page.waitForTimeout(r.startsWith('activity') ? 2500 : 900);
    const broken = await page.$('.view .error');
    if (broken) errors.push(`screen ${r}: ${await broken.textContent()}`);
    await snap(r.replace(/[/?=]/g, '_'));
  }

  // Trends compare + correlation
  await page.goto(`${base}/#/trends`);
  await page.waitForSelector('.controls select');
  await page.selectOption('.controls select >> nth=1', 'sleepScore');
  await page.waitForTimeout(600);
  await snap('trends_compare');

  // Lift: add starter template, start, log two sets, finish
  await page.goto(`${base}/#/lift`);
  await page.click('text=+ Push');
  await page.waitForSelector('.tpl');
  await page.click('.tpl >> text=Start');
  await page.waitForSelector('.ex-card');
  const inputs = page.locator('.ex-card').first().locator('tbody tr').first().locator('input');
  await inputs.nth(0).fill('185');
  await inputs.nth(1).fill('5');
  await page.locator('.ex-card').first().locator('.check').first().click();
  await page.locator('.ex-card').first().locator('.check').nth(1).click();
  await snap('lift_session');
  await page.click('text=Finish');
  await page.waitForURL(/#\/lift\/log\//, { timeout: 8000 });
  await snap('lift_log');
  const logged = await page.locator('.table tbody tr').count();
  if (logged < 2) errors.push('lift: expected 2 logged sets, got ' + logged);

  // Workout FIT export endpoint
  const fitRes = await fetch(`${base}/api/workout/fit`, { method: 'POST', headers: { 'x-app-key': 'test', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test', sport: 'strength', exercises: [{ name: 'Bench', cat: 'benchPress', fit: 'barbellBenchPress', rest: 90, sets: [{ reps: 5, kg: 80 }] }] }) });
  const fitBuf = new Uint8Array(await fitRes.arrayBuffer());
  if (!fitRes.ok || String.fromCharCode(...fitBuf.slice(8, 12)) !== '.FIT') errors.push('workout fit export failed');

  // Auth is enforced
  const unauth = await fetch(`${base}/api/status`);
  if (unauth.status !== 401) errors.push('api without key returned ' + unauth.status);

  // Template editor + cardio builder render
  await page.goto(`${base}/#/lift/edit/new-cardio`);
  await page.waitForTimeout(500);
  await snap('lift_cardio_editor');

  // Light theme pass of the busiest screens
  await page.emulateMedia({ colorScheme: 'light' });
  for (const r of ['today', 'sleep']) { await page.goto(`${base}/#/${r}`); await page.waitForTimeout(900); await snap(r + '_light'); }

  // No horizontal scroll at phone width
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) errors.push('horizontal overflow ' + overflow + 'px');
} catch (e) {
  errors.push('test crashed: ' + e.stack);
} finally {
  await browser.close();
  server.kill();
  rmSync(dataDir, { recursive: true, force: true });
}
if (errors.length) { failed = true; console.error('FAIL\n' + errors.join('\n')); }
else console.log('PASS: all screens rendered without errors');
process.exit(failed ? 1 : 0);
