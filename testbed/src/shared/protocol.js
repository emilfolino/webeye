// Declarative study protocol -> concrete stimulus schedule.
// Pure functions only: used by the browser recorder and by Node tooling, so
// the schedule a participant saw can always be re-derived from
// (protocol, screen size, participantIndex).
import {hashString, mulberry32, shuffled} from './rng.js';

/** Balanced Latin square (Williams design) rows for n conditions. */
export function balancedLatinSquare(n) {
  if (n <= 0) return [];
  const rows = [];
  const first = [0];
  for (let i = 1, lo = 1, hi = n - 1; i < n; i++) {
    first.push(i % 2 === 1 ? lo++ : hi--);
  }
  for (let r = 0; r < n; r++) rows.push(first.map(v => (v + r) % n));
  if (n % 2 === 1) {
    for (let r = 0; r < n; r++) rows.push(rows[r].slice().reverse());
  }
  return rows;
}

/** Normalised (0..1) points of a named point set. Deterministic per protocol. */
export function resolvePointSet(protocol, name, _stack = []) {
  const def = protocol.pointSets[name];
  if (!def) throw new Error(`Unknown point set "${name}"`);
  if (_stack.includes(name)) throw new Error(`Cyclic point set "${name}"`);
  if (def.type === 'fixed') {
    return def.points.map(([nx, ny], index) => ({nx, ny, index, subsets: []}));
  }
  if (def.type === 'grid') {
    const {rows, cols, margin} = def;
    const pts = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const nx = cols === 1 ? 0.5 : margin + (1 - 2 * margin) * c / (cols - 1);
        const ny = rows === 1 ? 0.5 : margin + (1 - 2 * margin) * r / (rows - 1);
        const subsets = Object.entries(def.subsets || {})
            .filter(([, cells]) => cells.some(([cr, cc]) => cr === r && cc === c))
            .map(([k]) => k);
        pts.push({nx, ny, index: pts.length, row: r, col: c, subsets});
      }
    }
    return pts;
  }
  if (def.type === 'jitter') {
    const rand = mulberry32((protocol.seed ^ hashString('pointset:' + name)) >>> 0);
    const avoid = def.avoid ?
        resolvePointSet(protocol, def.avoid, [..._stack, name]) : [];
    const pts = [];
    let guard = 0;
    while (pts.length < def.n) {
      if (++guard > 100000) {
        throw new Error(`Cannot place ${def.n} points in "${name}"; relax constraints`);
      }
      const nx = def.margin + (1 - 2 * def.margin) * rand();
      const ny = def.margin + (1 - 2 * def.margin) * rand();
      const far = (p, d) => Math.hypot(p.nx - nx, p.ny - ny) >= d;
      if (pts.every(p => far(p, def.minSep)) &&
          avoid.every(p => far(p, def.avoidDist || 0))) {
        pts.push({nx, ny, index: pts.length, subsets: []});
      }
    }
    return pts;
  }
  throw new Error(`Unknown point set type "${def.type}"`);
}

/** Pursuit target position (normalised) at tMs after pursuit onset. */
export function pursuitPosition(path, tMs) {
  const t = tMs / 1000;
  if (path.type !== 'lissajous') throw new Error(`Unknown path ${path.type}`);
  return {
    nx: 0.5 + path.ax * Math.sin(2 * Math.PI * path.fx * t + (path.phase || 0)),
    ny: 0.5 + path.ay * Math.sin(2 * Math.PI * path.fy * t),
  };
}

function orderedBlocks(protocol, participantIndex) {
  const blocks = protocol.blocks;
  const cb = blocks.filter(b => b.counterbalance);
  const fixedFirst = blocks.filter(b => !b.counterbalance && b.position === 'first');
  const fixedLast = blocks.filter(b => !b.counterbalance && b.position !== 'first');
  const square = balancedLatinSquare(cb.length);
  const row = square.length ? square[participantIndex % square.length] : [];
  return [...fixedFirst, ...row.map(i => cb[i]), ...fixedLast];
}

/**
 * Expand a protocol into the ordered list of stimulus steps.
 * @param protocol parsed protocol JSON
 * @param screen {width, height} stimulus area in CSS px
 * @param participantIndex integer used for Latin-square order + shuffles
 */
export function buildSchedule(protocol, screen, participantIndex = 0) {
  const timing = protocol.timing;
  const schedule = [];
  const toPx = (nx, ny) => ({x: nx * screen.width, y: ny * screen.height});
  orderedBlocks(protocol, participantIndex).forEach((block, blockPos) => {
    schedule.push({
      type: 'block_start', blockId: block.id, blockPos,
      condition: block.condition || {}, calibrationFrom: block.calibrationFrom || null,
    });
    const steps = typeof block.steps === 'string' ?
        protocol.stepTemplates[block.steps] : block.steps;
    steps.forEach((step, stepIdx) => {
      const seed = (protocol.seed ^ hashString(
          `${participantIndex}:${block.id}:${stepIdx}`)) >>> 0;
      const rand = mulberry32(seed);
      const base = {blockId: block.id, stepIdx};
      if (step.kind === 'instruction') {
        schedule.push({...base, type: 'instruction', text: step.text});
      } else if (step.kind === 'sync') {
        schedule.push({...base, type: 'sync', durationMs: step.durationMs || 1000});
      } else if (step.kind === 'fixation' || step.kind === 'headmove') {
        let pts = resolvePointSet(protocol, step.set);
        if (step.subset) pts = pts.filter(p => p.subsets.includes(step.subset));
        if (step.order === 'random') pts = shuffled(pts, rand);
        const settleMs = step.settleMs ?? timing.settleMs;
        const collectMs = step.kind === 'headmove' ?
            (step.collectMs ?? timing.headMoveMs) : (step.collectMs ?? timing.collectMs);
        pts.forEach((p, order) => {
          schedule.push({
            ...base, type: 'target', kind: step.kind, role: step.role,
            set: step.set, rep: step.rep ?? 1, order, index: p.index,
            id: `${block.id}:${step.role}:${step.set}:${step.rep ?? 1}:${p.index}`,
            nx: p.nx, ny: p.ny, ...toPx(p.nx, p.ny), subsets: p.subsets,
            settleMs, collectMs, durationMs: settleMs + collectMs,
          });
        });
      } else if (step.kind === 'pursuit') {
        const durationMs = step.durationMs ?? timing.pursuitMs;
        schedule.push({
          ...base, type: 'pursuit', role: step.role || 'pursuit',
          id: `${block.id}:pursuit:${stepIdx}`, path: step.path,
          settleMs: step.settleMs ?? 1000, durationMs,
        });
      } else {
        throw new Error(`Unknown step kind "${step.kind}"`);
      }
    });
  });
  return schedule;
}

/** Total scheduled stimulus time (ms), excluding waits for participant input. */
export function scheduleDurationMs(schedule) {
  return schedule.reduce((s, e) => s + (e.durationMs || 0), 0);
}
