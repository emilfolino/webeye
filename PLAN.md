# WebEye Testbed Plan: One User Study, Many Pipeline Conditions

Target venue: CHI 2028 (submission ~Sept 2027). Working back from that, data collection should finish by ~Q2 2027.

## 1. Problem

The current harness (`gaze_test.js`) is **online**: one camera config, one model config, one mapping per session. Comparing N pipeline variants (resolution, model, `refineLandmarks`, mapping, filtering) needs N sessions per participant. That is slow, tiring for participants, and confounded by drift, fatigue, head movement and lighting between sessions.

## 2. Core idea: record once, replay many (offline, paired)

Separate **data acquisition** from **pipeline evaluation**.

1. **Acquisition (per participant, once):** record the camera stream at the *highest* quality available, losslessly or near-losslessly, together with a precise log of stimulus events (target positions, onset/offset timestamps) and ground-truth reference data.
2. **Replay (offline, unlimited):** feed the *same frames* through any number of pipeline variants, deterministically, and compute accuracy/precision for each.

Consequences:
- Every condition sees identical eyes, head poses, lighting, blinks and fatigue, so comparisons are **fully paired**. Variance between participants and sessions drops out, which is why far fewer participants are needed.
- New ideas can be tested after the study ends, including ideas we haven't had yet. Reviewers' requests ("what about model X?") become cheap.
- The recorded dataset is itself a publishable, citable artifact.

## 3. What replay can and cannot test

| Variable | Replayable from one recording? | Notes |
|---|---|---|
| Input resolution (480p → 720p → 1080p → 4K) | **Yes, by downsampling** | Caveat A below |
| Crop / ROI around face before inference | Yes | |
| Landmark model (MediaPipe, TF.js, other) | Yes | |
| `refineLandmarks`, `staticImageMode`, thresholds | Yes | |
| Mesh density / more granular output | Yes (model-dependent) | |
| Gaze mapping (polynomial order, ridge, GP, NN) | Yes | |
| Calibration density / which points used | Yes | Use subsets of recorded points |
| Temporal filtering (Kalman, One-Euro, median) | Yes | |
| Head-pose compensation features | Yes | |
| Image preprocessing (denoise, sharpening, super-resolution, gamma) | Yes | |
| Frame rate | Yes, by frame dropping | |
| **Real different camera hardware / optics / sensor** | **No** | Needs separate recordings (see 3.2) |
| Lighting conditions, glasses, distance, posture | **No** | Must be manipulated at acquisition as within-subject blocks |
| Live-system latency / on-screen feedback effects | **No** | Out of scope or separate study |

### 3.1 Caveats to handle explicitly (threats to validity)

- **A. Downsampled 4K ≠ native 480p.** Synthetic downsampling is cleaner than a real low-res sensor/ISP (different noise, optics, compression). Mitigations: (i) simulate realistic degradation (add sensor noise, JPEG/H.264 compression, blur) as separate, documented conditions; (ii) validate the simulation on a **subset** of participants who also do a short session on a genuine native low-res camera, and report agreement between synthetic and native results; (iii) state the limitation.
- **B. Recording fidelity.** The recorded stream must not be degraded by the recorder. Browser `MediaRecorder` re-encodes lossy. Prefer: capture raw/MJPEG frames via WebCodecs `VideoFrame` → lossless PNG/WebP or high-bitrate intra-only encode; or capture with a native tool (ffmpeg/v4l2, OBS) in parallel. Log codec and bitrate. Verify that replayed-from-recording landmarks match live landmarks on a pilot (sanity check).
- **C. Determinism.** MediaPipe tracking mode is stateful, so results depend on frame order and timing. Replay frames in order with recorded timestamps, fix model/runtime versions and backend (pin the WASM build and GPU/CPU delegate), and record the seed/versions. Run each condition ≥2 times to confirm bit-identical or near-identical output.
- **D. Calibration/validation leakage.** Fitting and testing on the same data inflates accuracy. See section 5.
- **E. Ordering/fatigue.** Not an issue between pipeline conditions (same data), but is an issue for the acquisition blocks. Counterbalance those.

### 3.2 Multi-camera extension (optional, high value)
Record 2–3 physically different webcams **simultaneously** (mounted adjacent, near the top of the screen) so hardware comparisons are paired too. Limitation: camera positions differ slightly (parallax); mount as close as possible and include camera offset as a covariate or calibrate per camera. Consider a native 4K camera as the "source" for downsampling plus a cheap 720p laptop camera as the "real low-res" reference for caveat A.

## 4. Acquisition protocol

### 4.1 Hardware / setup
- Fixed display (record size, PPI, refresh rate), calibrated pixels-per-cm so degrees of visual angle come from **geometry** (viewing distance and screen size), not just iris size.
- Chin rest or head-stabilised condition (controlled) plus free-head conditions (ecological).
- Viewing distance measured per participant (tape / depth camera); log it.
- **Reference ground truth:** the fixed on-screen target position is the ground truth (as now). Strongly recommended additional reference: a commercial remote eye tracker (e.g. Tobii Pro Fusion/Spark) recording simultaneously, used to (a) verify participants actually fixated targets, (b) quantify our fixation error vs. an accepted standard, and (c) flag/exclude samples with saccades or blinks. Reviewers in HCI will ask for this.
- Clock sync: every stimulus event and every frame timestamped on one monotonic clock (`performance.now()` plus `requestVideoFrameCallback` `captureTime`/`presentedFrames`). Store a flashing sync marker if multiple devices are used.

### 4.5 Reference tracker: Gazepoint GP3
Specs below are from memory of the manufacturer's documentation. Verify them against the manual and the Gazepoint API docs for our unit and software version before relying on them.

- **Sampling rate:** nominally 60 Hz (the GP3 HD is 150 Hz; confirm which we have). The webcam runs at ~30 fps, so align by timestamp and interpolate or take the nearest sample, and document the rule.
- **Accuracy:** manufacturer states ~0.5–1° visual angle. That is better than the expected webcam error (1–4°), but not negligible. Report webcam error against both the **on-screen target** (primary ground truth) and the **GP3 gaze point** (secondary), and treat GP3 error as a noise floor. Do not use GP3 output to "correct" target positions without stating so.
- **Calibration:** GP3 has its own calibration (Gazepoint Control). Calibrate it per participant (and re-check at block boundaries), log its reported calibration quality, and exclude participants/blocks whose GP3 validation is poor. Use its calibration separately from our webcam calibration so the two are independent.
- **Data access:** the GP3 streams over a TCP/IP API (default port 4242, XML-like messages). Browsers cannot open raw TCP, so add a small **local bridge** (Node script) that reads the GP3 stream and forwards it over WebSocket to the recorder page, or writes to disk with its own timestamps. Fields to log: best-point-of-gaze (normalised screen coords), per-eye gaze, pupil data, validity flags, fixation data, its own time and tick counter.
- **Clock sync:** GP3 timestamps are on its own clock. Align to the browser clock by (a) sending marker events through the API if supported, (b) logging the bridge's receive time with `performance.now()`, and (c) a visible flash/sync target seen by both webcam and GP3 at session start and end to estimate offset and drift. Report the estimated sync error.
- **Physical setup:** the GP3 sits below the screen and the webcams above it, so check that the GP3 does not occlude the display and that its infrared illumination does not visibly change the webcam image (compare frames with the GP3 on and off in a pilot). Check the head box (the tracker's tracking volume, roughly a tens-of-cm region at its recommended distance) against our distance and free-head conditions; GP3 data loss in the far/dim/head-movement blocks will be a confound to report.
- **Use in analysis:** (a) quality gate, i.e. flag frames where the participant was not fixating the target; (b) fixation onset detection to replace fixed settle windows; (c) benchmark column in the results tables; (d) pursuit segment ground truth cross-check.
- **Participant exclusions:** the GP3 is itself less reliable for some eyes (glasses, some eye shapes, drooping lids), so pre-register how the GP3 data loss is handled, and do not exclude webcam data just because GP3 failed, since that would bias the sample toward easy eyes.

### 4.2 Stimulus design (richer than the current 9+5 dots)
Single session should contain enough diverse data to support many analyses:
- **Calibration set:** dense grid (e.g. 5×5 = 25 points) so we can evaluate calibration with subsets of 4/5/9/13/25 points.
- **Validation set (held out):** separate ≥ 9–16 points **not** in the calibration grid (e.g. offset/random jittered positions), shown at different times in the session. 
- **Fixation dwell:** keep 500 ms settle + ≥1500 ms collect, but identify actual fixation onset using the reference tracker or velocity threshold rather than a fixed window.
- **Smooth pursuit / moving target** segment (continuous gaze trajectory; tests filtering and latency).
- **Free-viewing / UI task segment** (e.g. clicking targets, reading) for ecological validity; clicking tasks give extra implicit calibration data.
- **Head-movement block:** guided small head rotations/translations while fixating a point (tests robustness).
- **Re-test:** repeat the validation set at start, middle and end of session to measure drift (calibration decay is a major real-world factor).
- **Environmental blocks (within-subject, counterbalanced with Latin square):** lighting (normal / dim), distance (e.g. 50 / 70 cm), with vs. without glasses where applicable. Keep the number of blocks small; each block repeats a short protocol (~3–4 min).
- Total session target ≤ 30–40 min including setup.

### 4.3 Participants
- Power analysis (paired design, effect sizes from pilot; simulate via mixed model) → expect ~24–40 participants; aim ≥ 30 to cover diversity.
- Diversity matters because face-landmark performance is known to vary: skin tone, eye shape/epicanthic fold, glasses, contact lenses, makeup, facial hair, head covering, age, gender. Recruit deliberately, record these as covariates (with consent) and report subgroup results. This is both a CHI-relevant fairness contribution and a validity requirement.
- Pre-defined exclusion criteria (e.g. loss of face tracking > X% frames, failure to follow instructions), registered before data analysis. Report all exclusions.

### 4.4 Ethics and data governance
- IRB / institutional ethics approval **before** recruiting. Raw face video is biometric, personally identifiable data (GDPR special category in the EU if used to identify). Plan: explicit consent with separate opt-in for (a) study use, (b) public dataset release of raw video, (c) release of derived landmarks only.
- Encrypted storage, pseudonymised IDs, retention policy, access log.
- Release plan: derived (landmarks, gaze, metadata) data for everyone who consents; raw video only for those who opted in, under a data-use agreement.

## 5. Analysis design (scientific soundness)

### 5.1 Pre-registration
Register on OSF/AsPredicted **before** the main data collection (after pilots): hypotheses, conditions, primary metrics, exclusion rules, analysis code outline, correction for multiple comparisons. Label any analyses added later as **exploratory**. The replay structure makes it tempting to try everything, so this is the main guard against forking-paths/p-hacking.

### 5.2 Primary design
- **Within-subject, fully crossed:** each participant's data is run through every pipeline condition.
- Pre-register a small set of **confirmatory** factors (e.g. resolution × landmark runtime × mapping; `refineLandmarks=false` removes the iris keypoints, so it is not a valid level for an iris pipeline), and a larger **exploratory** pipeline sweep with clear labelling.
- Hold-out discipline: hyperparameters (mapping regularisation, filter params) are tuned on a **development subset of participants/sessions** or by nested cross-validation; the confirmatory evaluation uses data not touched during tuning. Never tune on the held-out validation points.

### 5.3 Metrics (extend the existing three)
Keep: mean accuracy, P95, precision (RMS-S2S). Add and report in **degrees from geometry**:
- Precision as **SD** and **RMS of sample-to-sample** distance (standard in the eye-tracking literature; RMS-S2S is the robust one).
- Median error and full per-sample error distributions (not only means).
- **Data loss / tracking-failure rate** (frames with no face, blink frames excluded via eye-aspect ratio).
- **Drift** across the three repeat validations.
- Pursuit lag / latency (from moving target).
- Robustness under head movement, lighting, distance.
- Computation cost (ms/frame, per backend) because higher resolution costs latency; report accuracy–cost trade-off.
- Iris-ruler pixels-per-degree is subject to iris-size variance (±~5–8%); use geometric deg conversion as primary and the iris ruler as a robustness check.

### 5.4 Statistics
- **Linear mixed-effects models** (or Bayesian equivalents): error ~ condition + (1 | participant) + (1 | target), with random slopes for condition per participant where supported. Log-transform or use gamma/robust models since errors are right-skewed.
- Report **effect sizes with confidence/credible intervals**, not only p-values. Correct for multiple comparisons (Holm/Bonferroni or FDR) on the confirmatory family.
- Per-participant paired plots (slope/spaghetti) plus subgroup breakdowns.
- Sensitivity analyses: with/without outlier participants, different fixation-window definitions, geometric vs. iris-ruler degrees.
- Report **everything** run, including pipelines that failed.

### 5.5 Baselines and comparisons
Include at least: current MediaPipe Face Mesh (iris) baseline at 640×480, a classical/learned appearance-based gaze estimator (e.g. WebGazer, or an appearance-based model such as ETH-XGaze/MPIIGaze-derived), and the reference commercial tracker. Without baselines, reviewers cannot place the result.

## 6. Software plan (what to build)

Split into three components, in this order:

### M1. Recorder (browser + optional native)
- New `demos/live_video/src/recorder.js`: capture frames at max resolution, write lossless/intra-only frames in chunks to disk (File System Access API or local server upload), plus a JSON-lines **event log**: `{t, type: "target_on"|"target_off"|"frame", x, y, block, targetId, phase}`.
- GP3 bridge (`testbed/gp3_bridge.js`): local Node process that connects to the GP3 API on TCP 4242 and relays/logs its samples with browser-aligned timestamps (see 4.5).
- Session manifest: participant ID (pseudonym), camera device/label/actual resolution/fps (`track.getSettings()`), screen size/PPI/viewing distance, lighting/glasses/block order, browser/OS/GPU, library versions.
- Stimulus engine driven by a **declarative protocol file** (JSON): list of blocks, point sets, durations, order, randomisation seed. The protocol is versioned and shipped with the paper.
- Replace the current hard-coded 9+5 test; keep the old harness as a quick live check. Keep CLAUDE.md experiment tagging: each tried pipeline gets a tag (see 6.4).

### M2. Replay / evaluation engine (headless, deterministic)
- Node or Python CLI (`testbed/`) that reads a recording + manifest and runs a **pipeline spec**:
  ```json
  {"tag": "v012", "preprocess": {"resize": [1280,720], "degrade": null},
   "model": {"runtime": "mediapipe", "refineLandmarks": true, "staticImageMode": false},
   "features": "iris-mean+headpose", "mapping": {"type": "poly2-ridge", "lambda": 0.1},
   "filter": {"type": "one-euro"}, "calibration": {"points": "9-grid"}}
  ```
- Pipeline stages are pluggable (preprocess → landmark model → feature extraction → mapping → filter) so a new idea is a new module, not a rewrite.
- Caches landmark outputs per (recording, preprocess, model) so mapping/filter sweeps are instant (model inference is the expensive step; mapping and filtering are cheap).
- Deterministic: pinned versions, fixed seeds, results include a hash of recording + spec + code commit.
- Outputs per-sample CSV/Parquet (participant, condition, target, error px/deg, ...) and a summary table, ready for R/Python statistics.
- Refactor `gaze_test.js` mapping (`solveLS`, `features`) into a shared module used by both the live demo and replay so there is one implementation. Note the current normal-equations solver is numerically fragile; use a QR/SVD or ridge-regularised solver in the replay engine.

### M3. Analysis notebooks / scripts
- R (lme4/brms) or Python (statsmodels/bambi) scripts, versioned, runnable from the published dataset to reproduce every table and figure. Include the pre-registered analysis as a script written *before* data collection and tested on simulated/pilot data.

### 6.4 Experiment tracking (per CLAUDE.md)
Each pipeline spec gets a tag (`v001`, `v002`, ...) stored in a registry file `experiments/registry.csv` with: tag, spec hash, code commit, date, dataset version, accuracy (mean/P95/precision, px and deg), n participants, notes. Results are derived by replay, so any tag can be re-run later and compared over time.

## 7. Timeline (backwards from CHI 2028 deadline ≈ Sept 2027)

| Period | Milestone |
|---|---|
| Q4 2026 | Literature review (eye-tracking quality metrics, webcam gaze: WebGazer, MPIIGaze, GazeCapture, etc.); finalise research questions; ethics application; build M1 recorder; pilot recorder fidelity (caveat B). |
| Q1 2027 | Build M2 replay engine; determinism and live-vs-replay validation (caveat C); pilot with 3–5 people; estimate effect sizes; power analysis; refine protocol (session length, stimulus). Native low-res camera validation pilot (caveat A). |
| Late Q1 2027 | **Freeze protocol, pre-register**, freeze dev/hold-out split. |
| Q2 2027 | Main data collection (30+ participants), with weekly data-quality checks via replay of baseline pipeline (stop-rules for bad recordings). |
| Q2–Q3 2027 | Run confirmatory analysis; exploratory sweep; write paper. Prepare dataset and code release package. |
| Sept 2027 | CHI 2028 submission. Reserve slack for ethics delays and a possible second recruitment round. |

## 8. Paper framing (CHI)
Possible contributions, in order of strength:
1. **Empirical:** quantified effect of input resolution, landmark granularity and mapping on webcam gaze accuracy/precision, with diverse participants.
2. **Method/Resource:** record-once/replay-many testbed and protocol enabling paired, reproducible evaluation of webcam eye tracking; open-source tools + dataset.
3. **Design implications:** what accuracy is achievable for which interaction targets (target sizes, UI grid) at each resolution/cost.

CHI expects: clear RQs, rigorous stats with effect sizes, participant demographics, limitations, ethics statement, and an open artifact. Check the CHI 2028 call for the exact deadline and any dataset/artifact policy.

## 9. Decisions

Decided:
1. **Reference eye tracker: Gazepoint GP3.** Record it simultaneously (section 4.1); use it to verify fixations and benchmark webcam error. GP3-specific handling is in section 4.5.
2. **Cameras: 4K webcam + genuine low-res webcam, can record simultaneously.** Use the multi-camera extension (3.2): the 4K stream is the source for synthetic downsampling, the real low-res stream validates the simulation (caveat A).
3. **Raw video release: opt-in.** Raw video is released only for participants who separately consent; derived data (landmarks, gaze, metadata) for all consenting participants (section 4.4).
4. **Capture path: browser only first** (WebCodecs). Add a native ffmpeg/v4l2 path only if the fidelity pilot (caveat B) shows the browser recording is not good enough.

Still open:
- Recruiting scope and ethics body (university IRB vs. local board).
- Confirmatory factor set to commit to (current draft in `testbed/pipelines/confirmatory.sweep.json`: resolution × landmark runtime (mediapipe/tfjs) × mapping (poly1/poly2); iris refinement is not a factor because without it there is no iris signal).

## 9.1 Implementation status (testbed/)

Built and tested (`cd testbed && npm test`; `python3 -m pytest -q analysis`):
- Engine (spec, ffmpeg preprocessing, features, ridge-poly mapping, filters, metrics, GP3 clock sync, hold-out split), replay CLI with registry, simulation with known ground truth, session validator.
- Local server, recorder page, landmark-worker page, GP3 bridge, live-vs-replay comparison tool, Python analysis (mixed model, cluster bootstrap, Holm).
- The record -> job queue -> worker -> replay chain was run end to end in headless chromium with a fake camera (face still image) and software GL.

NOT yet verified (needs hardware / people): GP3 bridge on a real device; 4K capture throughput and drops; the genuine low-res camera; fidelity of replay vs live on moving faces (pilot item 1); real timing of ms/frame on target GPUs; the ethics application. Simulated results validate machinery only and say nothing about real accuracy. `gaze_test.js` has not been refactored to share `src/shared/mapping.js` (optional; the live demo is unchanged).

Pilot checklist: `testbed/docs/PILOT_CHECKLIST.md`.

## 10. Immediate next steps
1. Settle the open items in section 9 (ethics body, confirmatory factors).
2. Write the protocol JSON schema and the pipeline spec schema.
3. Prototype M1 recorder; test lossless capture at 1080p/4K and compare live vs. replayed landmarks on one pilot recording.
4. Start the ethics application in parallel (long lead time).
