# Running the testbed recorder on a Windows PC (native or WSL2)

Use this when the Gazepoint GP3 (Gazepoint Control is Windows-only) is attached to the PC that shows the stimulus. The GP3 is calibrated to one screen, so the browser recorder must run on the machine that drives that screen. **Recording needs only Node.js and Chrome/Edge**; replay, ffmpeg and the analysis stay on the Linux machine.

> If you prefer a Linux shell on the Windows PC (or want to replay there too), see [Alternative: WSL2](#alternative-run-the-server-in-wsl2) below; the browser and the GP3 stay on Windows either way.

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

## 7. Get the session to the analysis machine

Copy the session folder to the analysis machine, then validate and replay it. Nothing is uploaded anywhere.

**Find the session.** Each recording is one folder in `data\sessions\`, named `<pseudonym>-<timestamp>`. It holds `manifest.json`, `events.jsonl`, `gp3.jsonl` (the GP3 stream) and `cameras\<cam>\` with the frame images. Everything in the session folder is needed; skip `_jobs` and `_cache`.

**Pack it.** Frames are already JPEG, so compression does not shrink them. A 1-minute session was about 870 MB; a `webeye-main` session will be several GB. `tar` is built into Windows 10 and later and is faster than `Compress-Archive` for large folders:

```powershell
tar -cf session.tar -C data\sessions <session-folder>
```

Under WSL2 you can skip this and copy the folder directly (`\\wsl$\...` or `/mnt/c/...`).

**Transfer.** Use an encrypted USB drive, `scp`/`rsync` over the LAN, or the university's approved storage. The folder contains **face video (biometric data)**: do not use a public cloud link, and delete the Windows copy after the transfer is verified.

**Unpack and validate (analysis machine):**

```bash
cd ~/git/webeye/testbed
tar -xf session.tar -C data/sessions
node bin/validate-session.js data/sessions/<session-folder>
```

It should say `ok` and report the GP3 clock fit. If it fails, keep the folder and the output.

**Replay.** Mind the hold-out split first: `node bin/split.js NAME`. A `confirm` session is only replayed with specs marked `"frozen": true` (`replay.js` refuses otherwise).

```bash
# GP3 as its own pipeline (noise floor, same metrics)
node bin/replay.js --data data/sessions --specs pipelines/gp3-reference.json --sessions <id>
# Webcam pipeline, scored against the stimulus (and the GP3 for QC)
node bin/replay.js --data data/sessions --specs pipelines/baseline.json --sessions <id>
```

The first webcam replay queues landmark jobs and exits. Run `node bin/serve.js --data data/sessions` and open `http://localhost:8099/web/worker.html` in a browser (a GPU browser is much faster than a headless one), then re-run the replay command. Landmarks are cached, so mapping and feature changes do not need the worker again.

Results go to `results/<timestamp>/rows.csv`; accuracy and precision per tag are appended to `experiments/registry.csv`. Multi-participant analysis (`analysis/analyze.py`) is described in `README.md` and `docs/WORKFLOW.md`.

**Check on the first GP3 session (untested on real hardware):**
- The GP3 timestamps are aligned to the webcam clock by regression. Look for a clock residual under about 10 ms in the `validate-session` output before trusting any comparison with the GP3.
- The GP3 record fields were written from the Gazepoint API documentation and have only run against a fake server. If `gp3.jsonl` is empty or has missing fields, check `parseRec` in `src/server/gp3_bridge.js` first.

## Alternative: run the server in WSL2

Use this if you want the Linux toolchain (ffmpeg, Python analysis, replay) on the same PC. Only the **server** runs in WSL2. The **browser stays on Windows** (it owns the webcam and the screen, and WSL2 has no camera access), and **Gazepoint Control stays on Windows**. Native Windows (steps 1-7) is simpler and is the recommended route for recording; WSL2 adds a networking hop to the GP3.

> Untested: this was written from the WSL documentation, not run. Do the pilot (step 5) and report what breaks.

### W1. Install (once, inside the WSL2 shell, Ubuntu)

```bash
sudo apt update && sudo apt install -y ffmpeg git curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
node --version        # must be >= 20
git clone git@github.com:emilfolino/webeye.git ~/webeye && cd ~/webeye/testbed
```

(Or copy the `testbed/` folder into your WSL home.) For Python analysis also `sudo apt install -y python3-venv` and see `README.md`. Install Chrome/Edge on **Windows** as in step 1.

Keep the repo and `data/` on the WSL filesystem (`~/...`), **not** under `/mnt/c/...`: it is much faster and avoids permission problems. From Windows Explorer the folder is at `\\wsl$\Ubuntu\home\<you>\webeye\testbed\data`.

### W2. Make the GP3 reachable from WSL2

Gazepoint Control listens on Windows `127.0.0.1:4242`. In WSL2's default NAT mode `127.0.0.1` inside WSL is WSL itself, so the bridge cannot see it. Pick one:

- **Mirrored networking (Windows 11 22H2 or newer, recommended).** Create or edit `C:\Users\<you>\.wslconfig`:

  ```ini
  [wsl2]
  networkingMode=mirrored
  ```

  then `wsl --shutdown` in PowerShell and reopen WSL. Windows and WSL now share `127.0.0.1`, so `--gp3 127.0.0.1:4242` works unchanged.
- **NAT mode (Windows 10 or older Windows 11).** Forward a Windows address to the loopback-only GP3 port. In an **administrator** PowerShell, with `<WSLGW>` = the Windows address WSL sees (inside WSL: `ip route show default | awk '{print $3}'`):

  ```powershell
  netsh interface portproxy add v4tov4 listenaddress=<WSLGW> listenport=4242 connectaddress=127.0.0.1 connectport=4242
  New-NetFirewallRule -DisplayName "GP3 for WSL" -Direction Inbound -Protocol TCP -LocalPort 4242 -LocalAddress <WSLGW> -Action Allow
  ```

  Then use `--gp3 <WSLGW>:4242` below. Remove both when you are done (`netsh interface portproxy delete v4tov4 listenaddress=<WSLGW> listenport=4242`). The WSL gateway address can change after a reboot.

Check from WSL: `nc -zv 127.0.0.1 4242` (mirrored) or `nc -zv <WSLGW> 4242` (NAT) should say `succeeded`.

### W3. Start the server and record

```bash
cd ~/webeye/testbed
node bin/serve.js --data data/sessions --gp3 127.0.0.1:4242     # or --gp3 <WSLGW>:4242 in NAT mode
```

Then, **in Chrome/Edge on Windows**, open http://localhost:8099/ and continue with step 5 (pilot) and step 6 (participants). Windows forwards `localhost` to WSL2 automatically. If the page does not load, check `%UserProfile%\.wslconfig` does not set `localhostForwarding=false`, or try the WSL address from `hostname -I`. Camera access works on `localhost` because it counts as a secure origin.

Validate in WSL: `node bin/validate-session.js data/sessions/<session-folder>`.

### W4. Replay on the same PC

- `node bin/replay.js --data data/sessions --specs pipelines/baseline.json --sessions <id>` runs in WSL (ffmpeg is installed there). It queues landmark jobs when needed.
- Process the jobs by opening **http://localhost:8099/web/worker.html in the Windows browser** while the server runs: it uses the Windows GPU, which is much faster than software GL in a headless browser. Then re-run the replay command.

### WSL2 notes

- No automatic screen-size detection (no `/sys/class/drm` EDID in WSL2): use the credit-card calibration, as on native Windows.
- The WSL2 clock can drift after the PC sleeps or hibernates. Run `wsl --shutdown` and reopen WSL before a session, and check the clock fit in `validate-session` output.
- Do not leave the server bound to anything other than `127.0.0.1`: sessions contain face video.
- Stop the server (Ctrl-C) when you are done; closing the WSL window can leave it running.

## Troubleshooting

| Problem | Fix |
|---|---|
| `EADDRINUSE` | another server is running (in WSL2 also check `wsl --list --running`); stop it or use `--port` |
| WSL2: GP3 not connecting | `127.0.0.1` in WSL is not Windows unless mirrored networking is on; see W2 |
| Browser shows no camera | close other camera apps; check Settings > Privacy > Camera allows desktop apps and the browser |
| Granted resolution lower than requested | the camera does not offer it (the StreamCam stops at 1080p); the manifest records what was granted |
| GP3 not connecting | Gazepoint Control must be running; check port 4242; the server log shows the bridge status; `/api/gp3/status` shows it too |
| Screen size prompt appears every time | expected on Windows (no EDID detection); use the card calibration |
| Windows display scaling is 125% or 150% | fine, the recorder uses `devicePixelRatio`; keep the same scaling for the whole study |
