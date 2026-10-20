// Ridge-regularised polynomial gaze mapping: feature vector -> screen (x, y).
// Shared by the live demo harness and the offline replay engine so there is a
// single implementation. Uses Cholesky on standardised features (numerically
// safer than the raw normal equations with Gaussian elimination).

/** Exponent tuples of all monomials of total degree <= degree in k variables. */
export function monomialExponents(k, degree) {
  const out = [];
  const rec = (i, remaining, cur) => {
    if (i === k) {
      out.push(cur.slice());
      return;
    }
    for (let e = 0; e <= remaining; e++) {
      cur.push(e);
      rec(i + 1, remaining - e, cur);
      cur.pop();
    }
  };
  rec(0, degree, []);
  // Order by total degree so the intercept is first and the layout is stable.
  out.sort((a, b) => a.reduce((s, v) => s + v, 0) - b.reduce((s, v) => s + v, 0));
  return out;
}

function expand(x, exps) {
  return exps.map(e => e.reduce((p, pow, i) => p * Math.pow(x[i], pow), 1));
}

/** Solve (A + 0) X = B for symmetric positive definite A via Cholesky. */
export function choleskySolve(A, B) {
  const n = A.length;
  const L = Array.from({length: n}, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) {
        if (s <= 0) throw new Error('Matrix not positive definite');
        L[i][i] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  const m = B[0].length;
  const X = Array.from({length: n}, () => new Float64Array(m));
  for (let c = 0; c < m; c++) {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = B[i][c];
      for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
      y[i] = s / L[i][i];
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < n; k++) s -= L[k][i] * X[k][c];
      X[i][c] = s / L[i][i];
    }
  }
  return X;
}

/**
 * Fit a ridge polynomial map.
 * @param X n x k raw feature rows
 * @param Y n x 2 targets (screen px)
 * @param opts {degree=2, lambda=1e-3}; lambda penalises (XtX/n) on standardised
 *   columns, so it is comparable across sample counts. The intercept is free.
 */
export function fitPoly(X, Y, {degree = 2, lambda = 1e-3} = {}) {
  const n = X.length;
  if (n === 0) throw new Error('fitPoly: no samples');
  const k = X[0].length;
  const exps = monomialExponents(k, degree);
  const nTerms = exps.length - 1;  // drop constant term
  if (nTerms < 1) throw new Error('fitPoly: degree must be >= 1');

  // Standardise raw inputs first so high-degree terms stay well scaled.
  const inMean = new Float64Array(k), inScale = new Float64Array(k);
  for (let j = 0; j < k; j++) {
    for (const r of X) inMean[j] += r[j] / n;
    let v = 0;
    for (const r of X) v += (r[j] - inMean[j]) ** 2 / n;
    inScale[j] = Math.sqrt(v) || 1;
  }
  const Z = X.map(r => r.map((v, j) => (v - inMean[j]) / inScale[j]));
  const P = Z.map(z => expand(z, exps).slice(1));

  const colMean = new Float64Array(nTerms), colScale = new Float64Array(nTerms);
  for (let j = 0; j < nTerms; j++) {
    for (const r of P) colMean[j] += r[j] / n;
    let v = 0;
    for (const r of P) v += (r[j] - colMean[j]) ** 2 / n;
    colScale[j] = Math.sqrt(v) || 1;
  }
  const S = P.map(r => r.map((v, j) => (v - colMean[j]) / colScale[j]));
  const yMean = [0, 0];
  for (const y of Y) {
    yMean[0] += y[0] / n;
    yMean[1] += y[1] / n;
  }

  const G = Array.from({length: nTerms}, () => new Float64Array(nTerms));
  const R = Array.from({length: nTerms}, () => new Float64Array(2));
  for (let i = 0; i < n; i++) {
    const s = S[i];
    for (let a = 0; a < nTerms; a++) {
      R[a][0] += s[a] * (Y[i][0] - yMean[0]);
      R[a][1] += s[a] * (Y[i][1] - yMean[1]);
      for (let b = 0; b <= a; b++) G[a][b] += s[a] * s[b];
    }
  }
  for (let a = 0; a < nTerms; a++) {
    for (let b = 0; b < a; b++) G[b][a] = G[a][b];
    // Tiny jitter keeps lambda=0 solvable when columns are collinear.
    G[a][a] += n * lambda + 1e-9 * n;
  }
  const W = choleskySolve(G, R);
  return {
    degree, lambda, k, exps, inMean, inScale, colMean, colScale, yMean,
    coef: W.map(r => [r[0], r[1]]),
  };
}

export function predictPoly(model, x) {
  const z = Array.from(x, (v, j) => (v - model.inMean[j]) / model.inScale[j]);
  const p = expand(z, model.exps).slice(1);
  let sx = model.yMean[0], sy = model.yMean[1];
  for (let j = 0; j < p.length; j++) {
    const s = (p[j] - model.colMean[j]) / model.colScale[j];
    sx += s * model.coef[j][0];
    sy += s * model.coef[j][1];
  }
  return [sx, sy];
}
