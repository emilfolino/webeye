// Clock alignment between browser (performance.now), server and GP3 clocks.
// browser --(clock_sync pings)--> server --(rx stamps)--> GP3 TIME.

function linfit(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  const slope = sxx > 0 ? sxy / sxx : 1;
  const intercept = my - slope * mx;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (ys[i] - (slope * xs[i] + intercept)) ** 2;
  return {slope, intercept, residualSd: n > 2 ? Math.sqrt(ss / (n - 2)) : NaN};
}

/**
 * Browser -> server clock model from clock_sync events
 * {t: browser send, t1: browser receive, serverT}. NTP-style: only the
 * lowest-RTT quarter is used (queueing delay biases high-RTT pings).
 * Returns {toServer(tBrowser), toBrowser(tServer), n, rttMs, residualSd}.
 */
export function browserServerClock(events) {
  const pings = events.filter(e => e.type === 'clock_sync' && Number.isFinite(e.serverT))
      .map(e => ({mid: (e.t + e.t1) / 2, rtt: e.t1 - e.t, serverT: e.serverT}));
  if (!pings.length) return null;
  pings.sort((a, b) => a.rtt - b.rtt);
  const keep = pings.slice(0, Math.max(3, Math.ceil(pings.length / 4)));
  let fit;
  if (keep.length >= 3 && Math.max(...keep.map(p => p.mid)) - Math.min(...keep.map(p => p.mid)) > 5000) {
    fit = linfit(keep.map(p => p.mid), keep.map(p => p.serverT));
  } else {
    const off = keep.reduce((s, p) => s + (p.serverT - p.mid), 0) / keep.length;
    fit = {slope: 1, intercept: off, residualSd: NaN};
  }
  return {
    toServer: t => fit.slope * t + fit.intercept,
    toBrowser: s => (s - fit.intercept) / fit.slope,
    n: keep.length, rttMs: keep[0].rtt, residualSd: fit.residualSd,
    driftPpm: (fit.slope - 1) * 1e6,
  };
}

/**
 * GP3 TIME (s) -> server time (ms) model from per-sample receive stamps.
 * Regression over all samples averages out TCP jitter.
 */
export function gp3ServerClock(samples) {
  const xs = [], ys = [];
  for (const s of samples) {
    if (Number.isFinite(s.time) && Number.isFinite(s.rx)) {
      xs.push(s.time * 1000);
      ys.push(s.rx);
    }
  }
  if (xs.length < 10) return null;
  const f = linfit(xs, ys);
  return {toServer: ms => f.slope * ms + f.intercept, residualSd: f.residualSd, slope: f.slope};
}
