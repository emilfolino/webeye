// Synthetic sessions with KNOWN ground truth, used ONLY to validate the
// analysis machinery (mapping, gating, filters, metrics, clock sync, stats).
// They say nothing about real webcam accuracy; the noise model is a stand-in.
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {gaussian, hashString, mulberry32} from '../shared/rng.js';
import {buildSchedule, pursuitPosition} from '../shared/protocol.js';
import {KEYPOINT_SUBSET, KP} from '../shared/keypoints.js';
import {writeLandmarks, selectFrames} from './landmarks.js';
import {normaliseSpec} from './spec.js';
import {loadSession} from './session.js';

export const DEFAULT_SCREEN = {widthPx: 1920, heightPx: 1080, widthMm: 527, heightMm: 296, pixelRatio: 1};

const SERVER_OFFSET_MS = 5000;   // server clock = browser clock + offset
const SERVER_DRIFT = 20e-6;
const GP3_TIME_ORIGIN = 12.5;    // seconds

/** Create a simulated session on disk. Returns the session directory. */
export function simulateSession({
  dir, protocol, participantId = 'P001', participantIndex = 0, seed = 1,
  screen = DEFAULT_SCREEN, fps = 30, cameras = [{id: 'cam4k', w: 3840, h: 2160, hfovDeg: 78}],
  gp3 = true, subject = {},
}) {
  const subj = {
    gazeNoiseDeg: 0.15, fixationBiasDeg: 0.3, pursuitLagMs: 120, gp3NoiseDeg: 0.5,
    blinkEveryMs: 4000, blinkMs: 250, noFaceRate: 0.01, headMoveAmp: 0.04,
    degPerEyeWidth: 140, ...subject,
  };
  const rand = mulberry32((seed ^ hashString(participantId)) >>> 0);
  const schedule = buildSchedule(protocol, {width: screen.widthPx, height: screen.heightPx}, participantIndex);
  const events = [];
  const truth = [];  // targets with browser-clock intervals
  const blocks = [];
  let t = 1000;
  events.push({type: 'session_start', t});
  for (const s of schedule) {
    if (s.type === 'block_start') {
      events.push({type: 'block_start', t, blockId: s.blockId, condition: s.condition, calibrationFrom: s.calibrationFrom});
      const nominal = s.condition.distance_cm;
      const measured = Math.round((nominal + gaussian(rand) * 1.0) * 10) / 10;
      events.push({type: 'block_measure', t: t + 1, blockId: s.blockId, distance_cm: measured});
      blocks.push({id: s.blockId, t, distance_cm: measured, headMove: false});
      t += 3000;
    } else if (s.type === 'instruction') {
      events.push({type: 'instruction', t, text: s.text});
      t += 2000;
    } else if (s.type === 'sync') {
      events.push({type: 'sync', t, durationMs: s.durationMs});
      t += s.durationMs;
    } else if (s.type === 'target') {
      const ev = {type: 'target_on', t, id: s.id, blockId: s.blockId, role: s.role, set: s.set, rep: s.rep,
        index: s.index, x: s.x, y: s.y, nx: s.nx, ny: s.ny, subsets: s.subsets,
        settleMs: s.settleMs, collectMs: s.collectMs, kind: s.kind};
      events.push(ev);
      truth.push({...ev, tOn: t, tOff: t + s.durationMs});
      t += s.durationMs;
      events.push({type: 'target_off', t, id: s.id});
      t += 200;
    } else if (s.type === 'pursuit') {
      const ev = {type: 'pursuit_on', t, id: s.id, blockId: s.blockId, role: s.role, path: s.path,
        settleMs: s.settleMs, durationMs: s.durationMs};
      events.push(ev);
      truth.push({...ev, tOn: t, tOff: t + s.durationMs, kind: 'pursuit'});
      t += s.durationMs;
      events.push({type: 'pursuit_off', t, id: s.id});
      t += 200;
    }
  }
  events.push({type: 'session_end', t: t + 500, aborted: false});
  const tEnd = t + 1000;

  // clock_sync pings every 20 s (browser times); server = browser + offset (+drift)
  const serverOf = tb => tb + SERVER_OFFSET_MS + SERVER_DRIFT * tb;
  for (let tb = 500; tb < tEnd; tb += 20000) {
    const rtt = 2 + rand() * 6;
    events.push({type: 'clock_sync', t: tb, t1: tb + rtt, serverT: serverOf(tb + rtt / 2)});
  }
  events.sort((a, b) => a.t - b.t);

  // Gaze function (px) with fixation bias, latency and noise handled below.
  const px2deg = 0.5;  // rough, only to scale angular noise to px for simulation
  void px2deg;
  const geomPxPerDeg = (screen.widthPx / screen.widthMm) * (60 * 10) * Math.PI / 180;
  const biasByTarget = new Map();
  const gazeAt = tq => {
    let cur = truth.find(g => tq >= g.tOn && tq < g.tOff);
    if (!cur) return null;
    let x, y;
    if (cur.kind === 'pursuit') {
      const p = pursuitPosition(cur.path, Math.max(0, tq - cur.tOn - subj.pursuitLagMs));
      x = p.nx * screen.widthPx;
      y = p.ny * screen.heightPx;
    } else if (tq - cur.tOn < 250) {
      const prev = [...truth].reverse().find(g => g.tOff <= cur.tOn && g.kind !== 'pursuit') || cur;
      x = prev.x ?? cur.x;
      y = prev.y ?? cur.y;
    } else {
      if (!biasByTarget.has(cur.id)) {
        biasByTarget.set(cur.id, [gaussian(rand) * subj.fixationBiasDeg, gaussian(rand) * subj.fixationBiasDeg]);
      }
      const b = biasByTarget.get(cur.id);
      x = cur.x + b[0] * geomPxPerDeg;
      y = cur.y + b[1] * geomPxPerDeg;
    }
    return {x, y, cur};
  };

  mkdirSync(dir, {recursive: true});
  const manifest = {
    sessionId: `sim-${participantId}`, simulated: true,
    participant: {id: participantId, index: participantIndex},
    protocol: {name: protocol.name, version: protocol.version},
    screen, cameras: cameras.map(c => ({id: c.id, label: 'simulated', granted: {w: c.w, h: c.h, fps}, hfovDeg: c.hfovDeg, frameFormat: 'none'})),
    gp3: gp3 ? {present: true} : {present: false},
    consent: {study: true, rawVideoRelease: false, derivedRelease: true},
    seed, subject: subj,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  writeFileSync(join(dir, 'events.jsonl'), events.map(e => JSON.stringify(e)).join('\n') + '\n');
  const frames = [];
  for (let i = 0, tf = 1000; tf < tEnd; i++, tf += 1000 / fps + (rand() - 0.5) * 2) {
    frames.push({i, t: Math.round(tf * 100) / 100, w: cameras[0].w, h: cameras[0].h, file: `${String(i + 1).padStart(6, '0')}.jpg`});
  }
  for (const c of cameras) {
    const cdir = join(dir, 'cameras', c.id);
    mkdirSync(cdir, {recursive: true});
    writeFileSync(join(cdir, 'frames.jsonl'), frames.map(f => JSON.stringify({...f, w: c.w, h: c.h})).join('\n') + '\n');
  }
  if (gp3) {
    const lines = [];
    for (let tb = 1000; tb < tEnd; tb += 1000 / 60) {
      const g = gazeAt(tb);
      const noise = () => gaussian(rand) * subj.gp3NoiseDeg * geomPxPerDeg;
      const valid = g && rand() > 0.02;
      const serverT = serverOf(tb);
      lines.push(JSON.stringify({
        rx: serverT + rand() * 8, time: serverT / 1000 - 5 * 0 - GP3_TIME_ORIGIN,
        bpogx: valid ? (g.x + noise()) / screen.widthPx : 0, bpogy: valid ? (g.y + noise()) / screen.heightPx : 0,
        bpogv: valid ? 1 : 0,
      }));
    }
    writeFileSync(join(dir, 'gp3.jsonl'), lines.join('\n') + '\n');
  }
  // Persist everything the landmark generator needs.
  writeFileSync(join(dir, 'sim_truth.json'), JSON.stringify({blocks, subj}));
  return {dir, gazeAt, blocks, subj, screen, cameras, seed, rand: mulberry32(seed ^ 0x9e3779b1)};
}

/**
 * Write a synthetic landmark cache for a spec. Landmark jitter has a pixel
 * quantisation floor, so lower resolution => larger angular noise (a stand-in
 * for the effect the study measures; NOT evidence about the real effect).
 */
export function simulateLandmarks(sim, spec, {
  noiseFloorPx = 0.25, noiseRelEye = 0.002, headYawSensitivity = 1,
} = {}) {
  const s = normaliseSpec(spec);
  const session = loadSession(sim.dir);
  const cam = sim.cameras.find(c => c.id === s.camera);
  const src = session.cameras[s.camera].frames;
  const chosen = selectFrames(src, s.preprocess.fps);
  let w = cam.w, h = cam.h;
  const rs = s.preprocess.resize;
  if (Array.isArray(rs)) [w, h] = rs;
  else if (rs?.scale) { w = Math.round(w * rs.scale); h = Math.round(h * rs.scale); }
  const rand = mulberry32((sim.seed ^ hashString(JSON.stringify(s.preprocess) + s.model.runtime)) >>> 0);
  const blockOf = tq => {
    let cur = sim.blocks[0];
    for (const b of sim.blocks) if (b.t <= tq) cur = b;
    return cur;
  };
  const subj = sim.subj;
  const records = [];
  let blinkUntil = -1, nextBlink = 2000 + rand() * subj.blinkEveryMs;
  for (const f of chosen) {
    const t = f.t;
    if (t >= nextBlink) {
      blinkUntil = t + subj.blinkMs;
      nextBlink = t + subj.blinkEveryMs * (0.5 + rand());
    }
    if (rand() < subj.noFaceRate) { records.push({i: f.i, t, ok: false}); continue; }
    const g = sim.gazeAt(t);
    const blk = blockOf(t);
    const gx = g ? g.x : sim.screen.widthPx / 2, gy = g ? g.y : sim.screen.heightPx / 2;
    // Gaze angle (deg) relative to screen centre, from the true geometry.
    const dMm = blk.distance_cm * 10;
    const ax = Math.atan(((gx - sim.screen.widthPx / 2) * sim.screen.widthMm / sim.screen.widthPx) / dMm) * 180 / Math.PI;
    const ay = Math.atan(((gy - sim.screen.heightPx / 2) * sim.screen.heightMm / sim.screen.heightPx) / dMm) * 180 / Math.PI;
    const isHead = g?.cur?.role === 'headmove';
    const phase = t / 1000;
    const yaw = (isHead ? subj.headMoveAmp : subj.headMoveAmp * 0.1) * Math.sin(2 * Math.PI * 0.2 * phase);
    const dxHead = yaw * w * headYawSensitivity;
    const dyHead = (isHead ? subj.headMoveAmp : subj.headMoveAmp * 0.1) * h * Math.sin(2 * Math.PI * 0.15 * phase + 1);
    const iod = 0.13 * w * (600 / dMm) * (1 + 0.02 * Math.sin(phase));
    const ew = 0.38 * iod;
    const cx = w / 2 + dxHead, cy = h / 2 + dyHead;
    const kp = {};
    const sigma = Math.max(noiseFloorPx, noiseRelEye * ew) * (1 + 0.0 * ew);
    const jit = () => gaussian(rand) * sigma;
    const blink = t < blinkUntil;
    const open = blink ? 0.04 : 0.14;
    const place = (idx, x, y) => { kp[idx] = [x + jit(), y + jit(), 0]; };
    // Gaze -> iris offset in eye widths (image-left = subject's right eye).
    const offX = -(ax / subj.degPerEyeWidth) * (1 + 0.004 * Math.abs(ax));
    const offY = (ay / subj.degPerEyeWidth) * (1 + 0.004 * Math.abs(ay));
    for (const [eye, sign, iris] of [[KP.rightEye, -1, KP.rightIris], [KP.leftEye, +1, KP.leftIris]]) {
      const ecx = cx + sign * iod / 2, ecy = cy;
      // sign -1: outer at image-left; sign +1: outer at image-right.
      place(eye.outer, ecx + sign * ew / 2, ecy);
      place(eye.inner, ecx - sign * ew / 2, ecy);
      place(eye.top, ecx, ecy - open * ew);
      place(eye.bottom, ecx, ecy + open * ew);
      place(eye.top2, ecx - ew * 0.15, ecy - open * ew * 0.9);
      place(eye.bottom2, ecx - ew * 0.15, ecy + open * ew * 0.9);
      place(eye.top3, ecx + ew * 0.15, ecy - open * ew * 0.9);
      place(eye.bottom3, ecx + ew * 0.15, ecy + open * ew * 0.9);
      const ix = ecx + offX * ew, iy = ecy + offY * ew;
      const r = 0.19 * ew;  // iris radius ~ 11.7mm/2 relative to eye width ~ 30mm
      place(iris[0], ix, iy);
      place(iris[1], ix + r, iy); place(iris[2], ix, iy - r);
      place(iris[3], ix - r, iy); place(iris[4], ix, iy + r);
    }
    place(KP.noseTip, cx + yaw * 0.5 * iod, cy + 0.55 * iod);
    place(KP.noseBridge, cx, cy - 0.05 * iod);
    place(KP.forehead, cx, cy - 0.8 * iod);
    place(KP.chin, cx, cy + 1.5 * iod);
    place(KP.rightCheek, cx - 0.95 * iod, cy + 0.3 * iod);
    place(KP.leftCheek, cx + 0.95 * iod, cy + 0.3 * iod);
    place(KP.mouthRight, cx - 0.4 * iod, cy + 1.0 * iod);
    place(KP.mouthLeft, cx + 0.4 * iod, cy + 1.0 * iod);
    records.push({
      i: f.i, t, ok: true, ms: 8 + rand() * 4,
      kp: KEYPOINT_SUBSET.map(idx => (kp[idx] || [0, 0, 0]).map(v => Math.round(v * 1000) / 1000)),
    });
  }
  return writeLandmarks(sim.dir, s, {camera: s.camera, w, h, subset: KEYPOINT_SUBSET, simulated: true, nFrames: chosen.length}, records);
}
