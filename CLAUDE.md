# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

Explore whether higher-definition webcam input and more granular face mesh output can improve webcam-based eye tracking. The `face-landmarks-detection/` directory contains Google's TensorFlow.js face landmark model and demos as a reference and starting point.

## Experiment Tracking

Tag every try/iteration you run so results stay traceable across changes. For each tagged try, record the accuracy and precision measurements so improvements can be compared over time.

## Accuracy & Precision Measurement Harness

The live_video demo has a built-in test harness for measuring eye tracking quality. It lives in `demos/live_video/src/gaze_test.js` and is wired into the rAF loop in `index.js`.

### How to run a test

1. Type a run label in the text field (e.g. `640x480-base`) — this goes into the CSV filename and header.
2. Click **Start Eye Tracking Test**.
3. Follow the red dots: 9 calibration targets (3×3 grid, 2s each) then 5 validation targets (cross pattern, 2s each). First 500ms per dot is a settling window; data is collected in the remaining 1500ms.
4. Results appear as a canvas overlay and in the HTML panel below the button.
5. Click **Download CSV** to export all raw samples.

### Metrics

| Metric | Definition |
|--------|------------|
| **Mean accuracy** | Mean Euclidean distance from predicted gaze to target center, across 5 validation targets |
| **P95 accuracy** | 95th-percentile per-sample error pooled across all validation samples |
| **Precision** | RMS spread of predicted gaze samples around their centroid, per target, then averaged |

All metrics are reported in **pixels** and **degrees of visual angle**. Degree conversion uses the iris diameter as a natural ruler: iris ≈ 11.7 mm, subtending ≈ 1.12° at 60 cm → `pixelsPerDegree = irisPixelDiameter / 1.12`, averaged across the whole session.

### Gaze mapping

A second-order polynomial maps mean iris position → screen position:

```
screenX = a · [1, iX, iY, iX·iY, iX², iY²]
screenY = b · [1, iX, iY, iX·iY, iX², iY²]
```

Fitted via normal equations `(AᵀA)x = Aᵀb` (6×6 Gaussian elimination). Mirror correction is applied before fitting: `iXscreen = canvasWidth − mean(leftIris.x, rightIris.x)`.

### CSV format

```
# run: <label>
timestamp,leftIrisX,leftIrisY,rightIrisX,rightIrisY,iXscreen,iYscreen,targetX,targetY,phase
```

`phase` is `calibrating` or `validating`. Calibration rows come first (9 × ~45–90 samples), then validation rows (5 × ~45–90 samples).

### Expected baseline numbers

At 60 cm, 640×480, mediapipe-gpu backend, cooperative user:
- Mean accuracy: 1–4° (25–100 px)
- P95 accuracy: 3–7°
- Precision: 0.3–1°

Accuracy significantly worse than 5° suggests a mirror-correction or mapping failure.

### Key constants (`src/shared/params.js` → `TEST_CONFIG`)

`SETTLE_MS` (500), `COLLECT_MS` (1500), `GRID_MARGIN` (0.10), `VALIDATION_MARGIN` (0.15), `IRIS_SUBTEND_DEG` (1.12).

## Running the Demo

```bash
cd face-landmarks-detection/demos/live_video
rm -rf .cache dist node_modules   # clean first
yarn build-dep
yarn
yarn watch
# opens at http://localhost:1234/?model=mediapipe_face_mesh
```

The `upload_video` demo works the same way from its own folder.

## Building and Testing the Library

```bash
cd face-landmarks-detection
yarn              # install deps
yarn build        # tsc + rollup → dist/
yarn lint         # tslint
yarn test         # karma (browser)
yarn test-node    # ts-node (headless)
```

Run a single test file: add `--grep="test name"` to the karma invocation, or target a specific `_test.ts` via `run_tests.ts`.

## Architecture

### Library (`src/`)

`createDetector(model, config)` is the single entry point. It returns a `FaceLandmarksDetector` with one method: `estimateFaces(image, estimationConfig) → Face[]`.

Two runtimes share the same public API:

| Runtime | Backend string | Implementation |
|---------|---------------|----------------|
| `mediapipe` | `mediapipe-gpu` | Wraps MediaPipe JS WASM solution |
| `tfjs` | `tfjs-webgl` / `tfjs-wasm` | Pure TF.js graph model |

Each runtime lives in its own folder (`src/mediapipe/`, `src/tfjs/`) with a `detector.ts`, `types.ts`, `constants.ts`, and `detector_utils.ts`.

**Keypoints:** The base model outputs **468** face mesh keypoints. Enabling `refineLandmarks: true` adds **10 iris keypoints** (indices 468–472 = **right** iris (image-left when unmirrored; corners 33/133) center + 4 cardinal points; 473–477 = **left** iris (corners 263/362), per `src/constants.ts`). The `x/y` values are pixel-space; `z` is depth relative to head center (negative = closer to camera), roughly same scale as `x`.

Named contour groups (lips, leftEye, leftEyebrow, leftIris, rightEye, rightEyebrow, rightIris, faceOval) are defined in `src/constants.ts` and exposed via `util.getKeypointIndexByContour()`.

### Demo (`demos/live_video/`)

- `src/index.js` — app loop: `setupDatGui` → `Camera.setupCamera` → `createDetector` → `requestAnimationFrame` loop calling `detector.estimateFaces` then `camera.drawResults`
- `src/camera.js` — `Camera` class: wraps `getUserMedia`, writes to `<canvas>`; mirrors image with `ctx.scale(-1, 1)`
- `src/shared/params.js` — `STATE`, `VIDEO_SIZE` (current options: 640×480, 640×360, 360×270), `MEDIAPIPE_FACE_CONFIG`, backend/flag maps
- `src/shared/util.js` — `drawResults`: renders triangulated mesh, named contours, and iris ellipses
- `src/shared/triangulation.js` — flat array of triangle indices for the 468-point mesh

## Key Constants and Limits to Know

- `VIDEO_SIZE` in `params.js` caps the camera at **640×480** — extending this is one of the first things to change for HD input.
- Camera setup in `camera.js` passes `width/height` as ideal constraints; actual resolution depends on the hardware and browser granting it.
- Mobile devices are hard-capped at `360×270` by `isMobile()` in `util.js`.
- `refineLandmarks: true` must be set to get iris keypoints; the mediapipe runtime calls this `refineLandmarks`, the tfjs runtime calls it `withAttention` internally.
- `staticImageMode: false` (default for video) means the model tracks after the first detection frame instead of re-detecting every frame — lower latency but can lose lock. NOTE: the `mediapipe` runtime ignores `staticImageMode` (see `src/mediapipe/detector.ts`); only the `tfjs` runtime honours it, so replay-from-stored-frames must be checked against live tracking (`testbed/bin/compare-live-replay.js`).

## Testbed (`testbed/`)

Record-once / replay-many testbed for the CHI study; design in `PLAN.md`, usage in `testbed/README.md` and `testbed/docs/`. Zero-dependency Node (>= 20) + ffmpeg; Python only for `testbed/analysis/`.

- Run tests: `cd testbed && npm test` (Node) and `python3 -m pytest -q analysis` (needs pandas, statsmodels, matplotlib, pytest).
- `node bin/serve.js` starts the local recorder/worker server; `bin/replay.js` runs pipeline specs (`pipelines/*.json`) over recorded sessions; `bin/simulate.js` makes synthetic sessions with known ground truth (machinery validation only, not evidence about real webcams).
- Every spec has a `tag`; every replay appends accuracy/precision per tag to `testbed/experiments/registry.csv`. Landmarks are cached per (session, camera, preprocess, model), so only model/preprocess changes need the browser worker.
- Hold-out: `dev`/`confirm` split by salted hash of the participant pseudonym; `replay.js` refuses `confirm` data unless every spec is `"frozen": true`. Never tune on `confirm`.
- `testbed/data/` holds participant face video (biometric): gitignored, never commit or upload it.
- Untested against real hardware: GP3 bridge (fake TCP server only), real 4K/low-res cameras, native ffmpeg capture. Browser recorder and worker were exercised only with chromium headless and a fake camera.
