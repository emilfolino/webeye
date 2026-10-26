// Session directory reader.
//   <dir>/manifest.json
//   <dir>/events.jsonl                       stimulus + clock events
//   <dir>/cameras/<cam>/frames.jsonl         {i, t, w, h, file}
//   <dir>/cameras/<cam>/frames/<file>        source frames
//   <dir>/gp3.jsonl                          optional GP3 reference
//   <dir>/landmarks/<cam>/<key>.jsonl        replay cache
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {loadGp3} from './gp3.js';

const readJsonl = p => existsSync(p) ?
    readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];

/**
 * Participant split for hold-out discipline. Deterministic from the pseudonym
 * and a salt that is frozen in the pre-registration, so the assignment cannot
 * be influenced by results.
 */
export function participantSplit(pid, {salt = 'webeye-2028', devFraction = 0.3} = {}) {
  const h = createHash('sha256').update(`${salt}:${pid}`).digest();
  const u = h.readUInt32BE(0) / 4294967296;
  return u < devFraction ? 'dev' : 'confirm';
}

export function loadSession(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const events = readJsonl(join(dir, 'events.jsonl'));
  const cameras = {};
  for (const cam of manifest.cameras || []) {
    // Concurrent frame uploads can be indexed out of order; order by capture time (stable, keeps i).
    const frames = readJsonl(join(dir, 'cameras', cam.id, 'frames.jsonl'));
    let reordered = 0;
    for (let i = 1; i < frames.length; i++) if (frames[i].t < frames[i - 1].t) reordered++;
    if (reordered) frames.sort((a, b) => a.t - b.t);
    cameras[cam.id] = {...cam, dir: join(dir, 'cameras', cam.id), frames, reordered};
  }
  return {
    dir, manifest, events, cameras,
    split: participantSplit(manifest.participant.id),
    timeline: buildTimeline(events),
    gp3: loadGp3(dir, events),
  };
}

/** Group raw events into blocks and stimulus intervals. */
export function buildTimeline(events) {
  const blocks = new Map();
  const targets = [];
  const open = new Map();
  for (const e of events) {
    if (e.type === 'block_start') {
      blocks.set(e.blockId, {
        id: e.blockId, t: e.t, condition: e.condition || {},
        calibrationFrom: e.calibrationFrom || null, distanceCmMeasured: null,
      });
    } else if (e.type === 'block_measure') {
      const b = blocks.get(e.blockId);
      if (b) b.distanceCmMeasured = e.distance_cm;
    } else if (e.type === 'target_on' || e.type === 'pursuit_on') {
      open.set(e.id, e);
    } else if (e.type === 'target_off' || e.type === 'pursuit_off') {
      const on = open.get(e.id);
      if (!on) continue;
      open.delete(e.id);
      targets.push({...on, tOn: on.t, tOff: e.t, kind: on.type === 'pursuit_on' ? 'pursuit' : on.kind});
    }
  }
  return {blocks, targets};
}
