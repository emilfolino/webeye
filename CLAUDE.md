# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

Explore whether higher-definition webcam input and more granular face mesh output can improve webcam-based eye tracking. The `face-landmarks-detection/` directory contains Google's TensorFlow.js face landmark model and demos as a reference and starting point.

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

**Keypoints:** The base model outputs **468** face mesh keypoints. Enabling `refineLandmarks: true` adds **10 iris keypoints** (indices 468–472 = left iris center + 4 cardinal points; 473–477 = right iris). The `x/y` values are pixel-space; `z` is depth relative to head center (negative = closer to camera), roughly same scale as `x`.

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
- `staticImageMode: false` (default for video) means the model tracks after the first detection frame instead of re-detecting every frame — lower latency but can lose lock.
