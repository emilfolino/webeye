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
