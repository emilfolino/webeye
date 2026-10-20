// Small numeric helpers shared by metrics and tooling.
export const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
export function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}
export function quantile(a, q) {
  if (!a.length) return NaN;
  const s = a.slice().sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = a => quantile(a, 0.5);
