# Gazepoint GP3 reference tracker

The server connects to the Gazepoint Control TCP API (default `127.0.0.1:4242`; Gazepoint Control must be running and calibrated) with `node bin/serve.js --gp3 127.0.0.1:4242`. The bridge enables `ENABLE_SEND_DATA`, `ENABLE_SEND_POG_BEST`, `ENABLE_SEND_TIME`, pupil and counter fields and writes every `<REC .../>` record with a server receive stamp (`rx`) to `gp3.jsonl`.

Setup rules (affect validity):
- Calibrate the GP3 (9-point in Gazepoint Control) for each participant and **check the validation error before the session**; record it in the notes. Re-calibrate between blocks if the participant moved a lot.
- The reference has its own error (~0.5-1 deg). It is used for QC, gating and agreement, not as ground truth: the stimulus position is ground truth for the fixation tasks.
- The GP3 uses its own IR illumination; check that it does not change webcam landmarks (pilot item) and report it as a limitation.
- Clock alignment: the validator reports the GP3 clock regression residual and browser-server RTT. Residuals above ~10 ms or RTT above ~20 ms mean a busy machine; re-run.
- This was developed against a fake TCP server only; **it has not been run against real hardware**. Verify field names against your GP3 firmware (`parseRec` in `src/server/gp3_bridge.js`).
