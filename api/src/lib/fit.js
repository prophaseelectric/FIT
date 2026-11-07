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

async function parseActivityFile(buf, { maxPoints = 1500 } = {}) {
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
  const track = downsample(pts.filter((p) => p.lat !== null && p.lon !== null && Math.abs(p.lat) > 1e-6), 2000).map((p) => [p.lat, p.lon]);

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
  return {
    streams, track, laps, sets,
    session: {
      sport: s.sport, subSport: s.subSport, totalAscent: r(s.totalAscent), totalDescent: r(s.totalDescent),
      avgTemp: r(s.avgTemperature), trainingLoadPeak: r(s.trainingLoadPeak, 1),
    },
    points: pts.length,
    errors: errors.map((e) => e.message).slice(0, 5),
  };
}

module.exports = { parseActivityFile, extractFit, downsample };
