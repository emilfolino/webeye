// Head-turn cue for the "headmove" step: an animated head that turns left, right, up and down.
// The figure is drawn like a mirror: when the participant should turn left, the face on screen
// moves to the screen's left. The timeline is pure (headCueState) so it can be tested in Node.

export const HEAD_DIRS = ['left', 'right', 'up', 'down'];
const VEC = {left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1]};
const smooth = u => u * u * (3 - 2 * u);

/**
 * Cue state at tMs after the cue starts.
 * Each direction gets segmentMs: first third turn out, second third hold, last third return.
 * @returns {{dir: string|null, phase: 'wait'|'out'|'hold'|'back'|'done', amount: number}}
 *   amount 0..1 is how far the head should be turned.
 */
export function headCueState(tMs, {segmentMs = 3000, dirs = HEAD_DIRS, loop = false} = {}) {
  if (tMs < 0) return {dir: null, phase: 'wait', amount: 0};
  let seg = Math.floor(tMs / segmentMs);
  if (seg >= dirs.length) {
    if (!loop) return {dir: null, phase: 'done', amount: 0};
    seg %= dirs.length;
  }
  const u = (tMs % segmentMs) / segmentMs;
  if (u < 1 / 3) return {dir: dirs[seg], phase: 'out', amount: smooth(u * 3)};
  if (u < 2 / 3) return {dir: dirs[seg], phase: 'hold', amount: 1};
  return {dir: dirs[seg], phase: 'back', amount: 1 - smooth((u - 2 / 3) * 3)};
}

const LABEL = {left: 'Turn your head LEFT', right: 'Turn your head RIGHT', up: 'Turn your head UP', down: 'Turn your head DOWN'};

/** Draw the head figure (centre cx,cy, radius r) and a caption below it. */
export function drawHeadCue(ctx, cx, cy, r, st, {caption = true} = {}) {
  const [vx, vy] = st.dir ? VEC[st.dir] : [0, 0];
  const dx = vx * st.amount * r * 0.5, dy = vy * st.amount * r * 0.4;
  ctx.save();
  ctx.lineWidth = Math.max(2, r * 0.06); ctx.strokeStyle = '#fff'; ctx.fillStyle = '#d8d8d8';
  ctx.beginPath(); ctx.ellipse(cx + dx * 0.2, cy + dy * 0.2, r * 0.8, r, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#222'; ctx.strokeStyle = '#222';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + dx + s * r * 0.3, cy - r * 0.12 + dy, r * 0.07, 0, Math.PI * 2); ctx.fill(); }
  ctx.beginPath(); ctx.moveTo(cx + dx * 1.2, cy - r * 0.05 + dy); ctx.lineTo(cx + dx * 1.35, cy + r * 0.28 + dy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx + dx - r * 0.18, cy + r * 0.5 + dy); ctx.lineTo(cx + dx + r * 0.18, cy + r * 0.5 + dy); ctx.stroke();
  if (st.dir) {  // arrow beside the head, pulsing with the turn
    const a = r * (0.25 + 0.15 * st.amount), ax = cx + vx * r * 1.55, ay = cy + vy * r * 1.45;
    ctx.fillStyle = '#fff'; ctx.beginPath();
    ctx.moveTo(ax + vx * a, ay + vy * a);
    ctx.lineTo(ax - vx * a + vy * a, ay - vy * a + vx * a);
    ctx.lineTo(ax - vx * a - vy * a, ay - vy * a - vx * a);
    ctx.closePath(); ctx.fill();
  }
  if (caption) {
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `${Math.round(r * 0.35)}px system-ui`;
    const text = st.dir ? LABEL[st.dir] : st.phase === 'done' ? 'Hold still' : 'Look at the dot';
    ctx.fillText(text, cx, cy + r * 1.75);
  }
  ctx.restore();
}
