// Recording session: runs the declarative protocol (shared/protocol.js) while
// capturing timestamped frames from one or more cameras, stimulus events and
// clock-sync pings, uploading everything to the local server.
import {buildSchedule, pursuitPosition} from '/shared/protocol.js';
import {KEYPOINT_SUBSET} from '/shared/keypoints.js';

const $ = id => document.getElementById(id);
const status = s => { $('status').textContent = s; };
const PROTOCOLS = [['webeye-main.protocol.json', 'webeye-main (study)'], ['webeye-quick.protocol.json', 'webeye-quick (~1 min smoke test, not for the study)']];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = () => performance.now();

// ---------- setup UI ----------
for (const [file, label] of PROTOCOLS) $('protocol').add(new Option(label, file));
let devices = [];
async function refreshDevices() {
  try { (await navigator.mediaDevices.getUserMedia({video: true})).getTracks().forEach(t => t.stop()); } catch (e) { status(`camera permission: ${e.message}`); }
  devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
  document.querySelectorAll('select.dev').forEach(fillDevices);
}
const fillDevices = sel => { const cur = sel.value; sel.innerHTML = ''; for (const d of devices) sel.add(new Option(d.label || d.deviceId.slice(0, 8), d.deviceId)); if (cur) sel.value = cur; };
function addCam(id = '', w = 1920, h = 1080, fps = 30) {
  const div = document.createElement('div');
  div.className = 'cam';
  div.innerHTML = `<div class="row"><div><label>Camera id (e.g. cam4k, camlow)</label><input class="cid" value="${id}"></div>
   <div><label>Device</label><select class="dev"></select></div></div>
   <div class="row"><div><label>Width</label><input class="cw" type="number" value="${w}"></div>
   <div><label>Height</label><input class="ch" type="number" value="${h}"></div>
   <div><label>FPS</label><input class="cf" type="number" value="${fps}"></div>
   <div><label>HFOV deg (datasheet)</label><input class="cfov" type="number" value="78"></div></div>
   <video muted playsinline></video><button class="rm">remove</button>`;
  fillDevices(div.querySelector('.dev'));
  div.querySelector('.rm').onclick = () => div.remove();
  $('cams').appendChild(div);
}
$('addcam').onclick = () => addCam();
$('refresh').onclick = refreshDevices;
await refreshDevices();
addCam('cam4k', 3840, 2160, 30);
addCam('camlow', 640, 480, 30);
if (devices.length > 1) document.querySelectorAll('select.dev')[1].selectedIndex = 1;


// ---------- screen size: credit-card calibration ----------
// Browsers cannot report physical screen size. The participant (or operator)
// holds an ISO ID-1 card (85.60 x 53.98 mm; bank card, ID, driving licence)
// against the screen and resizes the on-screen rectangle until it matches.
// Assumes square pixels. Done fullscreen so CSS px equal those used by the stimulus.
const CARD_MM = {w: 85.60, h: 53.98};
function calibrateScreen(ctx, W, H) {
  return new Promise(res => {
    let w = 324;  // ~ a card at 96 dpi
    const draw = () => {
      const h = w * CARD_MM.h / CARD_MM.w;
      ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff'; ctx.fillRect((W - w) / 2, (H - h) / 2, w, h);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect((W - w) / 2, (H - h) / 2, w, h);
      ctx.fillStyle = '#000'; ctx.font = '20px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('Hold a bank/ID card flat against the screen and resize this rectangle to match it.', W / 2, H / 2 - h / 2 - 70);
      ctx.fillText('Left/Right arrows (or mouse wheel): resize   Shift = coarse   Enter = confirm', W / 2, H / 2 - h / 2 - 36);
    };
    const done = () => {
      removeEventListener('keydown', onKey); removeEventListener('wheel', onWheel);
      const mmPerPx = CARD_MM.w / w;
      res({cardPx: w, mmPerPx, widthMm: Math.round(W * mmPerPx * 10) / 10, heightMm: Math.round(H * mmPerPx * 10) / 10});
    };
    const onKey = e => {
      const step = e.shiftKey ? 10 : 1;
      if (e.code === 'ArrowRight') w += step; else if (e.code === 'ArrowLeft') w -= step;
      else if (e.code === 'Enter') return done();
      w = Math.max(100, Math.min(W * 0.9, w)); draw();
    };
    const onWheel = e => { w = Math.max(100, Math.min(W * 0.9, w - Math.sign(e.deltaY) * (e.shiftKey ? 10 : 2))); draw(); };
    addEventListener('keydown', onKey); addEventListener('wheel', onWheel); draw();
  });
}

// ---------- upload plumbing ----------
const api = (path, opt) => fetch(path, opt);
class Uploader {
  constructor(sessionId, cam, maxQueue = 24) { this.base = `/api/sessions/${sessionId}/cameras/${cam}`; this.q = []; this.busy = 0; this.maxQueue = maxQueue; this.drops = 0; this.sent = 0; this.idx = []; this.errors = 0; }
  push(blob, rec) {
    if (this.q.length >= this.maxQueue) { this.drops++; return false; }
    this.q.push({blob, rec}); this.pump(); return true;
  }
  async pump() {
    while (this.busy < 3 && this.q.length) {
      const {blob, rec} = this.q.shift();
      this.busy++;
      api(`${this.base}/frames/${rec.file}`, {method: 'PUT', body: blob}).then(r => {
        if (!r.ok) throw new Error(r.status);
        this.sent++; this.idx.push(JSON.stringify(rec));
      }).catch(() => { this.errors++; }).finally(() => { this.busy--; this.pump(); });
    }
  }
  async flushIndex() {
    if (!this.idx.length) return;
    const body = this.idx.join('\n') + '\n'; this.idx = [];
    await api(`${this.base}/index`, {method: 'POST', body});
  }
  async drain() { while (this.q.length || this.busy) await sleep(50); await this.flushIndex(); }
}

// ---------- session ----------
$('start').onclick = () => run().catch(e => { console.error(e); status(`ERROR: ${e.message}`); document.exitFullscreen?.().catch(() => {}); });

async function run() {
  if (!$('c-study').checked) { status('Consent to participate must be ticked.'); return; }
  const pid = $('pid').value.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(pid)) { status('Pseudonym: letters, digits, _ and - only.'); return; }
  const camCfgs = [...document.querySelectorAll('.cam')].map(d => ({
    id: d.querySelector('.cid').value.trim(), deviceId: d.querySelector('.dev').value,
    w: +d.querySelector('.cw').value, h: +d.querySelector('.ch').value, fps: +d.querySelector('.cf').value,
    hfovDeg: +d.querySelector('.cfov').value, video: d.querySelector('video'),
  }));
  if (!camCfgs.length) { status('Add at least one camera.'); return; }
  const protocol = await (await api(`/protocols/${$('protocol').value}`)).json();

  // open cameras
  for (const c of camCfgs) {
    c.stream = await navigator.mediaDevices.getUserMedia({video: {deviceId: {exact: c.deviceId}, width: {ideal: c.w}, height: {ideal: c.h}, frameRate: {ideal: c.fps}}});
    c.video.srcObject = c.stream;
    await c.video.play();
    const s = c.stream.getVideoTracks()[0].getSettings();
    c.granted = {w: c.video.videoWidth, h: c.video.videoHeight, fps: s.frameRate};
    c.label = c.stream.getVideoTracks()[0].label;
  }

  await document.documentElement.requestFullscreen?.().catch(() => {});
  await sleep(500);
  document.activeElement?.blur();
  $('setup').style.display = 'none';
  const canvas = $('stim'); canvas.style.display = 'block';
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const cal = await calibrateScreen(ctx, W, H);
  const screenInfo = {widthPx: W, heightPx: H, widthMm: cal.widthMm, heightMm: cal.heightMm, pixelRatio: dpr,
    sizeMethod: 'card', cardPx: cal.cardPx, mmPerPx: cal.mmPerPx};

  const sessionId = `${pid}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const fmt = $('fmt').value;
  const manifest = {
    sessionId, participant: {id: pid, index: +$('pidx').value}, protocol: {name: protocol.name, version: protocol.version},
    screen: screenInfo, userAgent: navigator.userAgent, startedAt: new Date().toISOString(),
    consent: {study: true, rawVideoRelease: $('c-raw').checked, derivedRelease: $('c-derived').checked},
    gp3: {present: $('usegp3').checked}, subsetIndices: KEYPOINT_SUBSET,
    cameras: camCfgs.map(c => ({id: c.id, label: c.label, requested: {w: c.w, h: c.h, fps: c.fps}, granted: c.granted, hfovDeg: c.hfovDeg, frameFormat: fmt === 'png' ? 'png' : 'jpeg95'})),
  };
  const created = await api('/api/sessions', {method: 'POST', body: JSON.stringify(manifest)});
  if (!created.ok) throw new Error(`session create failed: ${created.status}`);

  // events (batched)
  let evBuf = [];
  const ev = e => evBuf.push(JSON.stringify({t: now(), ...e}));
  const flushEvents = async () => { if (!evBuf.length) return; const b = evBuf.join('\n') + '\n'; evBuf = []; await api(`/api/sessions/${sessionId}/events`, {method: 'POST', body: b}); };
  const evTimer = setInterval(() => flushEvents().catch(() => {}), 1000);

  // clock sync
  const ping = async () => { const t0 = now(); const r = await (await api('/api/clock')).json(); const t1 = now(); evBuf.push(JSON.stringify({type: 'clock_sync', t: t0, t1, serverT: r.t})); };
  for (let k = 0; k < 10; k++) { await ping(); await sleep(50); }
  const clockTimer = setInterval(() => ping().catch(() => {}), 5000);

  if ($('usegp3').checked) await api(`/api/sessions/${sessionId}/gp3`, {method: 'POST', body: JSON.stringify({action: 'start'})});

  // frame capture
  const ext = fmt === 'png' ? 'png' : 'jpg';
  const caps = camCfgs.map(c => ({c, up: new Uploader(sessionId, c.id), n: 0, stop: false, lastT: 0, busy: false}));
  for (const cap of caps) {
    const {c} = cap;
    const off = new OffscreenCanvas(c.granted.w, c.granted.h);
    const octx = off.getContext('2d');
    const onFrame = async (_n, meta) => {
      if (cap.stop) return;
      c.video.requestVideoFrameCallback(onFrame);
      const t = meta.captureTime ?? meta.expectedDisplayTime ?? now();
      if (cap.busy) { cap.up.drops++; return; }
      cap.busy = true;
      try {
        octx.drawImage(c.video, 0, 0);
        const blob = await off.convertToBlob(fmt === 'png' ? {type: 'image/png'} : {type: 'image/jpeg', quality: 0.95});
        const i = cap.n++;
        const rec = {i, t: Math.round(t * 100) / 100, w: c.granted.w, h: c.granted.h, file: `${String(i + 1).padStart(6, '0')}.${ext}`, mediaTime: meta.mediaTime, presented: meta.presentedFrames};
        cap.up.push(blob, rec);
        cap.lastT = t;
      } finally { cap.busy = false; }
    };
    c.video.requestVideoFrameCallback(onFrame);
  }
  const indexTimer = setInterval(() => caps.forEach(c => c.up.flushIndex().catch(() => {})), 2000);

  // optional live landmarks on first camera
  let liveStop = false, liveDone = Promise.resolve();
  if ($('live').checked) {
    const {createAdapter} = await import('/web/detector_adapter.js');
    const ad = await createAdapter({runtime: 'mediapipe', refineLandmarks: true, staticImageMode: false, maxFaces: 1});
    const c0 = camCfgs[0]; let buf = [];
    liveDone = (async () => {
      let last = -1;
      while (!liveStop) {
        const t = caps[0].lastT;
        if (t === last) { await sleep(5); continue; }
        last = t;
        const r = await ad.estimate(c0.video);
        buf.push(JSON.stringify({t, ok: r.ok, ms: r.ms, kp: r.kp}));
        if (buf.length >= 60) { const b = buf.join('\n') + '\n'; buf = []; api(`/api/sessions/${sessionId}/live/${c0.id}`, {method: 'POST', body: b}); }
      }
      if (buf.length) await api(`/api/sessions/${sessionId}/live/${c0.id}`, {method: 'POST', body: buf.join('\n') + '\n'});
    })();
  }

  // ---------- stimulus ----------
  const overlay = $('overlay'), hud = $('hud'); hud.style.display = 'block';
  const showText = t => { overlay.style.display = t ? 'flex' : 'none'; overlay.textContent = t || ''; };
  const clear = () => { ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H); };
  const dot = (x, y, r = 14) => {
    ctx.fillStyle = '#d00'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, 3, 0, 7); ctx.fill();
  };
  const waitKey = key => new Promise(res => { const h = e => { if (e.code === key) { removeEventListener('keydown', h); res(); } }; addEventListener('keydown', h); });
  const askNumber = prompt => new Promise(res => {
    showText(''); overlay.style.display = 'flex'; overlay.innerHTML = '';
    const d = document.createElement('div'); d.textContent = prompt; const i = document.createElement('input');
    i.type = 'number'; i.style.cssText = 'font:28px system-ui;width:6em;margin-left:1em'; d.appendChild(i); overlay.appendChild(d); i.focus();
    i.onkeydown = e => { if (e.key === 'Enter' && +i.value > 0) { overlay.style.display = 'none'; overlay.innerHTML = ''; res(+i.value); } };
  });
  let aborted = false;
  addEventListener('keydown', e => { if (e.code === 'Escape' && e.shiftKey) aborted = true; });
  const frameWait = () => new Promise(r => requestAnimationFrame(r));
  async function hold(durMs, draw) {
    const t0 = now();
    while (now() - t0 < durMs && !aborted) { clear(); draw?.(now() - t0); await frameWait(); }
  }

  ev({type: 'session_start'});
  if ($('usegp3').checked) { await api(`/api/sessions/${sessionId}/gp3`, {method: 'POST', body: JSON.stringify({action: 'marker'})}); ev({type: 'gp3_marker'}); }
  const schedule = buildSchedule(protocol, {width: W, height: H}, +$('pidx').value);
  clear();
  for (const s of schedule) {
    if (aborted) break;
    if (s.type === 'block_start') {
      ev({type: 'block_start', blockId: s.blockId, condition: s.condition, calibrationFrom: s.calibrationFrom});
      const nominal = s.condition?.distance_cm;
      showText(`Next block: ${s.blockId}\n${nominal ? `Sit about ${nominal} cm from the screen.` : ''}\nPress SPACE when ready.`);
      await waitKey('Space');
      if (nominal) { const d = await askNumber('Measured eye-to-screen distance (cm):'); ev({type: 'block_measure', blockId: s.blockId, distance_cm: d}); }
      showText('');
    } else if (s.type === 'instruction') {
      ev({type: 'instruction', text: s.text}); showText(`${s.text}\n\nPress SPACE.`); await waitKey('Space'); showText('');
    } else if (s.type === 'sync') {
      ev({type: 'sync', durationMs: s.durationMs}); await hold(s.durationMs, () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); });
    } else if (s.type === 'target') {
      ev({type: 'target_on', id: s.id, blockId: s.blockId, role: s.role, set: s.set, rep: s.rep, index: s.index, x: s.x, y: s.y, nx: s.nx, ny: s.ny, subsets: s.subsets, settleMs: s.settleMs, collectMs: s.collectMs, kind: s.kind});
      await hold(s.durationMs, () => dot(s.x, s.y));
      ev({type: 'target_off', id: s.id});
    } else if (s.type === 'pursuit') {
      ev({type: 'pursuit_on', id: s.id, blockId: s.blockId, role: s.role, path: s.path, settleMs: s.settleMs, durationMs: s.durationMs});
      await hold(s.durationMs, t => { const p = pursuitPosition(s.path, t); dot(p.nx * W, p.ny * H); });
      ev({type: 'pursuit_off', id: s.id});
    }
    hud.textContent = caps.map(c => `${c.c.id}: ${c.n} frames, ${c.up.drops} drops, q=${c.up.q.length}`).join(' | ');
  }
  ev({type: 'session_end', aborted});
  showText('Thank you — finishing upload…'); clear();

  // ---------- teardown ----------
  caps.forEach(c => { c.stop = true; });
  liveStop = true; await liveDone;
  clearInterval(clockTimer); clearInterval(indexTimer);
  await Promise.all(caps.map(c => c.up.drain()));
  if ($('usegp3').checked) await api(`/api/sessions/${sessionId}/gp3`, {method: 'POST', body: JSON.stringify({action: 'stop'})});
  clearInterval(evTimer); await flushEvents();
  const summary = Object.fromEntries(caps.map(c => [c.c.id, {frames: c.n, drops: c.up.drops, uploadErrors: c.up.errors}]));
  await api(`/api/sessions/${sessionId}/complete`, {method: 'POST', body: JSON.stringify({aborted, capture: summary, endedAt: new Date().toISOString()})});
  camCfgs.forEach(c => c.stream.getTracks().forEach(t => t.stop()));
  await document.exitFullscreen?.().catch(() => {});
  canvas.style.display = 'none'; overlay.style.display = 'none'; hud.style.display = 'none'; $('setup').style.display = 'block';
  status(`Done. Session ${sessionId}\n${JSON.stringify(summary, null, 1)}`);
}
