import {createAdapter} from '/web/detector_adapter.js';
import {KEYPOINT_SUBSET} from '/shared/keypoints.js';

const log = document.getElementById('log');
const say = s => { log.textContent = `${new Date().toLocaleTimeString()} ${s}\n` + log.textContent.slice(0, 4000); };
const post = (path, body) => fetch(path, {method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body)});
const params = new URLSearchParams(location.search);
const once = params.has('once');

async function runJob(job) {
  const [w, h] = job.size;
  say(`job ${job.id}: ${job.frames.length} frames @ ${w}x${h}, ${job.model.runtime}`);
  const adapter = await createAdapter(job.model);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', {willReadFrequently: false});
  const lines = [JSON.stringify({header: true, camera: job.camera, w, h, subset: KEYPOINT_SUBSET, nFrames: job.frames.length,
    model: job.model, ...adapter.info, jobId: job.id})];
  // Warm-up so the first frames' timing is not dominated by shader compilation.
  if (job.frames.length) {
    const bmp = await createImageBitmap(await (await fetch(job.frames[0].url)).blob());
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    for (let k = 0; k < 3; k++) await adapter.estimate(canvas);
  }
  let n = 0;
  for (const fr of job.frames) {
    const bmp = await createImageBitmap(await (await fetch(fr.url)).blob());
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const r = await adapter.estimate(canvas);
    lines.push(JSON.stringify(r.ok ? {i: fr.i, t: fr.t, ok: true, ms: Math.round(r.ms * 100) / 100, kp: r.kp} :
      {i: fr.i, t: fr.t, ok: false, ms: Math.round(r.ms * 100) / 100}));
    if (++n % 200 === 0) say(`  ${n}/${job.frames.length}`);
  }
  adapter.dispose();
  const res = await post(`/api/jobs/${job.id}/result`, lines.join('\n') + '\n');
  if (!res.ok) throw new Error(`result upload failed: ${res.status}`);
  say(`job ${job.id} done`);
}

for (;;) {
  const {job} = await (await post('/api/jobs/next', {})).json().catch(() => ({job: null}));
  if (!job) {
    if (once) { document.title = 'WORKER-IDLE'; break; }
    await new Promise(r => setTimeout(r, 2000));
    continue;
  }
  try { await runJob(job); } catch (e) {
    say(`job ${job.id} FAILED: ${e.message}`);
    await post(`/api/jobs/${job.id}/fail`, {});
  }
}
