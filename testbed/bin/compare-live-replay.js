#!/usr/bin/env node
// Fidelity pilot: do landmarks from replayed (stored) frames match the ones the
// model produced live on the camera stream? Run the recorder with "run the
// model live", queue the replay with an identity-preprocess spec, then:
//   node bin/compare-live-replay.js --session <dir> --spec <spec.json>
// Reports the distribution of iris-centre/eye-corner differences (px) and
// detection agreement. Large differences mean the replay feed is not
// representative of live use (see docs/PILOT_CHECKLIST.md).
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {readLandmarks} from '../src/engine/landmarks.js';
import {normaliseSpec} from '../src/engine/spec.js';
import {KP, SUBSET_POS} from '../src/shared/keypoints.js';
import {quantile} from '../src/engine/stats.js';

const {values: a} = parseArgs({options: {session: {type: 'string'}, spec: {type: 'string'}, maxdt: {type: 'string', default: '20'}}});
if (!a.session || !a.spec) { console.error('usage: compare-live-replay.js --session <dir> --spec <spec.json>'); process.exit(1); }
const spec = normaliseSpec(JSON.parse(readFileSync(a.spec, 'utf8')));
const livePath = join(a.session, 'live', `${spec.camera}.jsonl`);
if (!existsSync(livePath)) { console.error(`no live landmarks at ${livePath}`); process.exit(1); }
const live = readFileSync(livePath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const {header, records} = readLandmarks(a.session, spec);
const maxdt = Number(a.maxdt);

const pts = {irisR: KP.rightIris[0], irisL: KP.leftIris[0], cornerR: KP.rightEye.outer, cornerL: KP.leftEye.outer, nose: KP.noseTip};
const diffs = Object.fromEntries(Object.keys(pts).map(k => [k, []]));
let matched = 0, bothOk = 0, liveOnly = 0, replayOnly = 0, j = 0;
for (const l of live) {
  while (j + 1 < records.length && Math.abs(records[j + 1].t - l.t) <= Math.abs(records[j].t - l.t)) j++;
  const r = records[j];
  if (!r || Math.abs(r.t - l.t) > maxdt) continue;
  matched++;
  if (l.ok && r.ok) {
    bothOk++;
    for (const [k, idx] of Object.entries(pts)) {
      const p = l.kp[SUBSET_POS[idx]], q = r.kp[SUBSET_POS[idx]];
      diffs[k].push(Math.hypot(p[0] - q[0], p[1] - q[1]));
    }
  } else if (l.ok) liveOnly++; else if (r.ok) replayOnly++;
}
const out = {session: a.session, camera: spec.camera, replaySize: [header.w, header.h], liveFrames: live.length, matched, bothOk, liveOnly, replayOnly,
  diffPx: Object.fromEntries(Object.entries(diffs).map(([k, v]) => [k, v.length ? {median: +quantile(v, 0.5).toFixed(3), p95: +quantile(v, 0.95).toFixed(3), max: +Math.max(...v).toFixed(3)} : null]))};
console.log(JSON.stringify(out, null, 1));
