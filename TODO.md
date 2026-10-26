# TODO

## 1. Increase camera resolution ceiling

`VIDEO_SIZE` in `face-landmarks-detection/demos/live_video/src/shared/params.js` tops out at 640×480. Add higher-resolution options (e.g. 1280×720, 1920×1080) and test whether `getUserMedia` actually delivers them on the target hardware. The constraint is an *ideal*, not a guarantee — log `camera.video.videoWidth/Height` after setup to verify what was granted.

## 2. Verify iris keypoint granularity for gaze estimation

With `refineLandmarks: true` the model returns 10 iris keypoints: 5 per eye (center + top/right/bottom/left cardinal points). Determine whether these 5 points give enough information to estimate a reliable gaze vector, or whether we need a different approach (e.g. fitting an ellipse to the full eye contour and computing pupil offset relative to it).

## 3. Derive a gaze direction signal from iris position

The iris center keypoint (index 468 left, 473 right) combined with the eye corner keypoints from the named contour gives a pupil-in-eye position. Implement a function that outputs a normalised 2D gaze offset `{x, y}` per eye, where `(0, 0)` = looking straight ahead. Use the eye-width (distance between inner/outer corners) as the normalisation factor so the signal is scale-invariant.

## 4. Benchmark inference latency at higher resolutions

Add timing instrumentation around `detector.estimateFaces` (the demo already has an FPS panel — extend it to also show per-call ms). Run at 640×480 vs. 1280×720 vs. 1920×1080 on both `mediapipe-gpu` and `tfjs-webgl` backends and record whether latency stays below one frame at 30 fps (33 ms) and 60 fps (16 ms).

## 5. Evaluate whether the z-coordinate improves eye tracking

Each keypoint carries a `z` value (depth, roughly same scale as `x`). Assess whether incorporating `z` for the iris and eye-corner keypoints gives a meaningful improvement in gaze accuracy when the head is pitched or yawed, compared to using only `x/y`.

## 6. Extract and isolate eye-region sub-image

For a more granular approach, crop and affine-warp the eye region from the full video frame using the eye bounding keypoints before passing to any secondary model. The warp matrix can be derived from the four eye-corner keypoints. This would allow higher effective resolution on the eye even from a lower-resolution camera feed.

## 7. Remove the mobile hard-cap or make it configurable

`isMobile()` in `util.js` silently caps resolution to 360×270 on phones. If testing on a mobile device, this needs to be lifted or made an opt-in override via a URL parameter.

## 8. Pupil dilation (pupil size) for the final model

Add a calibrated pupil-diameter signal to the final model. It is valuable on its own (cognitive load, arousal) and as a covariate for gaze (pupil-centre shift). Notes for whoever picks this up:

- The mesh's iris ring is the limbus (iris ≈ 11.7 mm, nearly constant), not the pupil. Measure the *pupil* inside it and report `pupilDiameter = irisDiameterMm · pupilPx / irisPx`, so the iris is the ruler and no camera calibration is needed.
- Needs enough pixels across the iris (~100 px at 1080p, 60 cm; only ~35 px at 640×480). Do it on the full-resolution eye crop (see item 6), not on the 192×192 face-mesh input.
- Ground truth: the Gazepoint GP3 reports pupil diameter (`PUPIL_*`, already enabled in `testbed/src/server/gp3_bridge.js`), so the testbed can score it like gaze.
- Confounds to control or model: screen luminance (the pupillary light reflex), viewing distance, gaze angle (foreshortening of the pupil ellipse), eyelid occlusion and eye colour/contrast (dark brown irises hide the pupil in visible light).
- Report as a new metric next to accuracy/precision (e.g. pupil error in mm and correlation with GP3 over time), with its own pipeline tag.
