# Pilot checklist (before the main sample; n = 3-5 people, not part of the dataset)

Every item gets a pass/fail and a note in the lab notebook.

1. **Replay fidelity** — Record with "run the model live", queue an identity-preprocess replay (`resize` = the granted size) and run `bin/compare-live-replay.js`. Pass: median iris/corner difference well below 1 px and near-identical detection agreement. If not, replay is not representative: investigate JPEG quality (try PNG), the model's tracking state (the mediapipe runtime ignores `staticImageMode`; replay frames are a discontinuous feed only if frames are dropped), then fall back to native ffmpeg capture.
2. **Frame timing** — `validate-session.js` shows no non-monotonic timestamps, <2% gaps, uploader drops <2% at 4K. If 4K drops frames, lower fps or use PNG-free JPEG, close other apps.
3. **Synthetic degradation vs real low-res camera** — With both cameras recording simultaneously, compare landmark quality from the genuine low-res webcam against the 4K-downscaled-to-same-size replay. Report the gap; it bounds how far the "resolution" claim generalises from downscaling.
4. **GP3 sync** — Residuals/RTT within the limits in `GP3.md`; a deliberate saccade between two far dots shows a lag between GP3 and the stimulus consistent across runs.
5. **IR effect** — Landmark jitter with GP3 on vs off on a static face; report.
6. **Distance and screen size** — Confirm the measured mm of the visible screen area and the distance procedure; verify the degree conversion on a known target pair with a ruler.
7. **Timing budget** — Full protocol duration (`scheduleDurationMs`) acceptable (target <= 35 min incl. breaks); no participant fatigue complaints.
8. **End-to-end dry run** — record -> validate -> replay -> analyze on pilot data, including the worker with the real 4K frames and ms/frame numbers.
