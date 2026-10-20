# WebEye testbed

Record one user study, replay it through many eye-tracking pipelines offline.
Design rationale, threats to validity and the study protocol: [`../PLAN.md`](../PLAN.md).
Zero npm dependencies (Node >= 20, ffmpeg on PATH, a Chromium-based browser).

```
record (browser)  ->  data/sessions/<id>/   frames + events + GP3 + manifest
replay (CLI)      ->  specs x sessions  ->  rows.csv + experiments/registry.csv
landmark worker   ->  runs the model in a browser for any (session, preprocess, model) not yet cached
analysis (python) ->  paired statistics and plots
```

| Path | What |
|------|------|
| `src/shared/` | protocol -> schedule, ridge-polynomial mapping, geometry, keypoint subset (used by browser **and** Node) |
| `src/engine/` | spec, preprocessing (ffmpeg), pipeline, filters, metrics, sync, GP3 loading, simulation |
| `src/server/` | local HTTP server (recording uploads, job queue) and the GP3 TCP bridge |
| `src/web/` | `index.html` recorder, `worker.html` landmark worker, `detector_adapter.js` |
| `bin/` | `serve`, `replay`, `simulate`, `validate-session`, `compare-live-replay` |
| `protocols/`, `pipelines/` | study protocol; pipeline specs and sweeps |
| `analysis/` | Python: mixed models, cluster bootstrap, Holm, paired plots |
| `docs/` | workflow, data format, GP3 setup, pilot checklist, pre-registration template |

Quick start without any hardware (simulated participants with known ground truth —
this validates the machinery only, it is **not** evidence about real webcams):

```bash
npm test                                                   # all unit/integration tests
node bin/simulate.js --out /tmp/sim --n 10
node bin/replay.js --data /tmp/sim --specs pipelines/resolution-sweep.sweep.json --no-registry --out /tmp/simres
python3 analysis/analyze.py /tmp/simres/rows.csv --baseline res-001 --out /tmp/simres/analysis
```

Real study: see [`docs/WORKFLOW.md`](docs/WORKFLOW.md). Participant data (`data/`) is gitignored: face video is biometric data.
