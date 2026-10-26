// Per-block viewing distance. A browser study cannot rely on the participant
// staying where a tape measure said, so the distance is estimated from the
// apparent iris size in the recorded frames:
//   d = focalPx * 11.7 mm / irisPx,  focalPx from the camera's horizontal FOV.
// The nominal FOV is only approximate (webcams crop in some modes), so an
// optional manifest.startDistanceCm (tape measure, once) rescales all
// estimates in the session; relative changes between blocks stay accurate.
import {distanceFromIris} from '../shared/geometry.js';
import {median} from './stats.js';

const MIN_FRAMES = 30;

/**
 * @param frames pipeline frames {t, ok, irisPx}
 * @param mode 'auto' (measured > iris > nominal) | 'measured' | 'iris'
 * Returns {mm(blockId), source(blockId), irisCm: {blockId: cm|null}}.
 */
export function makeDistanceResolver(session, spec, frames, meta, reference) {
  const mode = spec.geometry?.distance ?? 'auto';
  const blocks = [...session.timeline.blocks.values()].sort((a, b) => a.t - b.t);
  const hfov = session.cameras[spec.camera]?.hfovDeg;
  const raw = new Map();
  if (!reference && hfov && meta?.w) {
    blocks.forEach((b, i) => {
      const end = blocks[i + 1]?.t ?? Infinity;
      const px = frames.filter(f => f.ok && f.t >= b.t && f.t < end && Number.isFinite(f.irisPx)).map(f => f.irisPx);
      if (px.length >= MIN_FRAMES) raw.set(b.id, distanceFromIris(median(px), meta.w, hfov));
    });
  }
  const start = session.manifest.startDistanceCm;
  const first = raw.get(blocks[0]?.id);
  const k = start && first ? (start * 10) / first : 1;
  const iris = id => (raw.has(id) ? raw.get(id) * k : null);
  const measured = id => {
    const b = session.timeline.blocks.get(id);
    return b?.distanceCmMeasured != null ? b.distanceCmMeasured * 10 : null;
  };
  const nominal = id => {
    const cm = session.timeline.blocks.get(id)?.condition?.distance_cm ?? session.manifest.viewingDistanceCm;
    return cm ? cm * 10 : null;
  };
  const pick = id => {
    const order = mode === 'iris' ? [['iris', iris]] :
      mode === 'measured' ? [['measured', measured], ['nominal', nominal]] :
      [['measured', measured], ['iris', iris], ['nominal', nominal]];
    for (const [source, fn] of order) {
      const v = fn(id);
      if (v) return {mm: v, source};
    }
    throw new Error(`No viewing distance for block ${id} (mode ${mode}; need a measurement, a camera hfovDeg with face frames, or a nominal distance)`);
  };
  return {
    mm: id => pick(id).mm,
    source: id => pick(id).source,
    irisCm: Object.fromEntries(blocks.map(b => [b.id, iris(b.id) != null ? iris(b.id) / 10 : null])),
  };
}
