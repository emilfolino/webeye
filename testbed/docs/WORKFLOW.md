# Workflow

## 1. Before data collection
1. Run the pilot checklist ([PILOT_CHECKLIST.md](PILOT_CHECKLIST.md)). Do not collect the main sample before the fidelity and sync checks pass.
2. Fill in [PREREGISTRATION_TEMPLATE.md](PREREGISTRATION_TEMPLATE.md); register it; then set `"frozen": true` on the confirmatory sweep and commit.
3. Set up the GP3 ([GP3.md](GP3.md)).

## 2. Recording a session
```bash
node bin/serve.js --data data/sessions --gp3 127.0.0.1:4242     # drop --gp3 to record without reference
```
Open `http://localhost:8099/`, enter the pseudonym and a counterbalancing index (0, 1, 2, ... in order of arrival), choose the cameras (e.g. `cam4k`, `camlow`), tick consent, start. The page goes fullscreen and first gets the screen size: on Linux the server reads the monitor's EDID (`/sys/class/drm`) and shows it for you to accept with Enter (press C to override). If nothing matches, or on macOS/Windows, it falls back to the card method: hold a bank/ID card (85.6 mm wide) against the screen and resize the on-screen rectangle to match it (arrows/wheel, Enter). Physical screen size is derived from this (square pixels assumed) and stored in the manifest. It then runs the chosen protocol (`webeye-main`; `webeye-quick` is a ~1 min smoke test, not for the study). At each block the participant presses SPACE and the operator types the measured eye-to-screen distance. `Shift+Esc` aborts (the session is kept and flagged). Afterwards:

```bash
node bin/validate-session.js data/sessions/<id>      # exit 1 on hard failures
```
Re-record a session that fails validation; keep the failed one out of `data/sessions` (move it, do not delete silently — report exclusions).

## 3. Replaying pipelines
```bash
node bin/replay.js --data data/sessions --specs pipelines/baseline.json --split dev
```
First run: missing landmark caches are written to `data/sessions/_jobs` and the command exits after queuing. Open `http://localhost:8099/web/worker.html` (with `node bin/serve.js` running) and leave it in the foreground; when the queue is empty re-run the same command. Landmarks are cached per (session, camera, preprocess, model): changing only features/mapping/filter/calibration never needs the browser again.

Every spec has a **tag**; every replay appends one row per tag to `experiments/registry.csv` (accuracy, precision, git commit, spec hash), as CLAUDE.md requires. Use `--cv` for leave-one-target-out cross-validation of the calibration.

Hold-out: participants are assigned to `dev` (30%) or `confirm` by a salted hash of the pseudonym. Tune on `dev`. `replay.js` refuses to read `confirm` data unless every spec is `"frozen": true`, and logs every access to `experiments/confirmatory_access.log`.

## 4. Analysis
```bash
python3 -m venv .venv && .venv/bin/pip install -r analysis/requirements.txt
.venv/bin/python analysis/analyze.py results/<run>/rows.csv --baseline <tag> --out results/<run>/analysis
```
Inference is per participant (cluster bootstrap and mixed model with participant random intercept), Holm-corrected over the contrast family. Report effect sizes with CIs, not only p-values.
