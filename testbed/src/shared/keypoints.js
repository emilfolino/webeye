// Subset of the 478 face-mesh keypoints that the offline pipeline stores.
// Storing a subset keeps landmark caches small (about 60 x 3 floats per frame).
// Naming follows face-landmarks-detection constants.ts: rightEye = subject's
// right eye (image left when unmirrored): iris 468-472, corners 33 / 133.
// leftEye = iris 473-477, corners 263 / 362.
// NOTE: CLAUDE.md describes 468-472 as the *left* iris; the library source
// (src/constants.ts RIGHT_IRIS_CONNECTIONS = 469..472) says right.
export const KP = {
  rightIris: [468, 469, 470, 471, 472],  // centre, then 4 cardinal points
  leftIris: [473, 474, 475, 476, 477],
  rightEye: {outer: 33, inner: 133, top: 159, bottom: 145,
             top2: 158, bottom2: 153, top3: 160, bottom3: 144},
  leftEye: {outer: 263, inner: 362, top: 386, bottom: 374,
            top2: 385, bottom2: 380, top3: 387, bottom3: 373},
  noseTip: 1, noseBridge: 168, forehead: 10, chin: 152,
  rightCheek: 234, leftCheek: 454, mouthRight: 61, mouthLeft: 291,
};

const eyeIdx = e => Object.values(e);
export const KEYPOINT_SUBSET = Array.from(new Set([
  ...KP.rightIris, ...KP.leftIris, ...eyeIdx(KP.rightEye), ...eyeIdx(KP.leftEye),
  KP.noseTip, KP.noseBridge, KP.forehead, KP.chin, KP.rightCheek, KP.leftCheek,
  KP.mouthRight, KP.mouthLeft,
])).sort((a, b) => a - b);

/** Map from mesh index -> position in the stored subset array. */
export const SUBSET_POS = Object.fromEntries(
    KEYPOINT_SUBSET.map((idx, i) => [idx, i]));
