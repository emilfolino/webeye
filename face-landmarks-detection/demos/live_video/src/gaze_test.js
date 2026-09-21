import {TEST_CONFIG, NUM_KEYPOINTS} from './shared/params';

function dist2d(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function features(iX, iY) {
  return [1, iX, iY, iX * iY, iX * iX, iY * iY];
}

// Solve (A^T A) x = A^T b via Gaussian elimination with partial pivoting.
// A: number[][] (n×6), b: number[] (n). Returns Float64Array(6).
function solveLS(A, b) {
  const m = 6;
  const n = A.length;
  const M = Array.from({length: m}, () => new Float64Array(m + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      M[j][m] += A[i][j] * b[i];
      for (let k = 0; k < m; k++) {
        M[j][k] += A[i][j] * A[i][k];
      }
    }
  }
  for (let col = 0; col < m; col++) {
    let maxRow = col;
    for (let row = col + 1; row < m; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) continue;
    for (let row = col + 1; row < m; row++) {
      const factor = M[row][col] / M[col][col];
      for (let k = col; k <= m; k++) {
        M[row][k] -= factor * M[col][k];
      }
    }
  }
  const x = new Float64Array(m);
  for (let i = m - 1; i >= 0; i--) {
    let s = M[i][m];
    for (let j = i + 1; j < m; j++) s -= M[i][j] * x[j];
    x[i] = Math.abs(M[i][i]) < 1e-12 ? 0 : s / M[i][i];
  }
  return x;
}

export class GazeTest {
  constructor() {
    this.state = 'idle';
    this.canvasWidth = 0;
    this.canvasHeight = 0;
    this._runLabel = '';
    this.currentTargetIdx = 0;
    this.targetStartTime = null;
    this.currentSamples = [];
    this.calibrationData = [];
    this.validationData = [];
    this.allSamples = [];
    this.coeffX = null;
    this.coeffY = null;
    this._ppdSum = 0;
    this._ppdCount = 0;
    this.metrics = null;
  }

  get pixelsPerDegree() {
    return this._ppdCount > 0 ? this._ppdSum / this._ppdCount : null;
  }

  start(canvasWidth, canvasHeight, runLabel) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this._runLabel = runLabel || '';
    this.state = 'calibrating';
    this.currentTargetIdx = 0;
    this.targetStartTime = null;
    this.currentSamples = [];
    this.calibrationData = [];
    this.validationData = [];
    this.allSamples = [];
    this.coeffX = null;
    this.coeffY = null;
    this._ppdSum = 0;
    this._ppdCount = 0;
    this.metrics = null;
  }

  recordFrame(leftIris, rightIris, timestamp, keypoints) {
    if (this.state === 'idle' || this.state === 'done') return;
    if (!leftIris || !rightIris) return;

    if (this.targetStartTime === null) {
      this.targetStartTime = timestamp;
      return;
    }

    this._updatePPD(keypoints);

    const elapsed = timestamp - this.targetStartTime;
    const target = this._currentTarget();

    if (elapsed >= TEST_CONFIG.TOTAL_TARGET_MS) {
      this._finishTarget();
      this._advance();
      return;
    }

    if (elapsed >= TEST_CONFIG.SETTLE_MS) {
      const iXscreen = this.canvasWidth - (leftIris.x + rightIris.x) / 2;
      const iYscreen = (leftIris.y + rightIris.y) / 2;
      const sample = {
        timestamp,
        leftIrisX: leftIris.x,
        leftIrisY: leftIris.y,
        rightIrisX: rightIris.x,
        rightIrisY: rightIris.y,
        iXscreen,
        iYscreen,
        targetX: target.x,
        targetY: target.y,
        phase: this.state,
      };
      this.currentSamples.push(sample);
      this.allSamples.push(sample);
    }
  }

  drawOverlay(ctx, W, H) {
    if (this.state === 'idle') return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (this.state === 'calibrating' || this.state === 'validating') {
      const target = this._currentTarget();
      const phase = this.state === 'calibrating' ? 'Calibration' : 'Validation';
      const total = this.state === 'calibrating' ?
          TEST_CONFIG.CALIBRATION_POINTS :
          TEST_CONFIG.VALIDATION_POINTS;

      const now = performance.now();
      const elapsed = this.targetStartTime !== null ? now - this.targetStartTime : 0;
      const collecting = elapsed >= TEST_CONFIG.SETTLE_MS;
      const settleProgress = Math.min(elapsed / TEST_CONFIG.SETTLE_MS, 1);

      ctx.beginPath();
      ctx.arc(target.x, target.y, TEST_CONFIG.DOT_RADIUS, 0, 2 * Math.PI);
      ctx.fillStyle = collecting ?
          '#FF3B30' :
          `rgba(255,59,48,${(0.3 + 0.5 * settleProgress).toFixed(2)})`;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(target.x, target.y, TEST_CONFIG.DOT_INNER_RADIUS, 0, 2 * Math.PI);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      ctx.font = 'bold 18px monospace';
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${phase} ${this.currentTargetIdx + 1}/${total}`, 12, H - 8);

      if (!collecting) {
        ctx.font = '16px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('Look at the dot', W / 2, 10);
      }
    }

    if (this.state === 'done' && this.metrics) {
      this._drawResultsOverlay(ctx, W, H);
    }

    ctx.restore();
  }

  getMetrics() {
    return this.metrics;
  }

  exportCSV() {
    const label = this._runLabel || 'unnamed';
    const now = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `gaze_test_${label}_${now}.csv`;

    const header = `# run: ${label}\ntimestamp,leftIrisX,leftIrisY,rightIrisX,rightIrisY,iXscreen,iYscreen,targetX,targetY,phase`;
    const rows = this.allSamples.map(
        s => [
          s.timestamp.toFixed(1),
          s.leftIrisX.toFixed(2),
          s.leftIrisY.toFixed(2),
          s.rightIrisX.toFixed(2),
          s.rightIrisY.toFixed(2),
          s.iXscreen.toFixed(2),
          s.iYscreen.toFixed(2),
          s.targetX.toFixed(2),
          s.targetY.toFixed(2),
          s.phase,
        ].join(','));

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], {type: 'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  _getCalibrationTargets() {
    const W = this.canvasWidth, H = this.canvasHeight;
    const m = TEST_CONFIG.GRID_MARGIN;
    const xs = [m * W, 0.5 * W, (1 - m) * W];
    const ys = [m * H, 0.5 * H, (1 - m) * H];
    const pts = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        pts.push({x: xs[c], y: ys[r]});
      }
    }
    return pts;
  }

  _getValidationTargets() {
    const W = this.canvasWidth, H = this.canvasHeight;
    const m = TEST_CONFIG.VALIDATION_MARGIN;
    return [
      {x: 0.5 * W, y: 0.5 * H},
      {x: m * W, y: m * H},
      {x: (1 - m) * W, y: m * H},
      {x: (1 - m) * W, y: (1 - m) * H},
      {x: m * W, y: (1 - m) * H},
    ];
  }

  _currentTarget() {
    const targets = this.state === 'calibrating' ?
        this._getCalibrationTargets() :
        this._getValidationTargets();
    return targets[this.currentTargetIdx];
  }

  _finishTarget() {
    const data = {samples: [...this.currentSamples], target: this._currentTarget()};
    if (this.state === 'calibrating') {
      this.calibrationData.push(data);
    } else {
      this.validationData.push(data);
    }
  }

  _advance() {
    this.currentTargetIdx++;
    this.targetStartTime = null;
    this.currentSamples = [];

    if (this.state === 'calibrating' &&
        this.currentTargetIdx >= TEST_CONFIG.CALIBRATION_POINTS) {
      this._computeMapping();
      this.state = 'validating';
      this.currentTargetIdx = 0;
    } else if (
        this.state === 'validating' &&
        this.currentTargetIdx >= TEST_CONFIG.VALIDATION_POINTS) {
      this._computeMetrics();
      this.state = 'done';
    }
  }

  _updatePPD(keypoints) {
    const BASE = NUM_KEYPOINTS;
    if (keypoints.length <= BASE + 4) return;
    const kp = keypoints;
    const diamX = dist2d(kp[BASE + 1].x, kp[BASE + 1].y, kp[BASE + 3].x, kp[BASE + 3].y);
    const diamY = dist2d(kp[BASE + 2].x, kp[BASE + 2].y, kp[BASE + 4].x, kp[BASE + 4].y);
    if (diamX > 0 && diamY > 0) {
      this._ppdSum += (diamX + diamY) / 2 / TEST_CONFIG.IRIS_SUBTEND_DEG;
      this._ppdCount++;
    }
  }

  _computeMapping() {
    const A = [], bx = [], by = [];
    for (const {samples, target} of this.calibrationData) {
      for (const s of samples) {
        A.push(features(s.iXscreen, s.iYscreen));
        bx.push(target.x);
        by.push(target.y);
      }
    }
    if (A.length < 6) return;
    this.coeffX = solveLS(A, bx);
    this.coeffY = solveLS(A, by);
  }

  _predictGaze(iXscreen, iYscreen) {
    const f = features(iXscreen, iYscreen);
    let screenX = 0, screenY = 0;
    for (let i = 0; i < 6; i++) {
      screenX += f[i] * this.coeffX[i];
      screenY += f[i] * this.coeffY[i];
    }
    return {screenX, screenY};
  }

  _computeMetrics() {
    if (!this.coeffX || !this.coeffY) return;
    const ppd = this.pixelsPerDegree || 1;
    const perTarget = [];
    const allErrors = [];

    for (const {samples, target} of this.validationData) {
      if (samples.length === 0) {
        perTarget.push({
          target,
          accuracyPx: NaN,
          accuracyDeg: NaN,
          precisionPx: NaN,
          precisionDeg: NaN,
          sampleCount: 0,
        });
        continue;
      }

      const preds = samples.map(s => this._predictGaze(s.iXscreen, s.iYscreen));
      const meanPredX = preds.reduce((sum, p) => sum + p.screenX, 0) / preds.length;
      const meanPredY = preds.reduce((sum, p) => sum + p.screenY, 0) / preds.length;
      const accuracyPx = dist2d(meanPredX, meanPredY, target.x, target.y);
      const precisionPx = Math.sqrt(
          preds.reduce(
              (sum, p) =>
                  sum + dist2d(p.screenX, p.screenY, meanPredX, meanPredY) ** 2,
              0) /
          preds.length);

      for (const p of preds) {
        allErrors.push(dist2d(p.screenX, p.screenY, target.x, target.y));
      }

      perTarget.push({
        target,
        accuracyPx,
        accuracyDeg: accuracyPx / ppd,
        precisionPx,
        precisionDeg: precisionPx / ppd,
        sampleCount: samples.length,
      });
    }

    const validTargets = perTarget.filter(t => !isNaN(t.accuracyPx));
    const meanAccuracyPx = validTargets.length ?
        validTargets.reduce((sum, t) => sum + t.accuracyPx, 0) / validTargets.length :
        NaN;
    const meanPrecisionPx = validTargets.length ?
        validTargets.reduce((sum, t) => sum + t.precisionPx, 0) / validTargets.length :
        NaN;
    allErrors.sort((a, b) => a - b);
    const p95AccuracyPx = allErrors.length ?
        allErrors[Math.min(Math.floor(0.95 * allErrors.length), allErrors.length - 1)] :
        NaN;

    this.metrics = {
      perTarget,
      meanAccuracyPx,
      meanAccuracyDeg: meanAccuracyPx / ppd,
      p95AccuracyPx,
      p95AccuracyDeg: p95AccuracyPx / ppd,
      meanPrecisionPx,
      meanPrecisionDeg: meanPrecisionPx / ppd,
      pixelsPerDegree: ppd,
    };
  }

  _drawResultsOverlay(ctx, W, H) {
    const m = this.metrics;
    const lines = [
      `Mean accuracy:  ${m.meanAccuracyPx.toFixed(1)} px  /  ${m.meanAccuracyDeg.toFixed(2)}°`,
      `P95  accuracy:  ${m.p95AccuracyPx.toFixed(1)} px  /  ${m.p95AccuracyDeg.toFixed(2)}°`,
      `Precision:      ${m.meanPrecisionPx.toFixed(1)} px  /  ${m.meanPrecisionDeg.toFixed(2)}°`,
      `Pixels/degree:  ${m.pixelsPerDegree.toFixed(1)}`,
    ];

    const lineH = 22;
    const pad = 16;
    const panelW = 360;
    const titleH = 28;
    const panelH = titleH + lines.length * lineH + pad * 2;
    const x = W / 2 - panelW / 2;
    const y = H / 2 - panelH / 2;

    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(x, y, panelW, panelH);

    ctx.font = 'bold 15px monospace';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Eye Tracking Results', x + pad, y + pad);

    ctx.font = '14px monospace';
    ctx.fillStyle = '#AAFFAA';
    lines.forEach((line, i) => {
      ctx.fillText(line, x + pad, y + pad + titleH + i * lineH);
    });
  }
}
