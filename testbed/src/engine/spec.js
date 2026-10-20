// Pipeline spec: defaults, normalisation, hashing and cache keys.
import {createHash} from 'node:crypto';

export const SPEC_DEFAULTS = {
  tag: null,
  description: '',
  camera: 'cam4k',
  preprocess: {
    resize: null,          // null (native) | [w, h] | {scale: 0.5}
    resampler: 'lanczos',  // ffmpeg scale flag: lanczos | bicubic | area | bilinear
    fps: null,             // null = all frames
    degrade: {noiseSigma: 0, blurSigma: 0, jpegQuality: null},
  },
  model: {
    runtime: 'mediapipe',  // mediapipe | tfjs | gp3 (reference, no camera)
    refineLandmarks: true,
    staticImageMode: false,
    maxFaces: 1,
    lib: 'cdn',            // which build of the library the worker loads
  },
  features: {type: 'iris-eye-mean', headPose: false, useZ: false},
  mapping: {type: 'poly', degree: 2, lambda: 1e-3},
  filter: {type: 'none'},
  calibration: {subset: '25', aggregate: 'samples'},
  gating: {blinkEar: 0.12, gp3: null},
  window: {settleMs: null, collectMs: null},
  evaluation: 'heldout',   // heldout | cv (leave-one-target-out on calibration)
  frozen: false,
};

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

function merge(base, over) {
  const out = {...base};
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isObj(v) && isObj(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

export function normaliseSpec(spec) {
  const s = merge(SPEC_DEFAULTS, spec);
  if (!s.tag) throw new Error('Every pipeline spec needs a "tag" (see CLAUDE.md)');
  return s;
}

export function canonical(obj) {
  if (Array.isArray(obj)) return '[' + obj.map(canonical).join(',') + ']';
  if (isObj(obj)) {
    return '{' + Object.keys(obj).sort()
        .map(k => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
  }
  return JSON.stringify(obj);
}

export const sha = (s, n = 12) =>
  createHash('sha256').update(s).digest('hex').slice(0, n);

/** Hash of everything that can change results (excluding tag/description). */
export function specHash(spec) {
  const {tag, description, frozen, ...rest} = normaliseSpec(spec);
  return sha(canonical(rest));
}

/** Cache key of the expensive stage (preprocess + landmark model). */
export function landmarkKey(spec) {
  const s = normaliseSpec(spec);
  return sha(canonical({camera: s.camera, preprocess: s.preprocess, model: s.model}));
}

/** Key of the preprocessed frame set only (model-independent). */
export function preprocessKey(spec) {
  const s = normaliseSpec(spec);
  return sha(canonical({camera: s.camera, preprocess: s.preprocess}));
}
