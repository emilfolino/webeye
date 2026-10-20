# Data format

```
<session>/manifest.json
<session>/events.jsonl                    stimulus + clock events (browser performance.now ms)
<session>/cameras/<cam>/frames.jsonl      {i, t, w, h, file, mediaTime, presented}
<session>/cameras/<cam>/frames/*.jpg|png  source frames (lossless PNG optional)
<session>/gp3.jsonl                       {rx (server ms), time (GP3 s), bpogx, bpogy, bpogv, ...}
<session>/live/<cam>.jsonl                optional live landmarks (fidelity pilot)
<session>/landmarks/<cam>/<key>.jsonl     replay cache (header line + one record per frame)
```

**Time**: every `t` is browser `performance.now()` in ms; frame `t` is the camera capture time when the browser exposes it (`requestVideoFrameCallback`). `clock_sync` events `{t, t1, serverT}` map browser to server time; GP3 `time` is mapped to server time by regression over the per-sample `rx` stamps (`src/engine/sync.js`).

**Events**: `session_start`, `block_start {blockId, condition, calibrationFrom}`, `block_measure {distance_cm}`, `instruction`, `sync`, `target_on {id, x, y, nx, ny, role, set, rep, index, subsets, settleMs, collectMs}` / `target_off {id}`, `pursuit_on {path, durationMs}` / `pursuit_off`, `gp3_marker`, `session_end {aborted}`. Target ids are `block:role:set:rep:index`.

**Landmark record**: `{i, t, ok, ms, kp}`; `kp` is the stored keypoint subset (`src/shared/keypoints.js`, header field `subset` lists mesh indices) as `[x, y, z]` in pixels of the (preprocessed) frame, **unmirrored**. Mesh index convention: 468-472 is the subject's **right** iris (image left; corners 33/133), 473-477 the left iris (263/362).

**Cache keys**: `landmarkKey` = hash(camera, preprocess, model); `specHash` = hash of the whole spec except tag/description/frozen (`src/engine/spec.js`).

**Results**: `rows.csv` has `level = target | pooled`; accuracy/precision in degrees (true ray-angle geometry using the measured block distance) and pixels, plus data-loss counts (`n_noface`, `n_blink`, `n_gp3gated`), pursuit lag and ms/frame. `experiments/registry.csv` has one row per tag per run.
