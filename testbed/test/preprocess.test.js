import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync, existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {ensurePreprocessed, filterChain, targetSize} from '../src/engine/preprocess.js';
import {tmp} from './helpers.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('filterChain / targetSize', () => {
  assert.deepEqual(targetSize({resize: {scale: 0.5}}, 1920, 1080), [960, 540]);
  assert.equal(filterChain({resize: null, degrade: {}}, 640, 480).chain, 'null');
  const c = filterChain({resize: [320, 240], resampler: 'area', degrade: {blurSigma: 1, noiseSigma: 5}}, 640, 480).chain;
  assert.match(c, /scale=320:240:flags=area,gblur=sigma=1,noise=alls=5/);
});

test('ensurePreprocessed resizes, drops frames, caches', {skip: !hasFfmpeg}, async () => {
  const dir = tmp();
  const camDir = join(dir, 'cameras', 'cam4k');
  mkdirSync(join(camDir, 'frames'), {recursive: true});
  const frames = [];
  for (let i = 0; i < 30; i++) {
    const file = `${String(i + 1).padStart(6, '0')}.jpg`;
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=1', '-frames:v', '1', join(camDir, 'frames', file)]);
    frames.push({i, t: 1000 + i * 33.3, w: 640, h: 360, file});
  }
  writeFileSync(join(camDir, 'frames.jsonl'), frames.map(f => JSON.stringify(f)).join('\n'));
  const session = {manifest: {sessionId: 'x'}, cameras: {cam4k: {dir: camDir, frames}}};
  const out = await ensurePreprocessed(session, {tag: 't', preprocess: {resize: [320, 180], fps: 15}}, join(dir, 'cache'));
  assert.deepEqual(out.size, [320, 180]);
  assert.ok(out.frames.length >= 14 && out.frames.length <= 16);
  assert.ok(existsSync(join(out.dir, out.frames[0].file)));
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(out.dir, out.frames[0].file)]).toString().trim();
  assert.equal(probe, '320,180');
  const again = await ensurePreprocessed(session, {tag: 't2', preprocess: {resize: [320, 180], fps: 15}}, join(dir, 'cache'));
  assert.equal(again.frames.length, out.frames.length);  // served from cache
  const identity = await ensurePreprocessed(session, {tag: 'i'}, join(dir, 'cache'));
  assert.equal(identity.identity, true);
  // determinism of noise degradation
  const d1 = await ensurePreprocessed(session, {tag: 'n', preprocess: {resize: [320, 180], degrade: {noiseSigma: 8}}}, join(dir, 'c1'));
  const d2 = await ensurePreprocessed(session, {tag: 'n', preprocess: {resize: [320, 180], degrade: {noiseSigma: 8}}}, join(dir, 'c2'));
  assert.ok(readFileSync(join(d1.dir, d1.frames[3].file)).equals(readFileSync(join(d2.dir, d2.frames[3].file))));
});
