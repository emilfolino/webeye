// Landmark cache: JSONL per (session, camera, landmarkKey).
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {landmarkKey, normaliseSpec} from './spec.js';

export function landmarkPath(sessionDir, spec) {
  const s = normaliseSpec(spec);
  return join(sessionDir, 'landmarks', s.camera, `${landmarkKey(s)}.jsonl`);
}

export function hasLandmarks(sessionDir, spec) {
  return existsSync(landmarkPath(sessionDir, spec));
}

/** Returns {header, records: Map<frameIndex, rec>} where rec has w, h attached. */
export function readLandmarks(sessionDir, spec) {
  const lines = readFileSync(landmarkPath(sessionDir, spec), 'utf8').split('\n').filter(Boolean);
  const header = JSON.parse(lines[0]);
  if (!header.header) throw new Error('Landmark file missing header');
  const records = [];
  for (const l of lines.slice(1)) {
    const r = JSON.parse(l);
    r.w = header.w;
    r.h = header.h;
    records.push(r);
  }
  records.sort((a, b) => a.t - b.t);
  return {header, records};
}

export function writeLandmarks(sessionDir, spec, header, records) {
  const p = landmarkPath(sessionDir, spec);
  mkdirSync(dirname(p), {recursive: true});
  const lines = [JSON.stringify({header: true, ...header}),
    ...records.map(r => JSON.stringify(r))];
  writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

/** Which source frames a preprocess spec selects (frame-rate reduction). */
export function selectFrames(frames, fps) {
  if (!fps) return frames;
  const period = 1000 / fps;
  const out = [];
  let next = frames.length ? frames[0].t : 0;
  for (const f of frames) {
    if (f.t + period / 4 >= next) {
      out.push(f);
      next += period;
      while (next <= f.t - period / 2) next += period;
    }
  }
  return out;
}
