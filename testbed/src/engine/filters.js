// Temporal filters over a time-ordered stream of 2D gaze estimates (screen px).
// Each filter is a stateful object with reset() and step(t_ms, [x, y]).

class Identity {
  reset() {}
  step(t, p) { return p; }
}

class MovingAverage {
  constructor({window = 5}) { this.n = window; this.buf = []; }
  reset() { this.buf = []; }
  step(t, p) {
    this.buf.push(p);
    if (this.buf.length > this.n) this.buf.shift();
    const m = this.buf.length;
    return [this.buf.reduce((s, q) => s + q[0], 0) / m,
            this.buf.reduce((s, q) => s + q[1], 0) / m];
  }
}

const median = a => {
  const s = a.slice().sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

class MedianFilter {
  constructor({window = 5}) { this.n = window; this.buf = []; }
  reset() { this.buf = []; }
  step(t, p) {
    this.buf.push(p);
    if (this.buf.length > this.n) this.buf.shift();
    return [median(this.buf.map(q => q[0])), median(this.buf.map(q => q[1]))];
  }
}

/** One Euro filter (Casiez et al., CHI 2012). */
class OneEuro {
  constructor({minCutoff = 1.0, beta = 0.007, dCutoff = 1.0}) {
    Object.assign(this, {minCutoff, beta, dCutoff});
    this.reset();
  }
  reset() { this.prev = null; this.prevT = null; this.dPrev = [0, 0]; }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  step(t, p) {
    if (this.prev === null) {
      this.prev = p;
      this.prevT = t;
      return p;
    }
    const dt = Math.max((t - this.prevT) / 1000, 1e-3);
    const out = [0, 0];
    for (let i = 0; i < 2; i++) {
      const d = (p[i] - this.prev[i]) / dt;
      const aD = OneEuro.alpha(this.dCutoff, dt);
      const dHat = aD * d + (1 - aD) * this.dPrev[i];
      this.dPrev[i] = dHat;
      const cutoff = this.minCutoff + this.beta * Math.abs(dHat);
      const a = OneEuro.alpha(cutoff, dt);
      out[i] = a * p[i] + (1 - a) * this.prev[i];
    }
    this.prev = out;
    this.prevT = t;
    return out;
  }
}

export function createFilter(spec = {type: 'none'}) {
  switch (spec.type) {
    case 'none': return new Identity();
    case 'moving-average': return new MovingAverage(spec);
    case 'median': return new MedianFilter(spec);
    case 'one-euro': return new OneEuro(spec);
    default: throw new Error(`Unknown filter "${spec.type}"`);
  }
}
