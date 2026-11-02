# Running the testbed recorder on a Windows PC

Use this when the Gazepoint GP3 (Gazepoint Control is Windows-only) is attached to the PC that shows the stimulus. The GP3 is calibrated to one screen, so the browser recorder must run on the machine that drives that screen. **Recording needs only Node.js and Chrome/Edge**; replay, ffmpeg and the analysis stay on the Linux machine.

> Status: the Windows path handling was fixed by code review and checked on Linux only. Nothing here has been run on real Windows or against real GP3 hardware yet; treat the first run as a pilot (step 5).

## 1. Install (once)

- Node.js 20 or newer: `winget install OpenJS.NodeJS.LTS` (or https://nodejs.org). Check with `node --version`.
- Chrome or Edge (any recent version).
- Gazepoint Control (comes with the GP3).
- No `npm install` is needed (the testbed has no dependencies). No ffmpeg, Python or internet is needed for recording. (Internet is only needed for the optional "live landmarks" checkbox.)

## 2. Copy the folder

Copy the whole `testbed/` folder to the Windows PC (zip, USB stick or `git clone` of the repo). Do **not** copy `testbed/data/` or `testbed/results/` (participant video, gitignored).

Open PowerShell in the copied `testbed` folder.

## 3. Start the GP3

1. Start Gazepoint Control and calibrate for the participant (9-point). Check the validation error and note it.
2. Check the API is listening: `Test-NetConnection 127.0.0.1 -Port 4242` should say `TcpTestSucceeded : True`.

## 4. Start the study server

```powershell
node bin\serve.js --data data\sessions --gp3 127.0.0.1:4242
```

Leave it running. It listens on 127.0.0.1 only (not reachable from the network). Omit `--gp3 ...` to record webcam only. If port 8099 is busy add `--port 8100` and use that port below.

## 5. Pilot recording (5 minutes, do this first)

1. Close apps that use the camera (Teams, Zoom, the Windows Camera app).
2. Set the monitor the GP3 is mounted on as the main display. Use Chrome/Edge at browser zoom 100%.
3. Open http://localhost:8099/ , allow camera access, choose the cameras, tick **GP3**, pick protocol **webeye-quick** and a pseudonym.
4. Press Start and follow the dots. Windows has no automatic screen-size detection here, so the recorder asks you to hold a credit card (85.6 mm) against the screen to calibrate the size; do that once per screen.
5. After the run, in a second PowerShell window:

   ```powershell
   node bin\validate-session.js data\sessions\<session-folder>
   ```

   Expect `ok`. Check that it reports the GP3 clock fit and that `data\sessions\<session>\gp3.jsonl` is not empty. If validation fails, keep the session folder and send me the output.

## 6. Real participants

- Choose the pseudonym first and check its split: `node bin\split.js NAME`. Names in the **confirm** split are the hold-out set (never tuned on); pick names deliberately, do not re-roll names until they land in dev.
- Use protocol **webeye-main**. Fill in the consent checkboxes (raw video release is opt-in per participant). Ethics approval must be in place before recording anyone other than yourself.
- Optionally measure the eye-to-screen distance with a tape measure at the start and enter it (`start distance`). Otherwise the distance is estimated from iris size (about +-10%).
- Re-calibrate the GP3 between blocks if the participant moved a lot.

## 7. Move the data to the analysis machine

Each session is one folder under `data\sessions\`. Zip it and copy it to the Linux machine's `testbed/data/sessions/`. The folder contains **face video (biometric data)**: use an encrypted drive or the university's approved storage, not a public cloud link, and delete the Windows copy after the transfer is verified.

Then on the analysis machine: `node bin/validate-session.js data/sessions/<id>`, `node bin/replay.js ...` (see `README.md` and `docs/WORKFLOW.md`).

## Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE` | another server is running; stop it or use `--port` |
| Browser shows no camera | close other camera apps; check Settings > Privacy > Camera allows desktop apps and the browser |
| Granted resolution lower than requested | the camera does not offer it (the StreamCam stops at 1080p); the manifest records what was granted |
| GP3 not connecting | Gazepoint Control must be running; check port 4242; the server log shows the bridge status; `/api/gp3/status` shows it too |
| Screen size prompt appears every time | expected on Windows (no EDID detection); use the card calibration |
| Windows display scaling is 125% or 150% | fine, the recorder uses `devicePixelRatio`; keep the same scaling for the whole study |
