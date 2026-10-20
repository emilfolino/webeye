// Deterministic frame preprocessing with ffmpeg: resize, frame dropping,
// synthetic degradation (blur, noise, JPEG). Output is cached per
// (session, camera, preprocessKey) and served to the landmark worker.
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {normaliseSpec, preprocessKey} from './spec.js';
import {selectFrames} from './landmarks.js';

export function targetSize(pre, w, h) {
  const rs = pre.resize;
  if (!rs) return [w, h];
  if (Array.isArray(rs)) return rs;
  if (rs.scale) return [Math.round(w * rs.scale / 2) * 2, Math.round(h * rs.scale / 2) * 2];
  throw new Error('bad resize spec');
}

export const isIdentityPreprocess = pre =>
    !pre.resize && !pre.degrade?.noiseSigma && !pre.degrade?.blurSigma && !pre.degrade?.jpegQuality;

export function filterChain(pre, w, h) {
  const [tw, th] = targetSize(pre, w, h);
  const f = [];
  if (tw !== w || th !== h) f.push(`scale=${tw}:${th}:flags=${pre.resampler || 'lanczos'}`);
  const d = pre.degrade || {};
  if (d.blurSigma) f.push(`gblur=sigma=${d.blurSigma}`);
  if (d.noiseSigma) f.push(`noise=alls=${d.noiseSigma}:allf=t+u:all_seed=1234`);
  return {chain: f.length ? f.join(',') : 'null', size: [tw, th]};
}

const run = (cmd, args) => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, {stdio: ['ignore', 'ignore', 'pipe']});
  let err = '';
  p.stderr.on('data', d => { err += d; });
  p.on('error', reject);
  p.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-800)}`)));
});

/**
 * Ensure preprocessed frames exist. Returns {dir, size: [w,h], frames: [{i, t, file}], ext}.
 * For an identity preprocess no files are written; frames point at the source.
 */
export async function ensurePreprocessed(session, specIn, cacheRoot) {
  const spec = normaliseSpec(specIn);
  const cam = session.cameras[spec.camera];
  if (!cam) throw new Error(`Session has no camera ${spec.camera}`);
  const chosen = selectFrames(cam.frames, spec.preprocess.fps);
  if (!chosen.length) throw new Error('No frames recorded');
  const [w, h] = [chosen[0].w, chosen[0].h];
  const pre = spec.preprocess;
  if (isIdentityPreprocess(pre)) {
    return {dir: join(cam.dir, 'frames'), size: [w, h], identity: true,
      frames: chosen.map(f => ({i: f.i, t: f.t, file: f.file}))};
  }
  const key = preprocessKey(spec);
  const dir = join(cacheRoot, session.manifest.sessionId, spec.camera, key);
  const mapPath = join(dir, 'map.json');
  const {chain, size} = filterChain(pre, w, h);
  if (existsSync(mapPath)) {
    return {dir, size, identity: false, frames: JSON.parse(readFileSync(mapPath, 'utf8'))};
  }
  mkdirSync(dir, {recursive: true});
  const ext = pre.degrade?.jpegQuality ? 'jpg' : 'png';
  const list = chosen.map(f => `file '${join(cam.dir, 'frames', f.file).replace(/'/g, "'\\''")}'\nduration 1`).join('\n');
  writeFileSync(join(dir, 'list.txt'), list + '\n');
  const args = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'),
    '-vf', chain, '-fps_mode', 'passthrough', '-start_number', '0'];
  if (ext === 'jpg') args.push('-q:v', String(Math.max(2, Math.round(31 - 29 * pre.degrade.jpegQuality / 100))));
  else args.push('-compression_level', '1');
  args.push(join(dir, `%06d.${ext}`));
  await run('ffmpeg', args);
  const frames = chosen.map((f, k) => ({i: f.i, t: f.t, file: `${String(k).padStart(6, '0')}.${ext}`}));
  writeFileSync(mapPath, JSON.stringify(frames));
  return {dir, size, identity: false, frames};
}
