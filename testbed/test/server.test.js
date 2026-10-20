import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {execFileSync, spawnSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {createStudyServer} from '../src/server/server.js';
import {landmarkKey} from '../src/engine/spec.js';
import {tmp} from './helpers.js';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const web = new URL('../src/web', import.meta.url).pathname;
const shared = new URL('../src/shared', import.meta.url).pathname;

test('recorder upload flow + landmark job flow + path safety + GP3 capture', {skip: !hasFfmpeg}, async () => {
  const data = tmp();
  // fake GP3
  const gp3 = net.createServer(sock => {
    const t = setInterval(() => sock.write(`<REC TIME="${(performance.now() / 1000).toFixed(4)}" BPOGX="0.5" BPOGY="0.5" BPOGV="1" />\r\n`), 16);
    sock.on('close', () => clearInterval(t));
    sock.on('error', () => {});
  });
  await new Promise(r => gp3.listen(0, '127.0.0.1', r));
  let s;
  try {
  s = createStudyServer({dataDir: data, webRoot: web, sharedRoot: shared, gp3: {host: '127.0.0.1', port: gp3.address().port}});
  const port = await s.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const post = (path, body) => fetch(base + path, {method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body)});

  const clock = await (await fetch(base + '/api/clock')).json();
  assert.ok(clock.t >= 0);

  const manifest = {sessionId: 'P1-test', participant: {id: 'P1', index: 0}, screen: {widthPx: 100, heightPx: 100, widthMm: 100, heightMm: 100},
    cameras: [{id: 'cam4k'}]};
  assert.equal((await post('/api/sessions', manifest)).status, 200);
  assert.equal((await post('/api/sessions', manifest)).status, 409);
  assert.equal((await post('/api/sessions', {...manifest, sessionId: '../evil'})).status, 400);

  // frames
  const jpg = join(data, 'f.jpg');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=1', '-frames:v', '1', jpg]);
  const jpgBytes = readFileSync(jpg);
  const idx = [];
  for (let i = 0; i < 4; i++) {
    const file = `${String(i + 1).padStart(6, '0')}.jpg`;
    const r = await fetch(`${base}/api/sessions/P1-test/cameras/cam4k/frames/${file}`, {method: 'PUT', body: jpgBytes});
    assert.equal(r.status, 200);
    idx.push(JSON.stringify({i, t: 100 + i * 33, w: 320, h: 180, file}));
  }
  assert.equal((await fetch(`${base}/api/sessions/P1-test/cameras/cam4k/frames/..%2Fx.jpg`, {method: 'PUT', body: 'x'})).status, 404);
  await post('/api/sessions/P1-test/cameras/cam4k/index', idx.join('\n') + '\n');
  await post('/api/sessions/P1-test/events', JSON.stringify({type: 'session_start', t: 1}) + '\n');
  await post('/api/sessions/P1-test/gp3', {action: 'start'});
  await new Promise(r => setTimeout(r, 200));
  const st = await (await fetch(base + '/api/gp3/status')).json();
  assert.ok(st.connected && st.samples > 3);
  await post('/api/sessions/P1-test/complete', {frameDrops: 0});
  const dir = join(data, 'P1-test');
  assert.equal(readFileSync(join(dir, 'cameras/cam4k/frames.jsonl'), 'utf8').trim().split('\n').length, 4);
  assert.ok(readFileSync(join(dir, 'gp3.jsonl'), 'utf8').trim().split('\n').length > 3);
  assert.equal(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).frameDrops, 0);

  // job queue
  mkdirSync(join(data, '_jobs'), {recursive: true});
  const spec = {tag: 'j', camera: 'cam4k', preprocess: {resize: [160, 90]}, model: {runtime: 'mediapipe'}};
  const {normaliseSpec, preprocessKey} = await import('../src/engine/spec.js');
  const ns = normaliseSpec(spec);
  const job = {id: 'P1-test--k', sessionDir: dir, sessionId: 'P1-test', camera: 'cam4k', landmarkKey: landmarkKey(ns),
    preprocessKey: preprocessKey(ns), preprocess: ns.preprocess, model: ns.model};
  writeFileSync(join(data, '_jobs', 'P1-test--k.json'), JSON.stringify(job));
  const next = await (await post('/api/jobs/next', {})).json();
  assert.equal(next.job.frames.length, 4);
  assert.deepEqual(next.job.size, [160, 90]);
  const img = await fetch(base + next.job.frames[0].url);
  assert.equal(img.status, 200);
  assert.equal((await (await post('/api/jobs/next', {})).json()).job, null);
  const result = JSON.stringify({header: true, camera: 'cam4k', w: 160, h: 90}) + '\n' + JSON.stringify({i: 0, t: 100, ok: false}) + '\n';
  assert.equal((await post('/api/jobs/P1-test--k/result', result)).status, 200);
  assert.ok(existsSync(join(dir, 'landmarks/cam4k', `${job.landmarkKey}.jsonl`)));

  // path traversal / unknown
  assert.equal((await fetch(base + '/shared/..%2Fengine%2Fspec.js')).status, 403);
  assert.equal((await fetch(base + '/web/nope.js')).status, 404);
  assert.equal((await fetch(base + '/shared/mapping.js')).status, 200);

  } finally {
    await s?.close();
    gp3.close();
  }
});
