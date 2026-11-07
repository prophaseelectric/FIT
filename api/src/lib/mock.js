// Deterministic fake Garmin Personal API, shaped like the real Swagger schemas.
// Enabled with GARMIN_MOCK=1. Lets you click through FIT before you have an API key,
// and lets the tests run end to end. Activity downloads are real FIT files built with Garmin's SDK.
'use strict';

const DAY = 86400000;
const parse = (d) => Date.parse(d + 'T00:00:00Z');
const iso = (t) => new Date(t).toISOString().slice(0, 10);

function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r) => (r() + r() + r() + r() - 2) * 1.7;
function* days(f, t) { for (let d = parse(f); d <= parse(t); d += DAY) yield iso(d); }
const dayIndex = (d) => Math.round((parse(d) - parse('2020-01-01')) / DAY);

// Slow-moving "fitness" curve so trends look real.
const fitness = (d) => Math.sin(dayIndex(d) / 70) * 0.5 + dayIndex(d) / 4000;

function activityFor(d) {
  const r = rng('act' + d);
  if (r() > 0.62) return null;
  const k = r();
  const type = k < 0.5 ? 'running' : k < 0.75 ? 'cycling' : k < 0.92 ? 'strength_training' : 'walking';
  const startMin = 6 * 60 + Math.floor(r() * 12 * 60);
  const fit = fitness(d);
  const base = {
    running: { dur: 1800 + r() * 3000, spd: 2.9 + fit * 0.3 + r() * 0.4, hr: 148, typeId: 1, parent: 17 },
    cycling: { dur: 2700 + r() * 4500, spd: 7 + r() * 2.5, hr: 138, typeId: 2, parent: 17 },
    strength_training: { dur: 2400 + r() * 1500, spd: 0, hr: 112, typeId: 13, parent: 29 },
    walking: { dur: 1500 + r() * 2400, spd: 1.4 + r() * 0.2, hr: 102, typeId: 9, parent: 17 },
  }[type];
  const dur = Math.round(base.dur);
  const dist = Math.round(base.spd * dur);
  const avgHR = Math.round(base.hr - fit * 4 + gauss(r) * 4);
  const id = Number(d.replace(/-/g, '')) * 10 + 1;
  const startLocal = `${d} ${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}:00`;
  const startGmt = new Date(parse(d) + (startMin + 480) * 60000).toISOString().replace('T', ' ').slice(0, 19);
  const zones = [0.08, 0.32, 0.38, 0.17, 0.05].map((z) => Math.round(dur * z * (0.7 + r() * 0.6)));
  const load = Math.round((dur / 60) * (avgHR / 100) ** 3 * 0.9);
  const a = {
    activityId: id,
    activityName: { running: 'Morning Run', cycling: 'Road Ride', strength_training: 'Strength', walking: 'Walk' }[type],
    startTimeLocal: startLocal, startTimeGMT: startGmt,
    activityType: { typeId: base.typeId, typeKey: type, parentTypeId: base.parent },
    eventType: { typeKey: 'uncategorized' },
    distance: base.spd ? dist : 0, duration: dur, movingDuration: dur - 30, elapsedDuration: dur + 60,
    elevationGain: base.spd ? Math.round(r() * dist / 120) : 0,
    averageSpeed: base.spd || 0, maxSpeed: base.spd * 1.35,
    averageHR: avgHR, maxHR: avgHR + 22, calories: Math.round(dur / 60 * avgHR / 14),
    aerobicTrainingEffect: Math.round((2 + r() * 2.5) * 10) / 10, anaerobicTrainingEffect: Math.round(r() * 2 * 10) / 10,
    trainingEffectLabel: r() > 0.5 ? 'AEROBIC_BASE' : 'TEMPO',
    activityTrainingLoad: load, hasPolyline: !!base.spd,
    startLatitude: base.spd ? 32.7157 + r() * 0.05 : undefined, startLongitude: base.spd ? -117.1611 - r() * 0.05 : undefined,
    locationName: base.spd ? 'San Diego' : undefined,
    moderateIntensityMinutes: Math.round(dur / 60 * 0.4), vigorousIntensityMinutes: Math.round(dur / 60 * 0.3),
    differenceBodyBattery: -Math.round(dur / 300),
  };
  zones.forEach((z, i) => { a['hrTimeInZone_' + (i + 1)] = z; });
  if (type === 'running') {
    a.averageRunningCadenceInStepsPerMinute = 166 + Math.round(r() * 12);
    a.vO2MaxValue = Math.round(46 + fit * 3);
    a.avgGradeAdjustedSpeed = base.spd * 1.02;
    a.fastestSplit_1000 = Math.round(1000 / (base.spd * 1.08));
    a.fastestSplit_1609 = Math.round(1609 / (base.spd * 1.06));
    if (dist > 5000) a.fastestSplit_5000 = Math.round(5000 / (base.spd * 1.03));
    if (dist > 10000) a.fastestSplit_10000 = Math.round(10000 / base.spd);
    a.steps = Math.round(dur / 60 * a.averageRunningCadenceInStepsPerMinute);
  }
  if (type === 'cycling') { a.avgPower = Math.round(170 + fit * 20 + r() * 30); a.normPower = a.avgPower + 12; a.averageBikingCadenceInRevPerMinute = 86; }
  if (type === 'strength_training') { a.activeSets = 14 + Math.floor(r() * 8); a.totalReps = a.activeSets * 9; }
  return a;
}

function sleepFor(d) {
  const r = rng('sleep' + d);
  const dow = new Date(parse(d)).getUTCDay();
  const weekend = dow === 0 || dow === 6;
  const bed = 22.6 * 60 + gauss(r) * 25 + (weekend ? 45 : 0);
  const total = Math.round((7.1 + gauss(r) * 0.45 + (weekend ? 0.5 : 0)) * 3600);
  const deep = Math.round(total * (0.17 + r() * 0.06)), rem = Math.round(total * (0.2 + r() * 0.05));
  const awake = Math.round(600 + r() * 1800);
  const startLocal = parse(d) - DAY + bed * 60000;
  const score = Math.max(40, Math.min(98, Math.round(78 + (total / 3600 - 7.2) * 9 + gauss(r) * 5)));
  return {
    calendarDate: d, sleepTimeSeconds: total, deepSleepSeconds: deep, remSleepSeconds: rem,
    lightSleepSeconds: total - deep - rem, awakeSleepSeconds: awake, napTimeSeconds: r() > 0.9 ? 1500 : 0,
    sleepStartTimestampLocal: startLocal, sleepEndTimestampLocal: startLocal + (total + awake) * 1000,
    sleepStartTimestampGMT: startLocal + 8 * 3600000, sleepEndTimestampGMT: startLocal + 8 * 3600000 + (total + awake) * 1000,
    avgHeartRate: 52 - fitness(d) * 2 + gauss(r), averageRespirationValue: 14 + gauss(r) * 0.6,
    averageSpO2Value: 95 + r() * 2, avgSleepStress: 14 + r() * 10, awakeCount: Math.floor(r() * 4),
    sleepScores: { overall: { value: score, qualifierKey: score >= 90 ? 'EXCELLENT' : score >= 80 ? 'GOOD' : score >= 60 ? 'FAIR' : 'POOR' } },
    sleepNeed: { baseline: 480, actual: 480 + Math.round(gauss(r) * 15) },
    sleepScoreFeedback: 'POSITIVE_LONG_AND_DEEP',
  };
}

function hrvFor(d) {
  const r = rng('hrv' + d);
  const last = Math.round(58 + fitness(d) * 6 + gauss(r) * 6);
  return {
    calendarDate: d, lastNightAvg: last, weeklyAvg: Math.round(58 + fitness(d) * 6), lastNight5MinHigh: last + 18,
    status: last < 48 ? 'LOW' : last > 72 ? 'UNBALANCED' : 'BALANCED',
    baseline: { lowUpper: 47, balancedLow: 51, balancedUpper: 68, markerValue: 0.5 },
  };
}

function dailyFor(d) {
  const r = rng('day' + d);
  const a = activityFor(d);
  const steps = Math.round(7500 + gauss(r) * 2500 + (a?.steps || (a ? 2500 : 0)));
  const rhr = Math.round(54 - fitness(d) * 3 + gauss(r) * 1.5);
  return {
    calendarDate: d, source: 'garmin',
    movement: { steps: { goal: 10000, value: steps, distanceInMeters: steps * 0.78 }, floorsAscended: { value: Math.floor(r() * 18) } },
    calories: { burnedResting: 1820, burnedActive: Math.round(steps * 0.045 + (a?.calories || 0)), burnedTotal: Math.round(1820 + steps * 0.045 + (a?.calories || 0)) },
    heartRate: { minValue: rhr - 4, maxValue: a ? a.maxHR : 120 + Math.floor(r() * 20), restingValue: rhr },
    intensityMinutes: { goal: 150, moderate: a?.moderateIntensityMinutes || Math.floor(r() * 15), vigorous: a?.vigorousIntensityMinutes || 0 },
    stress: {
      avgLevel: Math.round(30 + gauss(r) * 7), maxLevel: 90,
      highStressDurationInMillis: Math.round(r() * 90) * 60000, mediumStressDurationInMillis: Math.round(60 + r() * 120) * 60000,
      lowStressDurationInMillis: Math.round(200 + r() * 120) * 60000, restDurationInMillis: Math.round(500 + r() * 60) * 60000,
    },
    bodyBattery: { maxValue: Math.min(100, Math.round(78 + gauss(r) * 9)), minValue: Math.round(15 + r() * 15), chargedValue: 60, drainedValue: 62, endOfDayValue: 25 },
    hydration: { goalInMl: 2500, consumedInFractionalMl: r() > 0.5 ? Math.round(1500 + r() * 1500) : 0 },
    respiration: { avgValue: 15, minValue: 11, maxValue: 22 },
    pulseOx: { avgValue: 96, minValue: 90 },
  };
}

function weightFor(d) {
  const r = rng('w' + d);
  if (r() > 0.45) return null;
  const kg = 88 - dayIndex(d) * 0.006 + Math.sin(dayIndex(d) / 40) * 0.8 + gauss(r) * 0.35;
  const w = { calendarDate: d, date: parse(d) + 7 * 3600000, weight: Math.round(kg * 1000), bodyFat: Math.round((21 - dayIndex(d) * 0.002 + gauss(r) * 0.3) * 10) / 10, bmi: Math.round(kg / 1.83 ** 2 * 10) / 10, muscleMass: Math.round(kg * 0.42 * 1000) };
  return { summaryDate: d, numOfWeightEntries: 1, latestWeight: w, allWeightMetrics: [w] };
}

async function fitFile(id) {
  const { Encoder, Profile } = await import('@garmin/fitsdk');
  const d = String(Math.floor(id / 10)).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  const a = activityFor(d);
  if (!a) return null;
  const r = rng('fit' + id);
  const start = new Date(Date.parse(a.startTimeGMT.replace(' ', 'T') + 'Z'));
  const enc = new Encoder();
  enc.onMesg(Profile.MesgNum.FILE_ID, { manufacturer: 'garmin', product: 0, timeCreated: start, type: 'activity', serialNumber: 1234 });
  let dist = 0, lat = a.startLatitude || 32.72, lon = a.startLongitude || -117.16, alt = 40, heading = r() * 6.28;
  const n = Math.min(a.duration, 7200);
  const laps = [];
  let lapStart = 0, lapDist0 = 0, lapHr = [];
  for (let t = 0; t < n; t++) {
    const spd = a.averageSpeed ? Math.max(0.5, a.averageSpeed * (1 + Math.sin(t / 240) * 0.08 + (r() - 0.5) * 0.05)) : 0;
    dist += spd;
    heading += (r() - 0.5) * 0.08 + (t % 900 === 0 ? 1.2 : 0);
    lat += Math.cos(heading) * spd / 111000; lon += Math.sin(heading) * spd / 93000;
    alt += Math.sin(t / 300) * 0.15;
    const hr = Math.round(Math.min(a.maxHR, a.averageHR - 25 + Math.min(1, t / 300) * 25 + Math.sin(t / 200) * 6 + (r() - 0.5) * 3));
    lapHr.push(hr);
    const rec = { timestamp: new Date(+start + t * 1000), heartRate: hr };
    if (spd) Object.assign(rec, { distance: dist, enhancedSpeed: spd, enhancedAltitude: alt, positionLat: Math.round(lat / (180 / 2 ** 31)), positionLong: Math.round(lon / (180 / 2 ** 31)), cadence: a.averageRunningCadenceInStepsPerMinute ? Math.round(a.averageRunningCadenceInStepsPerMinute / 2) : 86 });
    if (a.avgPower) rec.power = Math.round(a.avgPower * (1 + (r() - 0.5) * 0.3));
    enc.onMesg(Profile.MesgNum.RECORD, rec);
    const lapDone = spd ? dist - lapDist0 >= 1609.34 : t - lapStart >= 300;
    if (lapDone || t === n - 1) {
      laps.push({ timestamp: new Date(+start + t * 1000), startTime: new Date(+start + lapStart * 1000), totalTimerTime: t - lapStart + 1, totalElapsedTime: t - lapStart + 1, totalDistance: dist - lapDist0, avgHeartRate: Math.round(lapHr.reduce((x, y) => x + y, 0) / lapHr.length), maxHeartRate: Math.max(...lapHr), enhancedAvgSpeed: spd ? (dist - lapDist0) / (t - lapStart + 1) : undefined });
      lapStart = t + 1; lapDist0 = dist; lapHr = [];
    }
  }
  for (const l of laps) enc.onMesg(Profile.MesgNum.LAP, l);
  const end = new Date(+start + n * 1000);
  enc.onMesg(Profile.MesgNum.SESSION, { timestamp: end, startTime: start, totalElapsedTime: n, totalTimerTime: n, totalDistance: dist, sport: a.activityType.typeKey === 'cycling' ? 'cycling' : a.activityType.typeKey === 'running' ? 'running' : 'training', avgHeartRate: a.averageHR, maxHeartRate: a.maxHR, numLaps: laps.length, firstLapIndex: 0 });
  enc.onMesg(Profile.MesgNum.ACTIVITY, { timestamp: end, numSessions: 1, totalTimerTime: n });
  const { zipSync } = require('fflate');
  return Buffer.from(zipSync({ [`${id}_ACTIVITY.fit`]: enc.close() }));
}

class MockGarmin {
  constructor() { this.calls = 0; this.mock = true; }
  async getToken() { return 'mock'; }
  async get(path, p = {}, opts = {}) {
    this.calls++;
    let m;
    const today = iso(Date.now());
    const clampTo = (t) => (t > today ? today : t);
    if (path === '/usersummary-service/v2/dailysummaries') return { data: [...days(p.startDate, clampTo(p.endDate))].map(dailyFor) };
    if (path === '/sleep-service/sleep/dailySleepSummariesByDate') return [...days(p.startDate, clampTo(p.endDate))].map(sleepFor);
    if ((m = path.match(/^\/hrv-service\/hrv\/daily\/(.+)\/(.+)$/))) return { hrvSummaries: [...days(m[1], clampTo(m[2]))].map(hrvFor) };
    if ((m = path.match(/^\/weight-service\/weight\/range\/(.+)\/(.+)$/))) return { dailyWeightSummaries: [...days(m[1], clampTo(m[2]))].map(weightFor).filter(Boolean) };
    if (path === '/activitylist-service/activities/search/activities') {
      const all = [...days(p.startDate, clampTo(p.endDate))].map(activityFor).filter(Boolean);
      return all.slice(+p.start || 0, (+p.start || 0) + (+p.limit || 99));
    }
    if ((m = path.match(/^\/activity-service\/activity\/(\d+)$/))) {
      const a = activityFor(String(Math.floor(m[1] / 10)).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
      return a && { activityId: a.activityId, activityName: a.activityName, summaryDTO: { averageHR: a.averageHR, distance: a.distance, duration: a.duration }, description: 'Mock activity' };
    }
    if ((m = path.match(/^\/download-service\/files\/activity\/(\d+)$/))) return fitFile(Number(m[1]));
    if (path === '/userprofile-service/userprofile/settings') return { displayName: 'mock', measurementSystem: 'statute_us', timeZone: 'America/Los_Angeles' };
    if (path === '/biometric-service/heartRateZones/v2') return [{ sport: 'DEFAULT', trainingMethod: 'HR_MAX', zone1Floor: 93, zone2Floor: 111, zone3Floor: 130, zone4Floor: 148, zone5Floor: 167, maxHeartRateUsed: 185, restingHeartRateUsed: 52 }];
    if (path.startsWith('/fitnessage-service/')) return { chronologicalAge: 41, fitnessAge: 34.6, achievableFitnessAge: 32.1 };
    if (path === '/sleep-service/sleep/dailySleep') return sleepFor(p.date);
    if (path === '/wellness-service/wellness/dailyHeartRate') {
      const r = rng('hr' + p.date), t0 = parse(p.date) + 8 * 3600000;
      return { calendarDate: p.date, restingHeartRate: dailyFor(p.date).heartRate.restingValue, heartRateValueDescriptors: [{ index: 0, key: 'timestamp' }, { index: 1, key: 'heartrate' }], heartRateValues: Array.from({ length: 720 }, (_, i) => [t0 + i * 120000, Math.round(60 + Math.sin(i / 60) * 12 + (i > 210 && i < 450 ? 15 : -8) + r() * 8)]) };
    }
    if ((m = path.match(/^\/hrv-service\/hrv\/(\d{4}-\d{2}-\d{2})$/))) {
      const r = rng('hrvr' + m[1]), s = sleepFor(m[1]);
      return { hrvSummary: hrvFor(m[1]), hrvReadings: Array.from({ length: 90 }, (_, i) => ({ hrvValue: Math.round(55 + Math.sin(i / 14) * 12 + r() * 10), readingTimeLocal: new Date(s.sleepStartTimestampLocal + i * 300000).toISOString().slice(0, 19) })) };
    }
    if (path === '/wellness-service/wellness/bodyBattery/reports/daily') {
      return [...days(p.startDate, p.endDate)].map((d) => {
        const t0 = parse(d) + 8 * 3600000; let v = 30;
        return { date: d, charged: 60, drained: 62, bodyBatteryValueDescriptorDTOList: [{ index: 0, key: 'timestamp' }, { index: 1, key: 'bodyBatteryLevel' }], bodyBatteryValuesArray: Array.from({ length: 96 }, (_, i) => { v = i < 28 ? Math.min(100, v + 2.2) : Math.max(5, v - 0.8); return [t0 + i * 900000, Math.round(v)]; }) };
      });
    }
    if ((m = path.match(/^\/wellness-service\/wellness\/daily\/spo2acclimation\/(.+)$/))) return { calendarDate: m[1], averageSpO2: 96, lowestSpO2: 89, avgSleepSpO2: 95 };
    return { mock: true, path, params: p };
  }
}

let inst;
module.exports = { getMock: () => (inst ||= new MockGarmin()), activityFor };
