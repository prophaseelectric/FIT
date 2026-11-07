// Turns raw Garmin Personal API payloads into compact per-day metric rows and slim
// activity rows. Raw payloads are stored too, so nothing is lost if we want more later.
'use strict';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v !== '' && Number.isFinite(+v) ? +v : undefined));
const round = (v, d = 1) => (v === undefined ? undefined : Math.round(v * 10 ** d) / 10 ** d);

// Garmin timestamps arrive as epoch ms, ISO strings without a zone, or {date, localDate}.
// "Local" fields are wall-clock times; we keep them as "wall-clock ms" (read back with UTC getters).
function toMs(v) {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v;
  if (typeof v === 'object') return toMs(v.date ?? v.localDate);
  if (/^\d+$/.test(v)) return toMs(Number(v));
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : v.replace(' ', 'T') + 'Z';
  const t = Date.parse(s);
  return Number.isNaN(t) ? undefined : t;
}

// Some body-composition values come back in grams.
const kg = (v) => { v = num(v); return v === undefined ? undefined : (v > 500 ? v / 1000 : v); };

function clean(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null || Number.isNaN(o[k])) delete o[k];
  return o;
}

const ms2min = (v) => (num(v) === undefined ? undefined : Math.round(num(v) / 60000));

const TYPES = {
  dailies(it) {
    const m = it.movement || {}, c = it.calories || {}, h = it.heartRate || {}, im = it.intensityMinutes || {};
    const s = it.stress || {}, bb = it.bodyBattery || {}, hy = it.hydration || {}, r = it.respiration || {}, po = it.pulseOx || {};
    return clean({
      steps: num(m.steps?.value), stepGoal: num(m.steps?.goal), distM: num(m.steps?.distanceInMeters),
      floors: num(m.floorsAscended?.value),
      calTotal: num(c.burnedTotal), calActive: num(c.burnedActive), calResting: num(c.burnedResting), calIn: num(c.consumedValue) || undefined,
      rhr: num(h.restingValue), hrMin: num(h.minValue), hrMax: num(h.maxValue),
      imMod: num(im.moderate), imVig: num(im.vigorous), imGoal: num(im.goal),
      stressAvg: num(s.avgLevel) > 0 ? num(s.avgLevel) : undefined, stressMax: num(s.maxLevel),
      stressHighMin: ms2min(s.highStressDurationInMillis), stressMedMin: ms2min(s.mediumStressDurationInMillis),
      stressLowMin: ms2min(s.lowStressDurationInMillis), restMin: ms2min(s.restDurationInMillis),
      bbMax: num(bb.maxValue), bbMin: num(bb.minValue), bbCharged: num(bb.chargedValue), bbDrained: num(bb.drainedValue), bbEnd: num(bb.endOfDayValue),
      waterMl: num(hy.consumedInFractionalMl) ? Math.round(hy.consumedInFractionalMl) : undefined, waterGoalMl: num(hy.goalInMl),
      respAvg: num(r.avgValue), respMin: num(r.minValue), respMax: num(r.maxValue),
      spo2Avg: num(po.avgValue), spo2Min: num(po.minValue),
    });
  },
  sleep(it) {
    if (!num(it.sleepTimeSeconds)) return {};
    const sc = it.sleepScores || {};
    const overall = sc.overall || sc.totalScore || {};
    return clean({
      sleepSec: num(it.sleepTimeSeconds), deepSec: num(it.deepSleepSeconds), lightSec: num(it.lightSleepSeconds),
      remSec: num(it.remSleepSeconds), awakeSec: num(it.awakeSleepSeconds), napSec: num(it.napTimeSeconds) || undefined,
      sleepScore: num(overall.value), sleepQual: overall.qualifierKey,
      sleepStart: toMs(it.sleepStartTimestampLocal), sleepEnd: toMs(it.sleepEndTimestampLocal),
      sleepNeedMin: num(it.sleepNeed?.actual), sleepNeedBase: num(it.sleepNeed?.baseline),
      sleepHr: round(num(it.avgHeartRate)), sleepResp: round(num(it.averageRespirationValue)),
      sleepSpo2: round(num(it.averageSpO2Value)), sleepStress: round(num(it.avgSleepStress)),
      awakeCount: num(it.awakeCount), sleepFeedback: it.sleepScoreFeedback || undefined,
    });
  },
  hrv(it) {
    return clean({
      hrv: num(it.lastNightAvg), hrvWeek: num(it.weeklyAvg), hrvHigh: num(it.lastNight5MinHigh),
      hrvStatus: it.status || undefined,
      hrvBalLow: num(it.baseline?.balancedLow), hrvBalHigh: num(it.baseline?.balancedUpper),
    });
  },
  weight(it) {
    const w = it.latestWeight || (it.allWeightMetrics || []).slice(-1)[0];
    if (!w) return {};
    return clean({
      weight: round(kg(w.weight), 2), bodyFat: round(num(w.bodyFat)), bmi: round(num(w.bmi)),
      muscleKg: round(kg(w.muscleMass), 2), boneKg: round(kg(w.boneMass), 2), bodyWater: round(num(w.bodyWater)),
      visceralFat: num(w.visceralFat), metabolicAge: num(w.metabolicAge),
    });
  },
};

// Which keys each type owns, so a re-sync can clear stale values for that type only.
const TYPE_KEYS = {
  dailies: ['steps', 'stepGoal', 'distM', 'floors', 'calTotal', 'calActive', 'calResting', 'calIn', 'rhr', 'hrMin', 'hrMax', 'imMod', 'imVig', 'imGoal', 'stressAvg', 'stressMax', 'stressHighMin', 'stressMedMin', 'stressLowMin', 'restMin', 'bbMax', 'bbMin', 'bbCharged', 'bbDrained', 'bbEnd', 'waterMl', 'waterGoalMl', 'respAvg', 'respMin', 'respMax', 'spo2Avg', 'spo2Min'],
  sleep: ['sleepSec', 'deepSec', 'lightSec', 'remSec', 'awakeSec', 'napSec', 'sleepScore', 'sleepQual', 'sleepStart', 'sleepEnd', 'sleepNeedMin', 'sleepNeedBase', 'sleepHr', 'sleepResp', 'sleepSpo2', 'sleepStress', 'awakeCount', 'sleepFeedback'],
  hrv: ['hrv', 'hrvWeek', 'hrvHigh', 'hrvStatus', 'hrvBalLow', 'hrvBalHigh'],
  weight: ['weight', 'bodyFat', 'bmi', 'muscleKg', 'boneKg', 'bodyWater', 'visceralFat', 'metabolicAge'],
};

function slimActivity(a) {
  const zones = [1, 2, 3, 4, 5].map((i) => num(a['hrTimeInZone_' + i]) || 0);
  const splits = {};
  for (const d of [400, 1000, 1609, 5000, 10000, 21098, 42195]) {
    const v = num(a['fastestSplit_' + d]);
    if (v) splits[d] = round(v, 1);
  }
  return clean({
    id: a.activityId, name: a.activityName, type: a.activityType?.typeKey || 'other',
    parentTypeId: a.activityType?.parentTypeId, event: a.eventType?.typeKey,
    start: a.startTimeLocal, startGMT: a.startTimeGMT,
    dist: round(num(a.distance), 0), dur: round(num(a.duration), 0), moving: round(num(a.movingDuration), 0),
    elev: round(num(a.elevationGain), 0), avgHR: num(a.averageHR), maxHR: num(a.maxHR),
    cal: round(num(a.calories), 0), avgSpeed: num(a.averageSpeed), maxSpeed: num(a.maxSpeed),
    gap: num(a.avgGradeAdjustedSpeed),
    cadence: num(a.averageRunningCadenceInStepsPerMinute) ?? num(a.averageBikingCadenceInRevPerMinute),
    power: num(a.avgPower), np: num(a.normPower), tss: num(a.trainingStressScore),
    teAer: num(a.aerobicTrainingEffect), teAna: num(a.anaerobicTrainingEffect), teLabel: a.trainingEffectLabel,
    load: round(num(a.activityTrainingLoad), 1), vo2: num(a.vO2MaxValue),
    hrz: zones.some(Boolean) ? zones.map((z) => Math.round(z)) : undefined,
    splits: Object.keys(splits).length ? splits : undefined,
    pr: a.pr || a.isPR || undefined, steps: num(a.steps), sets: num(a.activeSets), reps: num(a.totalReps),
    poly: a.hasPolyline || undefined, lat: num(a.startLatitude), lon: num(a.startLongitude),
    loc: a.locationName, imMod: num(a.moderateIntensityMinutes), imVig: num(a.vigorousIntensityMinutes),
    bb: num(a.differenceBodyBattery), manual: a.manualActivity || a.isManualActivity || undefined,
  });
}

module.exports = { TYPES, TYPE_KEYS, slimActivity, toMs, num };
