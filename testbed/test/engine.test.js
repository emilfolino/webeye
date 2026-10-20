import test from 'node:test';
import assert from 'node:assert/strict';
import {ScreenGeometry} from '../src/shared/geometry.js';
import {createFilter} from '../src/engine/filters.js';
import {targetMetrics} from '../src/engine/metrics.js';
import {browserServerClock, gp3ServerClock} from '../src/engine/sync.js';
import {normaliseSpec, specHash, landmarkKey, preprocessKey} from '../src/engine/spec.js';
import {selectFrames} from '../src/engine/landmarks.js';
import {participantSplit} from '../src/engine/session.js';
import {gaussian, mulberry32} from '../src/shared/rng.js';

const geom = new ScreenGeometry({widthPx: 1000, heightPx: 500, widthMm: 500, heightMm: 250}, 600);

test('filters: identity, median kills spike, one-euro smooths noise but follows steps', () => {
  const none = createFilter({type: 'none'});
  assert.deepEqual(none.step(0, [3, 4]), [3, 4]);
  const med = createFilter({type: 'median', window: 5});
  let out;
  [[0, 0], [0, 0], [100, 100], [0, 0], [0, 0]].forEach((p, i) => { out = med.step(i * 33, p); });
  assert.deepEqual(out, [0, 0]);
  const r = mulberry32(1), f = createFilter({type: 'one-euro', minCutoff: 1, beta: 0.01});
  const raw = [], sm = [];
  for (let i = 0; i < 300; i++) {
    const p = [500 + gaussian(r) * 10, 300 + gaussian(r) * 10];
    raw.push(p[0]);
    sm.push(f.step(i * 33, p)[0]);
  }
  const sdv = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
  assert.ok(sdv(sm.slice(50)) < 0.6 * sdv(raw.slice(50)));
  const g = createFilter({type: 'one-euro', minCutoff: 1, beta: 0.5});
  let last;
  for (let i = 0; i < 60; i++) last = g.step(i * 33, [i < 30 ? 0 : 400, 0]);
  assert.ok(last[0] > 395);  // speed coefficient lets it follow a step
});

test('targetMetrics: known offset and spread', () => {
  const target = [500, 250];
  const px = 600 * Math.tan(Math.PI / 180) / 0.5;  // 1 degree in px
  const preds = [[500 + px, 250 + 5], [500 + px, 250 - 5], [500 + px, 250 + 5], [500 + px, 250 - 5]];
  const m = targetMetrics(geom, preds, target);
  assert.ok(Math.abs(m.accuracy_deg - 1) < 1e-3);
  assert.ok(m.precision_sd_deg > 0 && m.precision_sd_deg < 0.5);
  assert.ok(m.precision_rms_s2s_deg > m.precision_sd_deg * 0.9);
  assert.equal(targetMetrics(geom, [], target).n, 0);
  const still = targetMetrics(geom, [[510, 260], [510, 260], [510, 260]], target);
  assert.equal(still.precision_rms_s2s_deg, 0);
});

test('clock sync: recovers offset/drift from low-RTT pings, rejects high-RTT outliers', () => {
  const events = [];
  const r = mulberry32(9);
  for (let tb = 0; tb < 600000; tb += 20000) {
    const rtt = 3 + r() * 4;
    const jitter = tb % 40000 === 0 ? 300 : 0;  // occasional queued ping
    events.push({type: 'clock_sync', t: tb, t1: tb + rtt + jitter, serverT: tb + rtt / 2 + 7000 + 30e-6 * tb + jitter / 2 + (jitter ? 200 : 0)});
  }
  const c = browserServerClock(events);
  assert.ok(Math.abs(c.toServer(300000) - (300000 + 7000 + 9)) < 3);
  assert.ok(Math.abs(c.toBrowser(c.toServer(123456)) - 123456) < 1e-6);
  const samples = [];
  for (let i = 0; i < 600; i++) samples.push({time: i / 60, rx: 5000 + i * 1000 / 60 + r() * 6});
  const g = gp3ServerClock(samples);
  assert.ok(Math.abs(g.slope - 1) < 1e-3 && g.residualSd < 3);
});

test('spec: tag required, hash ignores tag/description/frozen but not content', () => {
  assert.throws(() => normaliseSpec({}), /tag/);
  const a = {tag: 'a', mapping: {degree: 2}}, b = {tag: 'b', description: 'x', mapping: {degree: 2, lambda: 1e-3}, frozen: true};
  assert.equal(specHash(a), specHash(b));
  assert.notEqual(specHash(a), specHash({tag: 'a', mapping: {degree: 3}}));
  // mapping/filter changes must not invalidate the expensive landmark cache
  assert.equal(landmarkKey(a), landmarkKey({tag: 'z', mapping: {degree: 1}, filter: {type: 'median'}}));
  assert.notEqual(landmarkKey(a), landmarkKey({tag: 'a', preprocess: {resize: [1280, 720]}}));
  assert.notEqual(landmarkKey(a), landmarkKey({tag: 'a', model: {refineLandmarks: false}}));
  assert.equal(preprocessKey(a), preprocessKey({tag: 'q', model: {runtime: 'tfjs'}}));
});

test('selectFrames: fps reduction keeps ~half at 15 of 30, keeps all when null', () => {
  const frames = Array.from({length: 300}, (_, i) => ({i, t: i * 33.33 + (i % 3) * 0.5}));
  assert.equal(selectFrames(frames, null).length, 300);
  const half = selectFrames(frames, 15).length;
  assert.ok(half >= 148 && half <= 152, `got ${half}`);
});

test('participantSplit is deterministic and roughly respects devFraction', () => {
  assert.equal(participantSplit('P007'), participantSplit('P007'));
  let dev = 0;
  for (let i = 0; i < 1000; i++) if (participantSplit('P' + i) === 'dev') dev++;
  assert.ok(dev > 250 && dev < 350);
});
