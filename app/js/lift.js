// Strength training data: templates, logged sessions, PRs, progression.
// Weights are stored in kg; the UI converts to lb when units are imperial.
import { api, ApiError, cacheGet, cacheSet } from './api.js';
import { EXERCISES, exercise as libExercise } from './exercises.js';
import { imperial, isNum } from './ui.js';

export const LIFT = { lift: { templates: [], customExercises: [] }, sessions: { sessions: [] }, etags: {} };

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export { uid };

export async function loadLift() {
  for (const name of ['lift', 'sessions']) {
    const cached = await cacheGet('m:' + name);
    try {
      const r = await api('m', { query: { name }, headers: cached?.etag ? { 'If-None-Match': cached.etag } : {} });
      if (r.notModified) { LIFT[name] = cached.data; LIFT.etags[name] = cached.etag; continue; }
      const data = r.json ?? r;
      LIFT[name] = { ...(name === 'lift' ? { templates: [], customExercises: [] } : { sessions: [] }), ...data };
      LIFT.etags[name] = r.etag || null;
      await cacheSet('m:' + name, { etag: r.etag, data: LIFT[name] });
    } catch (e) {
      if (cached) { LIFT[name] = cached.data; LIFT.etags[name] = cached.etag; } else if (!(e instanceof ApiError)) throw e;
    }
  }
  return LIFT;
}

export async function saveDoc(name) {
  const r = await api('m', { method: 'PUT', query: { name }, body: LIFT[name], headers: LIFT.etags[name] ? { 'If-Match': LIFT.etags[name] } : {} });
  LIFT.etags[name] = r.json?.etag || r.etag || null;
  await cacheSet('m:' + name, { etag: LIFT.etags[name], data: LIFT[name] });
}

export const allExercises = () => [...EXERCISES, ...(LIFT.lift.customExercises || [])];
export const exercise = (id) => libExercise(id, LIFT.lift.customExercises || []);

// ---------- weight display helpers (stored kg, shown in lb or kg, rounded to plate-friendly steps)
export const toDisp = (kg) => (!isNum(kg) ? '' : imperial() ? Math.round(kg * 2.20462 * 2) / 2 : Math.round(kg * 4) / 4);
export const fromDisp = (v) => (!isNum(v) ? undefined : imperial() ? v / 2.20462 : v);
export const wLabel = () => (imperial() ? 'lb' : 'kg');

// Epley estimated 1-rep max
export const e1rm = (kg, reps) => (kg > 0 && reps > 0 ? (reps === 1 ? kg : kg * (1 + reps / 30)) : 0);

// Every completed working set of an exercise, oldest first: {date, kg, reps, e1rm, sessionId}
export function exerciseHistory(exId) {
  const out = [];
  for (const s of [...LIFT.sessions.sessions].sort((a, b) => a.start - b.start)) {
    for (const ex of s.exercises || []) {
      if (ex.ex !== exId) continue;
      for (const st of ex.sets || []) {
        if (!st.done || st.type === 'w') continue;
        out.push({ date: new Date(s.start).toISOString().slice(0, 10), start: s.start, kg: st.kg || 0, reps: st.reps || 0, sec: st.sec || 0, e1rm: e1rm(st.kg, st.reps), sessionId: s.id });
      }
    }
  }
  return out;
}

// Most recent session's sets for an exercise (for the "Previous" column).
export function lastSets(exId, beforeTs = Infinity) {
  const sessions = LIFT.sessions.sessions.filter((s) => s.start < beforeTs).sort((a, b) => b.start - a.start);
  for (const s of sessions) {
    const ex = (s.exercises || []).find((e) => e.ex === exId && e.sets?.some((x) => x.done));
    if (ex) return ex.sets.filter((x) => x.done);
  }
  return null;
}

export function bests(exId, beforeTs = Infinity) {
  let w = 0, e = 0, vol = 0, reps = 0;
  for (const h of exerciseHistory(exId)) {
    if (h.start >= beforeTs) continue;
    w = Math.max(w, h.kg); e = Math.max(e, h.e1rm); vol = Math.max(vol, h.kg * h.reps); reps = Math.max(reps, h.reps);
  }
  return { weight: w, e1rm: e, setVolume: vol, reps };
}

// Double progression: hit the target reps on every working set last time -> add weight.
const BIG = new Set(['squat', 'deadlift', 'rdl', 'trap-dl', 'leg-press', 'front-squat', 'hip-thrust']);
export function suggestion(exId, targetSets) {
  const prev = lastSets(exId);
  if (!prev?.length) return null;
  const working = prev.filter((s) => s.type !== 'w');
  const ex = exercise(exId);
  if (ex.kind !== 'w' || !working.length) return { sets: working, note: null };
  const hitAll = working.every((s, i) => (s.reps || 0) >= (targetSets?.[i]?.reps || targetSets?.[0]?.reps || s.reps));
  if (!hitAll) return { sets: working, note: 'Same weight, beat last time\'s reps' };
  const inc = imperial() ? (BIG.has(exId) ? 10 : 5) / 2.20462 : BIG.has(exId) ? 5 : 2.5;
  return { sets: working.map((s) => ({ ...s, kg: (s.kg || 0) + inc })), note: `Hit all reps last time: +${imperial() ? (BIG.has(exId) ? 10 : 5) + ' lb' : (BIG.has(exId) ? 5 : 2.5) + ' kg'}` };
}

export function sessionVolume(s) {
  let v = 0;
  for (const ex of s.exercises || []) for (const st of ex.sets || []) if (st.done && st.type !== 'w') v += (st.kg || 0) * (st.reps || 0);
  return v;
}
export const sessionSets = (s) => (s.exercises || []).reduce((n, ex) => n + (ex.sets || []).filter((x) => x.done && x.type !== 'w').length, 0);

// Hard sets per muscle group per week (primary muscle = 1 set, secondary = 0.5)
export function setsPerMuscle(fromTs, toTs) {
  const m = {};
  for (const s of LIFT.sessions.sessions) {
    if (s.start < fromTs || s.start > toTs) continue;
    for (const ex of s.exercises || []) {
      const def = exercise(ex.ex);
      const n = (ex.sets || []).filter((x) => x.done && x.type !== 'w').length;
      (def.muscles || []).forEach((mu, i) => { m[mu] = (m[mu] || 0) + n * (i === 0 ? 1 : 0.5); });
    }
  }
  return m;
}

// ---------- in-progress workout survives reloads / app switching (localStorage)
const ACTIVE = 'fit.activeWorkout';
export function getActive() { try { return JSON.parse(localStorage.getItem(ACTIVE) || 'null'); } catch { return null; } }
export function setActive(s) { try { s ? localStorage.setItem(ACTIVE, JSON.stringify(s)) : localStorage.removeItem(ACTIVE); } catch { /* ignore */ } }

export function newSessionFrom(tpl) {
  const s = { id: uid(), templateId: tpl?.id || null, name: tpl?.name || 'Workout', start: Date.now(), exercises: [] };
  for (const te of tpl?.exercises || []) s.exercises.push(sessionExercise(te.ex, te));
  return s;
}

export function sessionExercise(exId, te) {
  const target = te?.sets?.length ? te.sets : [{ reps: 8 }, { reps: 8 }, { reps: 8 }];
  const sug = suggestion(exId, target);
  const sets = target.map((t, i) => {
    const p = sug?.sets?.[i] || sug?.sets?.[sug.sets.length - 1];
    return { type: t.warmup ? 'w' : 'n', kg: t.warmup ? t.kg : (p?.kg ?? t.kg), reps: t.reps ?? p?.reps, sec: t.sec, targetReps: t.reps, done: false };
  });
  return { ex: exId, rest: te?.rest ?? 120, notes: te?.notes || '', sets, hint: sug?.note || null };
}

export async function finishSession(s) {
  s.end = Date.now();
  s.exercises = s.exercises.map((ex) => ({ ...ex, hint: undefined, sets: ex.sets.filter((x) => x.done) })).filter((ex) => ex.sets.length);
  if (!s.exercises.length) return false;
  LIFT.sessions.sessions.push(s);
  await saveDoc('sessions');
  return true;
}

// Map Garmin strength-activity FIT sets (exercise categories) onto the library.
export function sessionFromGarminSets(activity, sets) {
  const s = { id: uid(), name: activity.name || 'Strength', start: Date.parse(activity.startGMT?.replace(' ', 'T') + 'Z') || Date.now(), garminId: activity.id, exercises: [] };
  s.end = s.start + (activity.dur || 0) * 1000;
  let cur = null;
  for (const st of sets) {
    const cat = String(st.cat || 'unknown');
    const def = EXERCISES.find((e) => e.cat.toLowerCase() === cat.toLowerCase().replace(/_(\w)/g, (_, c) => c.toUpperCase()));
    const exId = def?.id || 'garmin-' + cat;
    if (!def && !(LIFT.lift.customExercises || []).some((e) => e.id === exId)) {
      (LIFT.lift.customExercises ||= []).push({ id: exId, name: cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), muscles: [], kind: 'w', cat: 'unknown' });
    }
    if (!cur || cur.ex !== exId) { cur = { ex: exId, rest: 120, sets: [] }; s.exercises.push(cur); }
    cur.sets.push({ type: 'n', kg: st.kg || 0, reps: st.reps || 0, done: true });
  }
  return s;
}
