// Offline evaluation of one pipeline spec on one recorded session.
//   landmarks -> features -> calibration fit -> predict -> filter -> metrics
// Returns flat rows (one per target and one pooled row per block/role/rep).
import {fitPoly, predictPoly} from '../shared/mapping.js';
import {ScreenGeometry} from '../shared/geometry.js';
import {pursuitPosition} from '../shared/protocol.js';
import {computeFeatures, eyeAspectRatio, irisDiameterPx} from './features.js';
import {createFilter} from './filters.js';
import {estimateLagMs, targetMetrics} from './metrics.js';
import {gp3At} from './gp3.js';
import {hasLandmarks, readLandmarks} from './landmarks.js';
import {landmarkKey, normaliseSpec, specHash} from './spec.js';
import {mean, median, quantile} from './stats.js';
import {makeDistanceResolver} from './distance.js';

const GAP_RESET_MS = 250;

export class MissingLandmarksError extends Error {
  constructor(session, spec) {
    super(`No landmark cache for session ${session.manifest.sessionId} ` +
          `camera ${spec.camera} key ${landmarkKey(spec)}`);
    this.session = session;
    this.spec = spec;
  }
}

function lowerBound(arr, t) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function slice(arr, t0, t1) {
  return arr.slice(lowerBound(arr, t0), lowerBound(arr, t1));
}

/** Build the unified per-frame stream for either a camera or the GP3. */
function buildFrames(session, spec) {
  const W = session.manifest.screen.widthPx, H = session.manifest.screen.heightPx;
  if (spec.model.runtime === 'gp3') {
    if (!session.gp3) return {frames: [], meta: {}, reference: true};
    const frames = session.gp3.samples.map(s => ({
      t: s.t, ok: s.valid, ear: 1, ms: 0,
      directPred: [s.x * W, s.y * H],
    }));
    return {frames, meta: {}, reference: true};
  }
  if (!hasLandmarks(session.dir, spec)) throw new MissingLandmarksError(session, spec);
  const {header, records} = readLandmarks(session.dir, spec);
  const frames = records.map(r => {
    const ok = !!r.ok;
    return {
      t: r.t, ok, ms: r.ms ?? NaN,
      feat: ok ? computeFeatures(r, spec.features) : null,
      ear: ok ? eyeAspectRatio(r) : NaN,
      irisPx: ok ? irisDiameterPx(r) : NaN,
      w: r.w,
    };
  });
  return {frames, meta: header, reference: false};
}

function classify(frame, target, spec, gp3, geom) {
  if (!frame.ok || (!frame.directPred && !frame.feat)) return 'noface';
  if (!frame.directPred && frame.ear < spec.gating.blinkEar) return 'blink';
  if (spec.gating.gp3) {
    if (!gp3) throw new Error('gating.gp3 set but session has no GP3 data');
    const g = gp3At(gp3, frame.t);
    if (!g || !g.valid) return 'gp3';
    const W = geom.s.widthPx, H = geom.s.heightPx;
    if (geom.angleBetween([g.x * W, g.y * H], target) > spec.gating.gp3.maxDeviationDeg) return 'gp3';
  }
  return 'ok';
}

function windowOf(target, spec) {
  const settle = spec.window.settleMs ?? target.settleMs;
  const t0 = target.tOn + settle;
  const collect = spec.window.collectMs;
  let t1 = collect != null ? t0 + collect : (target.kind === 'pursuit' ?
      target.tOn + target.durationMs : t0 + target.collectMs);
  if (Number.isFinite(target.tOff)) t1 = Math.min(t1, target.tOff);
  return [t0, t1];
}

function fitFor(samples, spec) {
  const distinct = new Set(samples.map(s => s.targetId)).size;
  const terms = (() => {
    const k = samples[0]?.feat.length ?? 0;
    let c = 1;  // number of monomials up to degree d in k vars = C(k+d, d)
    for (let i = 1; i <= spec.mapping.degree; i++) c = c * (k + i) / i;
    return Math.round(c) - 1;
  })();
  if (distinct < 4 || samples.length < Math.max(10, terms + 1)) return null;
  return fitPoly(samples.map(s => s.feat), samples.map(s => s.target),
      {degree: spec.mapping.degree, lambda: spec.mapping.lambda});
}

function gatherCalibration(session, frames, calibBlockId, spec, geomFor, stats) {
  const samples = [];
  for (const tg of session.timeline.targets) {
    if (tg.blockId !== calibBlockId || tg.role !== 'calibration') continue;
    const sub = spec.calibration.subset;
    if (sub !== 'all' && sub !== '25' && !(tg.subsets || []).includes(sub)) continue;
    const [t0, t1] = windowOf(tg, spec);
    const geom = geomFor(tg.blockId);
    for (const f of slice(frames, t0, t1)) {
      const c = classify(f, [tg.x, tg.y], spec, session.gp3, geom);
      stats.total++;
      if (c !== 'ok') { stats.rejected++; continue; }
      samples.push({feat: f.feat, target: [tg.x, tg.y], targetId: tg.id});
    }
  }
  if (spec.calibration.aggregate === 'target-mean') {
    const by = new Map();
    for (const s of samples) {
      if (!by.has(s.targetId)) by.set(s.targetId, []);
      by.get(s.targetId).push(s);
    }
    return [...by.values()].map(g => ({
      feat: g[0].feat.map((_, j) => mean(g.map(s => s.feat[j]))),
      target: g[0].target, targetId: g[0].targetId,
    }));
  }
  return samples;
}

export function runPipeline(session, specIn) {
  const spec = normaliseSpec(specIn);
  const hash = specHash(spec);
  const screen = session.manifest.screen;
  const geomCache = new Map();
  const {frames, meta, reference} = buildFrames(session, spec);
  const dist = makeDistanceResolver(session, spec, frames, meta, reference);
  const geomFor = id => {
    if (!geomCache.has(id)) geomCache.set(id, new ScreenGeometry(screen, dist.mm(id)));
    return geomCache.get(id);
  };
  const blockList = [...session.timeline.blocks.values()].sort((a, b) => a.t - b.t);
  const base = {
    session: session.manifest.sessionId, participant: session.manifest.participant.id,
    split: session.split, tag: spec.tag, spec_hash: hash, camera: reference ? 'gp3' : spec.camera,
  };

  // Calibration model per calibration-source block.
  const models = new Map();
  const calibInfo = new Map();
  if (!reference) {
    for (const b of blockList) {
      const src = b.calibrationFrom || b.id;
      if (models.has(src)) continue;
      const stats = {total: 0, rejected: 0};
      const samples = gatherCalibration(session, frames, src, spec, geomFor, stats);
      calibInfo.set(src, {n: samples.length, targets: new Set(samples.map(s => s.targetId)).size, ...stats});
      models.set(src, samples.length ? fitFor(samples, spec) : null);
    }
  }

  // Predicted gaze stream per block (filtered), keyed by frame time.
  const predAt = new Map();
  blockList.forEach((b, bi) => {
    const tEnd = bi + 1 < blockList.length ? blockList[bi + 1].t : Infinity;
    const model = models.get(b.calibrationFrom || b.id);
    if (!reference && !model) return;
    const filter = createFilter(reference ? {type: 'none'} : spec.filter);
    let lastT = -Infinity;
    for (const f of slice(frames, b.t, tEnd)) {
      if (!f.ok || (!f.directPred && (!f.feat || f.ear < spec.gating.blinkEar))) continue;
      if (f.t - lastT > GAP_RESET_MS) filter.reset();
      lastT = f.t;
      const raw = f.directPred || predictPoly(model, f.feat);
      predAt.set(f, filter.step(f.t, raw));
    }
  });

  const rows = [];
  const mk = (tg, extra) => {
    const b = session.timeline.blocks.get(tg.blockId);
    return {
      ...base, block: tg.blockId, lighting: b?.condition?.lighting ?? '',
      distance_cm: b?.distanceCmMeasured ?? b?.condition?.distance_cm ?? '',
      role: tg.role, rep: tg.rep ?? '', set: tg.set ?? '',
      calibration_from: b?.calibrationFrom ?? '', ...extra,
    };
  };

  const pooled = new Map();  // block|role|rep -> {errs, rows}
  for (const tg of session.timeline.targets) {
    if (tg.role === 'calibration') continue;
    const model = models.get(session.timeline.blocks.get(tg.blockId)?.calibrationFrom || tg.blockId);
    const fitOk = reference || !!model;
    const geom = geomFor(tg.blockId);
    const [t0, t1] = windowOf(tg, spec);
    const inWin = slice(frames, t0, t1);
    const cnt = {noface: 0, blink: 0, gp3: 0, ok: 0};
    const usable = [];
    for (const f of inWin) {
      const tgt = tg.kind === 'pursuit' ?
          (p => [p.nx * screen.widthPx, p.ny * screen.heightPx])(pursuitPosition(tg.path, f.t - tg.tOn)) :
          [tg.x, tg.y];
      const c = classify(f, tgt, spec, session.gp3, geom);
      cnt[c]++;
      if (c === 'ok' && predAt.has(f)) usable.push({t: f.t, pred: predAt.get(f), tgt});
    }
    const common = {
      target_id: tg.id, level: 'target', tx_px: tg.x ?? '', ty_px: tg.y ?? '',
      n_expected: inWin.length, n_used: usable.length,
      n_noface: cnt.noface, n_blink: cnt.blink, n_gp3gated: cnt.gp3,
      loss: inWin.length ? 1 - usable.length / inWin.length : NaN,
      fit_ok: fitOk ? 1 : 0,
    };
    if (!fitOk || !usable.length) {
      rows.push(mk(tg, common));
      continue;
    }
    if (tg.kind === 'pursuit') {
      const errs = usable.map(u => geom.angleBetween(u.pred, u.tgt));
      const lag = estimateLagMs(usable.map(u => ({
        t: u.t, pred: u.pred,
        targetAt: tt => {
          const p = pursuitPosition(tg.path, tt - tg.tOn);
          return [p.nx * screen.widthPx, p.ny * screen.heightPx];
        },
      })));
      rows.push(mk(tg, {
        ...common, mean_err_deg: mean(errs), median_err_deg: median(errs),
        p95_err_deg: quantile(errs, 0.95), rms_err_deg: Math.sqrt(mean(errs.map(e => e * e))),
        lag_ms: lag,
      }));
      continue;
    }
    const m = targetMetrics(geom, usable.map(u => u.pred), [tg.x, tg.y]);
    rows.push(mk(tg, {
      ...common, ...m,
      ms_per_frame: mean(inWin.map(f => f.ms).filter(Number.isFinite)),
    }));
    const key = `${tg.blockId}|${tg.role}|${tg.rep}`;
    if (!pooled.has(key)) pooled.set(key, {tg, errs: [], rows: []});
    const p = pooled.get(key);
    p.errs.push(...usable.map(u => geom.angleBetween(u.pred, [tg.x, tg.y])));
    p.rows.push(rows[rows.length - 1]);
  }

  // Pooled rows: mean of per-target metrics + pooled error percentiles.
  for (const {tg, errs, rows: rs} of pooled.values()) {
    const num = k => rs.map(r => r[k]).filter(Number.isFinite);
    const exp = rs.reduce((s, r) => s + r.n_expected, 0);
    const used = rs.reduce((s, r) => s + r.n_used, 0);
    rows.push(mk(tg, {
      target_id: 'ALL', level: 'pooled', n_expected: exp, n_used: used,
      n_noface: rs.reduce((s, r) => s + r.n_noface, 0),
      n_blink: rs.reduce((s, r) => s + r.n_blink, 0),
      n_gp3gated: rs.reduce((s, r) => s + r.n_gp3gated, 0),
      loss: exp ? 1 - used / exp : NaN, fit_ok: 1,
      accuracy_deg: mean(num('accuracy_deg')), mean_err_deg: mean(errs),
      median_err_deg: median(errs), p95_err_deg: quantile(errs, 0.95),
      precision_sd_deg: mean(num('precision_sd_deg')),
      precision_rms_s2s_deg: mean(num('precision_rms_s2s_deg')),
      ms_per_frame: mean(num('ms_per_frame')),
    }));
  }

  // Session-level QC.
  const qc = {session: base.session, tag: spec.tag, spec_hash: hash,
    gp3: session.gp3?.quality ?? null, calibration: Object.fromEntries(calibInfo)};
  qc.distance = Object.fromEntries(blockList.map(b => [b.id, {cm: dist.mm(b.id) / 10, source: dist.source(b.id), irisCm: dist.irisCm[b.id]}]));
  return {rows, qc, spec, specHash: hash};
}

/** Leave-one-target-out cross-validation on calibration targets (for tuning on dev data). */
export function runCv(session, specIn) {
  const spec = normaliseSpec(specIn);
  if (spec.model.runtime === 'gp3') throw new Error('cv not defined for gp3 reference');
  const {frames, meta, reference} = buildFrames(session, spec);
  const rows = [];
  const dist = makeDistanceResolver(session, spec, frames, meta, reference);
  const geomFor = id => new ScreenGeometry(session.manifest.screen, dist.mm(id));
  for (const b of session.timeline.blocks.values()) {
    if (b.calibrationFrom) continue;
    const stats = {total: 0, rejected: 0};
    const samples = gatherCalibration(session, frames, b.id, spec, geomFor, stats);
    const ids = [...new Set(samples.map(s => s.targetId))];
    for (const id of ids) {
      const train = samples.filter(s => s.targetId !== id);
      const test = samples.filter(s => s.targetId === id);
      const model = fitFor(train, spec);
      if (!model) continue;
      const preds = test.map(s => predictPoly(model, s.feat));
      const m = targetMetrics(geomFor(b.id), preds, test[0].target);
      rows.push({session: session.manifest.sessionId, participant: session.manifest.participant.id,
        split: session.split, tag: spec.tag, spec_hash: specHash(spec), block: b.id,
        role: 'cv', target_id: id, level: 'target', ...m});
    }
  }
  return {rows};
}
