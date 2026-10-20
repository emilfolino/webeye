// Gazepoint GP3 reference data: load, align to the browser clock, look up.
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {browserServerClock, gp3ServerClock} from './sync.js';

/**
 * Returns {samples: [{t (browser ms), x, y (normalised), valid}], quality} or
 * null if the session has no usable GP3 stream / clock sync.
 */
export function loadGp3(sessionDir, events) {
  const path = join(sessionDir, 'gp3.jsonl');
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const bs = browserServerClock(events);
  const gs = gp3ServerClock(raw);
  if (!bs || !gs) return null;
  const samples = raw.filter(r => Number.isFinite(r.time)).map(r => ({
    t: bs.toBrowser(gs.toServer(r.time * 1000)),
    x: r.bpogx, y: r.bpogy, valid: r.bpogv === 1 || r.bpogv === true,
  })).sort((a, b) => a.t - b.t);
  return {
    samples,
    quality: {
      n: samples.length,
      validFraction: samples.filter(s => s.valid).length / (samples.length || 1),
      gp3ClockResidualMs: gs.residualSd, browserClockRttMs: bs.rttMs,
      browserClockResidualMs: bs.residualSd, driftPpm: bs.driftPpm,
    },
  };
}

/** Nearest GP3 sample to browser time t, or null if farther than maxGapMs. */
export function gp3At(gp3, t, maxGapMs = 25) {
  const a = gp3.samples;
  let lo = 0, hi = a.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid].t < t) lo = mid + 1; else hi = mid;
  }
  let best = null;
  for (const i of [lo - 1, lo]) {
    if (i >= 0 && i < a.length && (best === null || Math.abs(a[i].t - t) < Math.abs(best.t - t))) best = a[i];
  }
  return best && Math.abs(best.t - t) <= maxGapMs ? best : null;
}
