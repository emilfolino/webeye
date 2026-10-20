// Accuracy / precision metrics for a set of gaze samples against one target.
// All angular quantities use true ray angles via ScreenGeometry.
import {mean, median, quantile} from './stats.js';

/**
 * @param geom ScreenGeometry
 * @param preds [[x,y]] predicted gaze (screen px) in time order
 * @param target [x,y] target (screen px)
 */
export function targetMetrics(geom, preds, target) {
  const n = preds.length;
  if (n === 0) return {n: 0};
  const cx = mean(preds.map(p => p[0])), cy = mean(preds.map(p => p[1]));
  const centroid = [cx, cy];
  const errs = preds.map(p => geom.angleBetween(p, target));
  const devs = preds.map(p => geom.angleBetween(p, centroid));
  const s2s = [];
  for (let i = 1; i < n; i++) s2s.push(geom.angleBetween(preds[i - 1], preds[i]));
  const pxErr = preds.map(p => Math.hypot(p[0] - target[0], p[1] - target[1]));
  return {
    n,
    // Offset of the mean gaze from the target (classic "accuracy").
    accuracy_deg: geom.angleBetween(centroid, target),
    mean_err_deg: mean(errs),
    median_err_deg: median(errs),
    p95_err_deg: quantile(errs, 0.95),
    // Precision: dispersion about the centroid, and sample-to-sample RMS.
    precision_sd_deg: n > 1 ? Math.sqrt(devs.reduce((s, d) => s + d * d, 0) / (n - 1)) : NaN,
    precision_rms_s2s_deg: s2s.length ? Math.sqrt(mean(s2s.map(d => d * d))) : NaN,
    accuracy_px: Math.hypot(cx - target[0], cy - target[1]),
    mean_err_px: mean(pxErr),
  };
}

/**
 * Lag (ms) that best aligns predicted gaze with a moving target, searched over
 * [-maxLagMs, +maxLagMs]. Positive = gaze lags the target.
 * samples: [{t, pred:[x,y], targetAt:(t)=>[x,y]}]
 */
export function estimateLagMs(samples, maxLagMs = 600, stepMs = 20) {
  if (samples.length < 10) return NaN;
  let best = {lag: NaN, cost: Infinity};
  for (let lag = -maxLagMs; lag <= maxLagMs; lag += stepMs) {
    let cost = 0;
    for (const s of samples) {
      const tgt = s.targetAt(s.t - lag);
      cost += (s.pred[0] - tgt[0]) ** 2 + (s.pred[1] - tgt[1]) ** 2;
    }
    cost /= samples.length;
    if (cost < best.cost) best = {lag, cost};
  }
  return best.lag;
}
