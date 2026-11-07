// Build a Garmin FIT *workout* file (file type 4) from a FIT workout template.
// The Personal API is read-only, so this is how workouts get onto the watch: copy the .fit
// into GARMIN/NewFiles over USB, or import it on connect.garmin.com (Training > Workouts).
'use strict';

let sdk;
const loadSdk = async () => (sdk ||= await import('@garmin/fitsdk'));

const SPORTS = {
  strength: ['training', 'strengthTraining'],
  running: ['running', 'generic'],
  cycling: ['cycling', 'generic'],
  walking: ['walking', 'generic'],
  cardio: ['training', 'cardioTraining'],
  hiit: ['training', 'cardioTraining'],
};
const INTENSITY = { warmup: 'warmup', work: 'active', active: 'active', recover: 'recovery', rest: 'rest', cooldown: 'cooldown' };

const clampStr = (s, n) => String(s || '').slice(0, n);

async function buildWorkoutFit(tpl) {
  const { Encoder, Profile } = await loadSdk();
  const T = Profile.types;
  const nameIndex = (cat, fit) => {
    const names = T[cat + 'ExerciseName'];
    if (!names) return undefined;
    const hit = Object.entries(names).find(([, v]) => v === fit);
    return hit ? Number(hit[0]) : undefined;
  };
  const steps = [];
  const push = (s) => { steps.push({ messageIndex: steps.length, ...s }); return steps.length - 1; };
  const lbs = tpl.units === 'imperial';

  const [sport, subSport] = SPORTS[tpl.sport] || SPORTS.strength;

  if (Array.isArray(tpl.exercises) && tpl.exercises.length) {
    tpl.exercises.forEach((ex, ei) => {
      const sets = (ex.sets || []).slice(0, 20);
      const catOk = ex.cat && Object.values(T.exerciseCategory).includes(ex.cat);
      sets.forEach((st, si) => {
        const step = {
          wktStepName: clampStr(ex.name, 15),
          intensity: st.warmup ? 'warmup' : 'active',
          targetType: 'open', targetValue: 0,
        };
        if (st.sec > 0) { step.durationType = 'time'; step.durationValue = Math.round(st.sec * 1000); }
        else if (st.reps > 0) { step.durationType = 'reps'; step.durationValue = Math.round(st.reps); }
        else { step.durationType = 'open'; step.durationValue = 0; }
        if (catOk) {
          step.exerciseCategory = ex.cat;
          const n = nameIndex(ex.cat, ex.fit);
          if (n !== undefined) step.exerciseName = n;
        }
        if (st.kg > 0) { step.exerciseWeight = Math.round(st.kg * 100) / 100; step.weightDisplayUnit = lbs ? 'pound' : 'kilogram'; }
        if (ex.notes && si === 0) step.notes = clampStr(ex.notes, 50);
        push(step);
        const last = si === sets.length - 1 && ei === tpl.exercises.length - 1;
        const rest = si === sets.length - 1 ? (ex.restAfter ?? ex.rest) : ex.rest;
        if (!last && rest !== 0) {
          push({ wktStepName: 'Rest', intensity: 'rest', targetType: 'open', targetValue: 0, ...(rest > 0 ? { durationType: 'time', durationValue: Math.round(rest * 1000) } : { durationType: 'open', durationValue: 0 }) });
        }
      });
    });
  }

  // Cardio steps: {kind, dur:{type:'time'|'distance'|'open', value}, target:{type:'hr'|'hrRange'|'pace'|'open', zone, low, high}, repeat, steps}
  const addCardio = (list) => {
    for (const s of list || []) {
      if (s.kind === 'repeat') {
        const from = steps.length;
        addCardio(s.steps);
        push({ durationType: 'repeatUntilStepsCmplt', durationValue: from, targetType: 'open', targetValue: Math.max(2, Math.min(99, s.repeat || 2)) });
        continue;
      }
      const step = { wktStepName: clampStr(s.name || s.kind, 15), intensity: INTENSITY[s.kind] || 'active', targetType: 'open', targetValue: 0 };
      const d = s.dur || {};
      if (d.type === 'time' && d.value > 0) { step.durationType = 'time'; step.durationValue = Math.round(d.value * 1000); }
      else if (d.type === 'distance' && d.value > 0) { step.durationType = 'distance'; step.durationValue = Math.round(d.value * 100); }
      else { step.durationType = 'open'; step.durationValue = 0; }
      const t = s.target || {};
      if (t.type === 'hr' && t.zone >= 1 && t.zone <= 5) { step.targetType = 'heartRate'; step.targetValue = t.zone; }
      else if (t.type === 'hrRange' && t.low > 0 && t.high > t.low) { step.targetType = 'heartRate'; step.targetValue = 0; step.customTargetValueLow = Math.round(t.low) + 100; step.customTargetValueHigh = Math.round(t.high) + 100; }
      else if (t.type === 'pace' && t.low > 0 && t.high > 0) {
        // low/high are m/s; FIT wants the slow end (low speed) first, in mm/s
        step.targetType = 'speed'; step.targetValue = 0;
        step.customTargetValueLow = Math.round(Math.min(t.low, t.high) * 1000); step.customTargetValueHigh = Math.round(Math.max(t.low, t.high) * 1000);
      }
      if (s.notes) step.notes = clampStr(s.notes, 50);
      push(step);
    }
  };
  addCardio(tpl.steps);

  if (!steps.length) throw Object.assign(new Error('Workout has no steps'), { status: 400 });
  if (steps.length > 250) throw Object.assign(new Error('Too many steps for a watch workout (max 250)'), { status: 400 });

  const enc = new Encoder();
  const now = new Date();
  enc.onMesg(Profile.MesgNum.FILE_ID, { type: 'workout', manufacturer: 'development', product: 0, serialNumber: 1, timeCreated: now });
  enc.onMesg(Profile.MesgNum.WORKOUT, { wktName: clampStr(tpl.name || 'FIT workout', 30), sport, subSport, numValidSteps: steps.length });
  for (const s of steps) enc.onMesg(Profile.MesgNum.WORKOUT_STEP, s);
  return Buffer.from(enc.close());
}

module.exports = { buildWorkoutFit };
