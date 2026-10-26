#!/usr/bin/env node
// Quality gate for a recorded session. Exit 1 if any hard check fails.
//   node bin/validate-session.js <session-dir>...
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {loadSession} from '../src/engine/session.js';

let bad = 0;
for (const dir of process.argv.slice(2)) {
  const errs = [], warns = [];
  let s;
  try { s = loadSession(dir); } catch (e) { console.log(`${dir}: UNREADABLE ${e.message}`); bad++; continue; }
  const m = s.manifest;
  for (const k of ['sessionId', 'participant', 'screen', 'cameras', 'consent']) if (!m[k]) errs.push(`manifest.${k} missing`);
  if (m.screen && !(m.screen.widthMm > 0 && m.screen.heightMm > 0)) errs.push('screen size in mm missing');
  else if (m.screen && !m.simulated && (m.screen.widthMm < 150 || m.screen.widthMm > 1500)) warns.push(`implausible screen width ${m.screen.widthMm} mm (card calibration off?)`);
  if (!s.events.some(e => e.type === 'session_start')) errs.push('no session_start event');
  if (!s.events.some(e => e.type === 'session_end')) errs.push('no session_end (recording interrupted?)');
  if (m.aborted) warns.push('session was aborted by the operator');
  for (const [id, cam] of Object.entries(s.cameras)) {
    const f = cam.frames;
    if (!f.length) { errs.push(`${id}: no frames`); continue; }
    let nonMono = 0, missing = 0;
    for (let i = 1; i < f.length; i++) if (f[i].t <= f[i - 1].t) nonMono++;
    if (!m.simulated) for (const fr of f.slice(0, 50)) if (!existsSync(join(cam.dir, 'frames', fr.file))) missing++;
    if (nonMono) errs.push(`${id}: ${nonMono} non-monotonic frame timestamps`);
    if (missing) errs.push(`${id}: frame files missing`);
    const dts = f.slice(1).map((x, i) => x.t - f[i].t).sort((a, b) => a - b);
    const med = dts[dts.length >> 1];
    const gaps = dts.filter(d => d > 2.5 * med).length;
    if (gaps / f.length > 0.02) warns.push(`${id}: ${gaps} gaps >2.5x median interval (${(100 * gaps / f.length).toFixed(1)}%)`);
    const cap = m.capture?.[id];
    if (cap?.drops > 0.02 * f.length) warns.push(`${id}: ${cap.drops} frames dropped by uploader`);
    if (cap?.uploadErrors) errs.push(`${id}: ${cap.uploadErrors} upload errors`);
    const g = m.cameras.find(c => c.id === id)?.granted;
    const req = m.cameras.find(c => c.id === id)?.requested;
    if (g && req && (g.w < req.w || g.h < req.h)) warns.push(`${id}: granted ${g.w}x${g.h}, requested ${req.w}x${req.h}`);
  }
  const nBlocks = s.timeline.blocks.size;
  if (!nBlocks) errs.push('no blocks');
  if (![...s.timeline.blocks.values()].every(b => b.distanceCmMeasured != null) && !Object.values(s.cameras).some(c => c.hfovDeg)) errs.push('no measured distance and no camera FOV: viewing distance cannot be estimated');
  if (!m.startDistanceCm && ![...s.timeline.blocks.values()].every(b => b.distanceCmMeasured != null)) warns.push('automatic distance is scaled by the nominal camera FOV only (no startDistanceCm); absolute error maybe ~10%');
  if (!s.timeline.targets.length) errs.push('no stimulus intervals');
  const pings = s.events.filter(e => e.type === 'clock_sync').length;
  if (pings < 10) warns.push(`only ${pings} clock_sync pings`);
  if (m.gp3?.present) {
    if (!s.gp3) errs.push('GP3 expected but no usable samples/clock sync');
    else {
      const q = s.gp3.quality;
      if (q.validFraction < 0.8) warns.push(`GP3 valid fraction ${q.validFraction.toFixed(2)}`);
      if (q.gp3ClockResidualMs > 10) warns.push(`GP3 clock residual ${q.gp3ClockResidualMs.toFixed(1)} ms`);
      if (q.browserClockRttMs > 20) warns.push(`browser-server RTT ${q.browserClockRttMs.toFixed(1)} ms`);
    }
  }
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${m.sessionId}  blocks=${nBlocks} targets=${s.timeline.targets.length}` +
    `${errs.map(e => `\n   ERROR ${e}`).join('')}${warns.map(e => `\n   warn  ${e}`).join('')}`);
  if (errs.length) bad++;
}
process.exit(bad ? 1 : 0);
