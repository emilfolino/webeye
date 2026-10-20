// Loads the face-landmarks-detection library (UMD builds from a CDN, versions
// pinned) and exposes one detector with a uniform output: the stored keypoint
// subset, in pixel coordinates of the image that was passed in (unmirrored).
// Pinned versions are recorded in every landmark-file header, so a replay is
// reproducible. To run offline, vendor these files and change LIBS.
import {KEYPOINT_SUBSET} from '/shared/keypoints.js';

export const LIBS = {
  id: 'fld-1.0.5',
  scripts: [
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core@4.20.0/dist/tf-core.min.js',
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-converter@4.20.0/dist/tf-converter.min.js',
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl@4.20.0/dist/tf-backend-webgl.min.js',
    'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619/face_mesh.js',
    'https://cdn.jsdelivr.net/npm/@tensorflow-models/face-landmarks-detection@1.0.5/dist/face-landmarks-detection.min.js',
  ],
  solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4.1633559619',
};

let loading = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = res;
    el.onerror = () => rej(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
}
export function loadLibs() {
  loading ??= (async () => { for (const s of LIBS.scripts) await loadScript(s); })();
  return loading;
}

/**
 * @param model {runtime:'mediapipe'|'tfjs', refineLandmarks, staticImageMode, maxFaces}
 * Returns {estimate(image) -> {ok, kp, ms}, dispose(), info}
 */
export async function createAdapter(model) {
  await loadLibs();
  const fld = window.faceLandmarksDetection;
  const base = {runtime: model.runtime, refineLandmarks: model.refineLandmarks !== false, maxFaces: model.maxFaces || 1};
  const cfg = model.runtime === 'mediapipe' ? {...base, solutionPath: LIBS.solutionPath} : base;
  const detector = await fld.createDetector(fld.SupportedModels.MediaPipeFaceMesh, cfg);
  const estCfg = {flipHorizontal: false, staticImageMode: !!model.staticImageMode};
  return {
    info: {lib: LIBS.id, runtime: model.runtime, userAgent: navigator.userAgent},
    async estimate(image) {
      const t0 = performance.now();
      const faces = await detector.estimateFaces(image, estCfg);
      const ms = performance.now() - t0;
      if (!faces.length || faces[0].keypoints.length < 478) return {ok: false, ms};
      const k = faces[0].keypoints;
      const kp = KEYPOINT_SUBSET.map(i => [Math.round(k[i].x * 1000) / 1000, Math.round(k[i].y * 1000) / 1000, Math.round((k[i].z || 0) * 1000) / 1000]);
      return {ok: true, kp, ms};
    },
    dispose() { detector.dispose?.(); },
  };
}
