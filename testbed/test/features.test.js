import test from 'node:test';
import assert from 'node:assert/strict';
import {KEYPOINT_SUBSET, SUBSET_POS, KP} from '../src/shared/keypoints.js';
import {computeFeatures} from '../src/engine/features.js';

// Synthetic record: both eyes 40 px wide, lids 10 px apart, iris at `irisY`.
function rec(irisY) {
  const kp = KEYPOINT_SUBSET.map(() => [0, 0, 0]);
  const set = (idx, x, y) => { kp[SUBSET_POS[idx]] = [x, y, 0]; };
  for (const [eye, iris, cx] of [[KP.rightEye, KP.rightIris, 100], [KP.leftEye, KP.leftIris, 200]]) {
    set(eye.outer, cx - 20, 100); set(eye.inner, cx + 20, 100);
    set(eye.top, cx, 95); set(eye.bottom, cx, 105);
    iris.forEach((i, k) => set(i, cx, irisY));
  }
  for (const i of [KP.noseTip, KP.noseBridge, KP.forehead, KP.chin, KP.rightCheek, KP.leftCheek]) set(i, 150, 150);
  return {ok: true, w: 640, h: 480, kp};
}

test('lid features: iris position between the lids and eyelid opening', () => {
  const base = computeFeatures(rec(100), {type: 'iris-eye-mean'});
  const withLid = computeFeatures(rec(100), {type: 'iris-eye-mean', lid: true});
  assert.equal(withLid.length, base.length + 2);
  assert.ok(Math.abs(withLid[base.length] - 0.5) < 1e-9);       // centred between the lids
  assert.ok(Math.abs(withLid[base.length + 1] - 0.25) < 1e-9);  // 10 px opening / 40 px width
  const up = computeFeatures(rec(97), {type: 'iris-eye-mean', lid: true});
  const down = computeFeatures(rec(103), {type: 'iris-eye-mean', lid: true});
  assert.ok(up[base.length] < 0.5 && down[base.length] > 0.5);
});
