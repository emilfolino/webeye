import test from 'node:test';
import assert from 'node:assert/strict';
import {headCueState, HEAD_DIRS} from '../src/web/head_cue.js';

test('head cue timeline: wait, four directions of out/hold/back, then done', () => {
  assert.deepEqual(headCueState(-1), {dir: null, phase: 'wait', amount: 0});
  const seg = 3000;
  HEAD_DIRS.forEach((dir, i) => {
    const t0 = i * seg;
    assert.equal(headCueState(t0, {segmentMs: seg}).dir, dir);
    assert.equal(headCueState(t0, {segmentMs: seg}).amount, 0);            // starts centred
    assert.equal(headCueState(t0 + 1500, {segmentMs: seg}).phase, 'hold');
    assert.equal(headCueState(t0 + 1500, {segmentMs: seg}).amount, 1);     // fully turned
    assert.ok(headCueState(t0 + 2999, {segmentMs: seg}).amount < 0.01);    // back to centre
  });
  assert.equal(headCueState(4 * seg, {segmentMs: seg}).phase, 'done');
  assert.equal(headCueState(4 * seg + 1500, {segmentMs: seg, loop: true}).dir, 'left');  // demo loops
});
