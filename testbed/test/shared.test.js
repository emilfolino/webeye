import test from 'node:test';
import assert from 'node:assert/strict';
import {balancedLatinSquare, buildSchedule, resolvePointSet, pursuitPosition} from '../src/shared/protocol.js';
import {fitPoly, predictPoly, monomialExponents} from '../src/shared/mapping.js';
import {ScreenGeometry} from '../src/shared/geometry.js';
import {mulberry32} from '../src/shared/rng.js';
import {protocol} from './helpers.js';

test('balanced Latin square: every condition once per row and column; first-order carryover balanced for even n', () => {
  for (const n of [2, 4, 6]) {
    const sq = balancedLatinSquare(n);
    for (const row of sq) assert.equal(new Set(row).size, n);
    for (let c = 0; c < n; c++) assert.equal(new Set(sq.map(r => r[c])).size, n);
    const pairs = new Map();
    for (const row of sq) for (let i = 1; i < n; i++) {
      const k = `${row[i - 1]}>${row[i]}`;
      pairs.set(k, (pairs.get(k) || 0) + 1);
    }
    assert.equal(pairs.size, n * (n - 1));
    for (const v of pairs.values()) assert.equal(v, 1);
  }
  assert.equal(balancedLatinSquare(3).length, 6);  // odd n needs mirrored rows
});

test('point sets: grid subsets nest, validation points avoid calibration points, deterministic', () => {
  const cal = resolvePointSet(protocol, 'cal25');
  assert.equal(cal.length, 25);
  const sub = k => cal.filter(p => p.subsets.includes(k)).length;
  assert.deepEqual([sub('4'), sub('5'), sub('9'), sub('13')], [4, 5, 9, 13]);
  const val = resolvePointSet(protocol, 'val16');
  assert.equal(val.length, 16);
  for (const v of val) for (const c of cal) {
    assert.ok(Math.hypot(v.nx - c.nx, v.ny - c.ny) >= 0.05 - 1e-12);
  }
  assert.deepEqual(resolvePointSet(protocol, 'val16'), val);
});

test('schedule: deterministic, per-participant order differs, block order counterbalanced', () => {
  const s = {width: 1920, height: 1080};
  const a = buildSchedule(protocol, s, 0), b = buildSchedule(protocol, s, 0), c = buildSchedule(protocol, s, 1);
  assert.deepEqual(a, b);
  const order = sch => sch.filter(e => e.type === 'block_start').map(e => e.blockId);
  assert.notDeepEqual(order(a), order(c));
  assert.equal(order(a)[0], 'normal-60');
  assert.equal(order(a).at(-1), 'normal-60-retest');
  const cal = a.filter(e => e.type === 'target' && e.role === 'calibration' && e.blockId === 'normal-60');
  assert.equal(cal.length, 25);
  const calC = c.filter(e => e.type === 'target' && e.role === 'calibration' && e.blockId === 'normal-60');
  assert.notDeepEqual(cal.map(e => e.index), calC.map(e => e.index));  // shuffled per participant
});

test('pursuit path stays inside the screen', () => {
  const p = protocol.stepTemplates.standard.find(x => x.kind === 'pursuit').path;
  for (let t = 0; t < 20000; t += 100) {
    const {nx, ny} = pursuitPosition(p, t);
    assert.ok(nx > 0.05 && nx < 0.95 && ny > 0.05 && ny < 0.95);
  }
});

test('fitPoly recovers a quadratic map and generalises', () => {
  const r = mulberry32(3);
  const f = ([a, b]) => [100 + 300 * a + 50 * a * b + 20 * b * b, -40 + 200 * b - 30 * a * a];
  const X = Array.from({length: 300}, () => [r() * 2 - 1, r() * 2 - 1]);
  const m = fitPoly(X, X.map(f), {degree: 2, lambda: 1e-8});
  for (let i = 0; i < 20; i++) {
    const x = [r() * 2 - 1, r() * 2 - 1];
    const p = predictPoly(m, x), y = f(x);
    assert.ok(Math.abs(p[0] - y[0]) < 1e-2 && Math.abs(p[1] - y[1]) < 1e-2);
  }
  assert.equal(monomialExponents(2, 2).length, 6);
  assert.equal(monomialExponents(4, 2).length, 15);
});

test('fitPoly: ridge shrinks coefficients; lambda=0 with collinear columns still solves', () => {
  const r = mulberry32(5);
  const X = Array.from({length: 50}, () => {const a = r(); return [a, 2 * a];});  // collinear
  const Y = X.map(([a]) => [10 * a, -5 * a]);
  const m0 = fitPoly(X, Y, {degree: 1, lambda: 0});
  assert.ok(Math.abs(predictPoly(m0, [0.5, 1])[0] - 5) < 1e-3);
  const X2 = Array.from({length: 50}, () => [r(), r()]);
  const Y2 = X2.map(([a, b]) => [10 * a + b, a - b]);
  const norm = m => m.coef.reduce((s, c) => s + c[0] ** 2, 0);
  assert.ok(norm(fitPoly(X2, Y2, {degree: 1, lambda: 10})) < norm(fitPoly(X2, Y2, {degree: 1, lambda: 0})));
});

test('ScreenGeometry: ray angles', () => {
  const g = new ScreenGeometry({widthPx: 1000, heightPx: 500, widthMm: 500, heightMm: 250}, 600);
  assert.ok(Math.abs(g.angleBetween([500, 250], [500, 250])) < 1e-9);
  // 1 degree at centre ~ 600*tan(1deg) = 10.47 mm = 20.9 px
  const px = 600 * Math.tan(Math.PI / 180) / 0.5;
  assert.ok(Math.abs(g.angleBetween([500, 250], [500 + px, 250]) - 1) < 1e-6);
  // eccentric: same px offset subtends fewer degrees than at centre
  assert.ok(g.angleBetween([900, 250], [900 + px, 250]) < 1);
  assert.ok(Math.abs(g.pixelsPerDegreeAtCentre() - 600 * Math.tan(Math.PI / 180) / 0.5) < 0.5);
});

test('quick protocol yields calibration, validation and pursuit steps', async () => {
  const {readFileSync} = await import('node:fs');
  const {buildSchedule} = await import('../src/shared/protocol.js');
  const p = JSON.parse(readFileSync(new URL('../protocols/webeye-quick.protocol.json', import.meta.url), 'utf8'));
  const s = buildSchedule(p, {width: 1920, height: 1080}, 0);
  const roles = r => s.filter(x => x.role === r).length;
  assert.equal(roles('calibration'), 9);
  assert.equal(roles('validation'), 8);
  assert.equal(roles('pursuit'), 1);
});
