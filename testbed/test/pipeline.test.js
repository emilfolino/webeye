// End-to-end tests of the replay engine on simulated sessions with known truth.
import test, {before} from 'node:test';
import assert from 'node:assert/strict';
import {simulateSession, simulateLandmarks} from '../src/engine/simulate.js';
import {loadSession} from '../src/engine/session.js';
import {runPipeline, runCv, MissingLandmarksError} from '../src/engine/pipeline.js';
import {mean} from '../src/engine/stats.js';
import {protocol, tmp} from './helpers.js';

let sim, session;
const spec = (tag, over = {}) => ({tag, preprocess: {resize: [1920, 1080]}, ...over});
const pooled = (rows, o = {}) => rows.filter(r => r.level === 'pooled' && r.role === (o.role || 'validation') &&
    (!o.block || r.block === o.block));
const meanOf = (rows, k) => mean(rows.map(r => r[k]));

before(() => {
  sim = simulateSession({dir: tmp(), protocol, participantId: 'T001', seed: 11});
  session = loadSession(sim.dir);
});

const run = (s, sub) => {
  simulateLandmarks(sim, s, sub);
  return runPipeline(session, s);
};

test('baseline recovers the simulated truth: accuracy ~ fixation bias, loss accounted', () => {
  const {rows} = run(spec('base'));
  const val = pooled(rows);
  assert.ok(val.length >= 8);
  const acc = meanOf(val, 'accuracy_deg');
  assert.ok(acc > 0.1 && acc < 0.9, `acc ${acc}`);  // fixation bias 0.3 deg/axis ~0.4 deg
  for (const r of val) {
    assert.ok(r.loss > 0 && r.loss < 0.3);
    assert.equal(r.n_expected >= r.n_used, true);
  }
  assert.ok(rows.some(r => r.role === 'pursuit' && r.lag_ms >= 60 && r.lag_ms <= 200));  // sim lag 120 ms
});

test('MissingLandmarksError when the cache is absent', () => {
  assert.throws(() => runPipeline(session, spec('nocache', {preprocess: {resize: [123, 77]}})), MissingLandmarksError);
});

test('lower resolution increases precision error (known simulated effect)', () => {
  const hi = pooled(run(spec('hi')).rows), lo = pooled(run(spec('lo', {preprocess: {resize: [480, 270]}})).rows);
  assert.ok(meanOf(lo, 'precision_sd_deg') > meanOf(hi, 'precision_sd_deg') * 1.5);
});

test('eye-relative features are robust to head motion; raw iris position is not', () => {
  const eye = pooled(run(spec('eye')).rows, {role: 'headmove'});
  const raw = pooled(run(spec('raw', {features: {type: 'iris-mean'}})).rows, {role: 'headmove'});
  assert.ok(meanOf(raw, 'accuracy_deg') > 2 * meanOf(eye, 'accuracy_deg'));
});

test('fewer calibration points generalise worse than the full grid', () => {
  const full = pooled(run(spec('c25')).rows), four = pooled(run(spec('c4', {calibration: {subset: '4'}, mapping: {degree: 1}})).rows);
  assert.ok(meanOf(four, 'accuracy_deg') >= meanOf(full, 'accuracy_deg') * 0.9);
  assert.ok(four.length > 0);
});

test('frame-rate reduction changes expected-frame counts proportionally', () => {
  const full = pooled(run(spec('f30')).rows), half = pooled(run(spec('f15', {preprocess: {resize: [1920, 1080], fps: 15}})).rows);
  const ratio = mean(half.map(r => r.n_expected)) / mean(full.map(r => r.n_expected));
  assert.ok(ratio > 0.45 && ratio < 0.55, `ratio ${ratio}`);
});

test('filter lowers dispersion', () => {
  const none = pooled(run(spec('nof')).rows), f = pooled(run(spec('euro', {filter: {type: 'one-euro', minCutoff: 1, beta: 0.005}})).rows);
  assert.ok(meanOf(f, 'precision_sd_deg') < meanOf(none, 'precision_sd_deg'));
});

test('retest block is evaluated with the first block calibration', () => {
  const rows = run(spec('retest')).rows.filter(r => r.block === 'normal-60-retest' && r.level === 'pooled');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].calibration_from, 'normal-60');
  assert.equal(rows[0].rep, 3);
});

test('GP3 reference pipeline and GP3 gating', () => {
  const ref = runPipeline(session, {tag: 'gp3', model: {runtime: 'gp3'}});
  const gp3Acc = meanOf(pooled(ref.rows), 'accuracy_deg');
  assert.ok(gp3Acc < 1.0, `gp3 ${gp3Acc}`);
  const plain = pooled(run(spec('nogate')).rows);
  const gated = pooled(run(spec('gate', {gating: {gp3: {maxDeviationDeg: 0.8}}})).rows);
  assert.ok(meanOf(gated, 'n_used') < meanOf(plain, 'n_used'));
  assert.ok(meanOf(gated, 'n_gp3gated') > 0);
});

test('blink gating removes eyelid-closed frames', () => {
  const on = pooled(run(spec('blinkon')).rows);
  const off = pooled(run(spec('blinkoff', {gating: {blinkEar: 0}})).rows);
  assert.ok(meanOf(on, 'n_blink') > 0);
  assert.equal(meanOf(off, 'n_blink'), 0);
});

test('leave-one-target-out CV runs on calibration targets', () => {
  simulateLandmarks(sim, spec('cv'));
  const {rows} = runCv(session, spec('cv'));
  assert.ok(rows.length >= 4 * 20);
  assert.ok(meanOf(rows, 'accuracy_deg') < 1.5);
});

test('distance from iris size recovers the true block distance when no measurement exists', async () => {
  const {readFileSync, writeFileSync} = await import('node:fs');
  const {join} = await import('node:path');
  const {simulateSession, simulateLandmarks} = await import('../src/engine/simulate.js');
  const {loadSession} = await import('../src/engine/session.js');
  const {runPipeline} = await import('../src/engine/pipeline.js');
  const dir = join(tmp(), 's');
  const sim = simulateSession({dir, protocol, participantId: 'D1', seed: 5, cameras: [{id: 'cam4k', w: 3840, h: 2160, hfovDeg: 78}]});
  const spec = {tag: 'dist', preprocess: {resize: [1280, 720]}, geometry: {distance: 'iris'}};
  simulateLandmarks(sim, spec);
  // drop the manual measurements, as the recorder no longer asks for them
  const ev = readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter(l => l && !l.includes('block_measure'));
  writeFileSync(join(dir, 'events.jsonl'), ev.join('\n') + '\n');
  const session = loadSession(dir);
  const {qc, rows} = runPipeline(session, spec);
  for (const b of session.timeline.blocks.values()) {
    const nominal = sim.blocks.find(x => x.id === b.id).distance_cm;  // true simulated distance
    const est = qc.distance[b.id].cm;
    assert.equal(qc.distance[b.id].source, 'iris');
    assert.ok(Math.abs(est - nominal) / nominal < 0.06, `${b.id}: est ${est} vs ${nominal}`);
  }
  assert.ok(rows.some(r => r.level === 'pooled' && Number.isFinite(r.mean_err_deg)));
  assert.throws(() => runPipeline(session, {...spec, geometry: {distance: 'iris'}, camera: 'nocam'}));
});
