// Decode a Garmin activity download (ZIP containing a .fit file) into chart-ready streams.
'use strict';

const { unzipSync } = require('fflate');

let sdk;
const loadSdk = async () => (sdk ||= await import('@garmin/fitsdk'));

const SEMI = 180 / 2 ** 31;

function extractFit(buf) {
  const bytes = new Uint8Array(buf);
  // FIT header: byte 8..11 == ".FIT"
  if (bytes.length > 12 && String.fromCharCode(...bytes.slice(8, 12)) === '.FIT') return bytes;
  const files = unzipSync(bytes);
  const name = Object.keys(files).find((n) => n.toLowerCase().endsWith('.fit')) || Object.keys(files)[0];
  if (!name) throw new Error('Activity download was empty');
  return files[name];
}

// Largest-triangle-ish simple bucket downsample: keep every k-th point, always keep the last.
function downsample(arr, maxPts) {
  if (arr.length <= maxPts) return arr;
  const k = arr.length / maxPts;
  const out = [];
  for (let i = 0; i < maxPts; i++) out.push(arr[Math.floor(i * k)]);
  out.push(arr[arr.length - 1]);
  return out;
}

const r = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

async function parseActivityFile(buf, { maxPoints = 1500, full = false } = {}) {
  const { Decoder, Stream } = await loadSdk();
  const fit = extractFit(buf);
  const decoder = new Decoder(Stream.fromByteArray(fit));
  if (!decoder.isFIT()) throw new Error('Not a FIT file (Garmin may have returned GPX/TCX for this activity)');
  const { messages, errors } = decoder.read();
  const recs = messages.recordMesgs || [];
  const t0 = recs.length ? +new Date(recs[0].timestamp) : 0;

  const pts = recs.map((m) => ({
    t: Math.round((+new Date(m.timestamp) - t0) / 1000),
    hr: r(m.heartRate),
    spd: r(m.enhancedSpeed ?? m.speed, 3),
    alt: r(m.enhancedAltitude ?? m.altitude, 1),
    cad: r(m.cadence),
    pwr: r(m.power),
    dist: r(m.distance, 1),
    temp: r(m.temperature),
    lat: m.positionLat != null ? r(m.positionLat * SEMI, 6) : null,
    lon: m.positionLong != null ? r(m.positionLong * SEMI, 6) : null,
  }));

  const keys = ['t', 'hr', 'spd', 'alt', 'cad', 'pwr', 'dist', 'temp'];
  const sampled = downsample(pts, maxPoints);
  const streams = {};
  for (const k of keys) {
    if (k !== 't' && !sampled.some((p) => p[k] !== null)) continue;
    streams[k] = sampled.map((p) => p[k]);
  }
  // [lat, lon, speed m/s] so the client can shade the route by speed
  const track = downsample(pts.filter((p) => p.lat !== null && p.lon !== null && Math.abs(p.lat) > 1e-6), 2000).map((p) => [p.lat, p.lon, p.spd]);

  const laps = (messages.lapMesgs || []).map((l, i) => ({
    n: i + 1,
    dur: r(l.totalTimerTime),
    dist: r(l.totalDistance),
    avgHR: r(l.avgHeartRate),
    maxHR: r(l.maxHeartRate),
    spd: r(l.enhancedAvgSpeed ?? l.avgSpeed, 3),
    cad: r(l.avgRunningCadence ?? l.avgCadence),
    pwr: r(l.avgPower),
    elev: r(l.totalAscent),
  }));

  const sets = (messages.setMesgs || [])
    .filter((s) => s.setType === 'active' || s.setType === 1)
    .map((s) => ({ reps: s.repetitions ?? null, kg: r(s.weight, 1), dur: r(s.duration), cat: s.category?.[0] ?? null }));

  const s = (messages.sessionMesgs || [])[0] || {};
  const tiz = (messages.timeInZoneMesgs || []).find((z) => z.referenceMesg === 'session') || (messages.timeInZoneMesgs || []).slice(-1)[0];
  const up = (messages.userProfileMesgs || [])[0] || {};
  const fid = (messages.fileIdMesgs || [])[0] || {};
  const creator = (messages.deviceInfoMesgs || []).find((d) => d.deviceIndex === 'creator') || {};
  const out = {
    streams, track, laps, sets,
    session: {
      sport: s.sport, subSport: s.subSport, profileName: s.sportProfileName, totalAscent: r(s.totalAscent), totalDescent: r(s.totalDescent),
      avgTemp: r(s.avgTemperature), minTemp: r(s.minTemperature), maxTemp: r(s.maxTemperature), trainingLoadPeak: r(s.trainingLoadPeak, 1),
      elapsed: r(s.totalElapsedTime, 1), timer: r(s.totalTimerTime, 1), dist: r(s.totalDistance, 1), calories: r(s.totalCalories),
      avgHr: r(s.avgHeartRate), maxHr: r(s.maxHeartRate), minHr: r(s.minHeartRate), avgSpeed: r(s.enhancedAvgSpeed ?? s.avgSpeed, 3), maxSpeed: r(s.enhancedMaxSpeed ?? s.maxSpeed, 3),
      aerobicTE: r(s.totalTrainingEffect, 1), anaerobicTE: r(s.totalAnaerobicTrainingEffect, 1),
      // HR zones straight from the device (seconds in Z1..Z5) when the API summary has none
      hrZoneSec: Array.isArray(tiz?.timeInHrZone) ? tiz.timeInHrZone.slice(1, 6).map((v) => Math.round(v || 0)) : undefined,
      hrZoneSecBelow: Array.isArray(tiz?.timeInHrZone) ? Math.round(tiz.timeInHrZone[0] || 0) : undefined,
      hrZoneBounds: Array.isArray(tiz?.hrZoneHighBoundary) ? tiz.hrZoneHighBoundary : undefined,
      userMaxHr: r(tiz?.maxHeartRate), userRestingHr: r(tiz?.restingHeartRate ?? up.restingHeartRate), userWeightKg: r(up.weight, 1),
      device: fid.garminProduct || creator.garminProduct, firmware: creator.softwareVersion,
    },
    points: pts.length,
    errors: errors.map((e) => e.message).slice(0, 5),
  };
  if (full) {
    // Everything an analyst might want, untouched: used by the Claude bundle.
    const keep = ['fileIdMesgs', 'activityMesgs', 'sessionMesgs', 'lapMesgs', 'lengthMesgs', 'recordMesgs', 'eventMesgs', 'deviceInfoMesgs', 'userProfileMesgs',
      'zonesTargetMesgs', 'timeInZoneMesgs', 'sportMesgs', 'setMesgs', 'hrvMesgs', 'splitMesgs', 'splitSummaryMesgs', 'workoutMesgs', 'workoutStepMesgs', 'fieldDescriptionMesgs', 'developerDataIdMesgs'];
    out.messages = Object.fromEntries(keep.filter((k) => messages[k]?.length).map((k) => [k, messages[k]]));
    out.messageCounts = Object.fromEntries(Object.entries(messages).map(([k, v]) => [k, v.length]));
    out.records = pts;
  }
  return out;
}

module.exports = { parseActivityFile, extractFit, downsample };
