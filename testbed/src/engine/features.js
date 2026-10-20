// Landmarks -> feature vectors. A landmark record stores a subset of the mesh
// (see shared/keypoints.js) in image pixels together with image size.
import {KP, SUBSET_POS} from '../shared/keypoints.js';

const pt = (rec, idx) => rec.kp[SUBSET_POS[idx]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function eyeFeatures(rec, iris, eye) {
  const c = pt(rec, iris[0]);
  const outer = pt(rec, eye.outer), inner = pt(rec, eye.inner);
  const top = pt(rec, eye.top), bottom = pt(rec, eye.bottom);
  const width = dist(outer, inner) || 1;
  const mid = [(outer[0] + inner[0]) / 2, (outer[1] + inner[1]) / 2];
  // Offset along the eye axis (corner-to-corner) and perpendicular to it,
  // which removes head roll from the feature.
  const ax = (inner[0] - outer[0]) / width, ay = (inner[1] - outer[1]) / width;
  const dx = c[0] - mid[0], dy = c[1] - ((top[1] + bottom[1]) / 2);
  // v is measured perpendicular to the eye axis with a fixed orientation
  // (image-down), so both eyes agree regardless of which corner is "outer".
  const sgn = ax < 0 ? -1 : 1;
  const vx = sgn * ax, vy = sgn * ay;
  return {
    u: (dx * ax + (c[1] - mid[1]) * ay) / width,
    v: (-dx * vy + dy * vx) / width,
    z: (c[2] - (outer[2] + inner[2]) / 2) / width,
    ear: dist(top, bottom) / width,
    irisDiameterPx: (dist(pt(rec, iris[1]), pt(rec, iris[3])) +
                     dist(pt(rec, iris[2]), pt(rec, iris[4]))) / 2,
  };
}

/** Eye aspect ratio (mean of both eyes) for blink gating. */
export function eyeAspectRatio(rec) {
  return (eyeFeatures(rec, KP.rightIris, KP.rightEye).ear +
          eyeFeatures(rec, KP.leftIris, KP.leftEye).ear) / 2;
}

/** Mean iris diameter in image pixels. */
export function irisDiameterPx(rec) {
  return (eyeFeatures(rec, KP.rightIris, KP.rightEye).irisDiameterPx +
          eyeFeatures(rec, KP.leftIris, KP.leftEye).irisDiameterPx) / 2;
}

/** Cheap head-pose proxies from 2D landmarks (scale-free where possible). */
function headPose(rec) {
  const rc = pt(rec, KP.rightIris[0]), lc = pt(rec, KP.leftIris[0]);
  const rCheek = pt(rec, KP.rightCheek), lCheek = pt(rec, KP.leftCheek);
  const nose = pt(rec, KP.noseTip);
  const forehead = pt(rec, KP.forehead), chin = pt(rec, KP.chin);
  const iod = dist(rc, lc) || 1;
  const faceW = dist(rCheek, lCheek) || 1;
  const faceH = dist(forehead, chin) || 1;
  const midEye = [(rc[0] + lc[0]) / 2, (rc[1] + lc[1]) / 2];
  const midCheek = [(rCheek[0] + lCheek[0]) / 2, (rCheek[1] + lCheek[1]) / 2];
  return {
    roll: Math.atan2(lc[1] - rc[1], lc[0] - rc[0]),
    yaw: (nose[0] - midCheek[0]) / faceW,
    pitch: (nose[1] - midEye[1]) / faceH,
    scale: iod / rec.w,
    cx: midEye[0] / rec.w,
    cy: midEye[1] / rec.h,
  };
}

/**
 * Build the feature vector for one landmark record.
 * @param spec features spec: {type: 'iris-mean'|'iris-eye-mean'|'iris-eye',
 *   headPose?: bool, useZ?: bool}
 * @returns number[] or null when the face is unusable
 */
export function computeFeatures(rec, spec) {
  if (!rec || !rec.ok) return null;
  const f = [];
  if (spec.type === 'iris-mean') {
    // Original harness: mean iris position in image, mirrored horizontally.
    const a = pt(rec, KP.rightIris[0]), b = pt(rec, KP.leftIris[0]);
    f.push(1 - (a[0] + b[0]) / 2 / rec.w, (a[1] + b[1]) / 2 / rec.h);
  } else {
    const r = eyeFeatures(rec, KP.rightIris, KP.rightEye);
    const l = eyeFeatures(rec, KP.leftIris, KP.leftEye);
    // Eye axis points outer->inner; flip one eye so +u means the same
    // physical direction for both (towards the subject's left).
    const rU = r.u, lU = -l.u;
    if (spec.type === 'iris-eye-mean') {
      f.push((rU + lU) / 2, (r.v + l.v) / 2);
      if (spec.useZ) f.push((r.z + l.z) / 2);
    } else if (spec.type === 'iris-eye') {
      f.push(rU, r.v, lU, l.v);
      if (spec.useZ) f.push(r.z, l.z);
    } else {
      throw new Error(`Unknown feature type "${spec.type}"`);
    }
  }
  if (spec.headPose) {
    const h = headPose(rec);
    f.push(h.roll, h.yaw, h.pitch, h.scale, h.cx, h.cy);
  }
  return f.every(Number.isFinite) ? f : null;
}
