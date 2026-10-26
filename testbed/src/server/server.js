// Local study server (bound to 127.0.0.1): receives recorder uploads, bridges
// the GP3, serves frames to the landmark worker and stores its results.
// Zero dependencies. Participant video never leaves this machine.
import http from 'node:http';
import {createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, appendFileSync} from 'node:fs';
import {join, extname, normalize, resolve, sep} from 'node:path';
import {loadSession} from '../engine/session.js';
import {ensurePreprocessed} from '../engine/preprocess.js';
import {Gp3Bridge} from './gp3_bridge.js';
import {detectScreens} from './screens.js';

const SAFE = /^[A-Za-z0-9._-]+$/;
const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'};
const MAX_BODY = 64 * 1024 * 1024;

const readBody = req => new Promise((resolve, reject) => {
  const chunks = [];
  let n = 0;
  req.on('data', c => {
    n += c.length;
    if (n > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});

export function createStudyServer({dataDir, webRoot, sharedRoot, protocolsRoot = join(webRoot, '../../protocols'), gp3 = null}) {
  dataDir = resolve(dataDir);
  mkdirSync(dataDir, {recursive: true});
  const cacheRoot = join(dataDir, '_cache');
  const jobsDir = join(dataDir, '_jobs');
  const t0 = performance.now();
  const now = () => performance.now() - t0;
  const gp3State = {bridge: null, out: null, sessionId: null, error: null};

  const sessionDir = id => {
    if (!SAFE.test(id)) throw httpError(400, 'bad session id');
    return join(dataDir, id);
  };

  const json = (res, code, obj) => {
    res.writeHead(code, {'content-type': 'application/json', 'cache-control': 'no-store'});
    res.end(JSON.stringify(obj));
  };

  function httpError(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }

  async function connectGp3() {
    if (!gp3 || gp3State.bridge?.stats.connected) return;
    const b = new Gp3Bridge({...gp3, now});
    b.on('sample', s => {
      if (!gp3State.out) return;
      const {rx, time, cnt, tick, bpogx, bpogy, bpogv, fpogx, fpogy, fpogid, fpogv, lpd, lpv, rpd, rpv, user} = s;
      gp3State.out.write(JSON.stringify({rx, time, cnt, tick, bpogx, bpogy, bpogv, fpogx, fpogy, fpogid, fpogv, lpd, lpv, rpd, rpv, user}) + '\n');
    });
    b.on('error', e => { gp3State.error = String(e.message || e); });
    await b.connect();
    gp3State.bridge = b;
    gp3State.error = null;
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    let m;

    if (req.method === 'GET' && p === '/api/clock') return json(res, 200, {t: now()});

    if (req.method === 'GET' && p === '/api/screens') return json(res, 200, {platform: process.platform, screens: detectScreens()});

    if (req.method === 'GET' && p === '/api/gp3/status') {
      const st = gp3State.bridge?.stats;
      return json(res, 200, {configured: !!gp3, connected: !!st?.connected, samples: st?.samples ?? 0,
        valid: st?.valid ?? 0, lastRxAgeMs: st?.lastRx != null ? now() - st.lastRx : null, error: gp3State.error});
    }

    if (req.method === 'POST' && p === '/api/sessions') {
      const manifest = JSON.parse((await readBody(req)).toString());
      const id = manifest.sessionId;
      const dir = sessionDir(id);
      if (existsSync(dir)) throw httpError(409, 'session exists');
      mkdirSync(dir, {recursive: true});
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({...manifest, serverCreated: new Date().toISOString()}, null, 1));
      writeFileSync(join(dir, 'events.jsonl'), '');
      for (const cam of manifest.cameras || []) {
        if (!SAFE.test(cam.id)) throw httpError(400, 'bad camera id');
        mkdirSync(join(dir, 'cameras', cam.id, 'frames'), {recursive: true});
      }
      return json(res, 200, {sessionId: id});
    }

    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/cameras\/([^/]+)\/frames\/([^/]+)$/)) && req.method === 'PUT') {
      const [, id, cam, file] = m;
      if (!SAFE.test(cam) || !SAFE.test(file)) throw httpError(400, 'bad name');
      writeFileSync(join(sessionDir(id), 'cameras', cam, 'frames', file), await readBody(req));
      return json(res, 200, {ok: true});
    }
    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/cameras\/([^/]+)\/index$/)) && req.method === 'POST') {
      if (!SAFE.test(m[2])) throw httpError(400, 'bad camera');
      appendFileSync(join(sessionDir(m[1]), 'cameras', m[2], 'frames.jsonl'), await readBody(req));
      return json(res, 200, {ok: true});
    }
    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/live\/([^/]+)$/)) && req.method === 'POST') {
      if (!SAFE.test(m[2])) throw httpError(400, 'bad camera');
      mkdirSync(join(sessionDir(m[1]), 'live'), {recursive: true});
      appendFileSync(join(sessionDir(m[1]), 'live', `${m[2]}.jsonl`), await readBody(req));
      return json(res, 200, {ok: true});
    }
    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/events$/)) && req.method === 'POST') {
      appendFileSync(join(sessionDir(m[1]), 'events.jsonl'), await readBody(req));
      return json(res, 200, {ok: true});
    }
    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/gp3$/)) && req.method === 'POST') {
      const {action} = JSON.parse((await readBody(req)).toString());
      const dir = sessionDir(m[1]);
      if (action === 'start') {
        await connectGp3();
        gp3State.out?.end();
        gp3State.out = createWriteStream(join(dir, 'gp3.jsonl'), {flags: 'a'});
        gp3State.sessionId = m[1];
      } else if (action === 'marker') {
        gp3State.bridge?.marker(`sync-${now().toFixed(0)}`);
      } else {
        gp3State.out?.end();
        gp3State.out = null;
      }
      return json(res, 200, {ok: true});
    }
    if ((m = p.match(/^\/api\/sessions\/([^/]+)\/complete$/)) && req.method === 'POST') {
      const dir = sessionDir(m[1]);
      const patch = JSON.parse((await readBody(req)).toString() || '{}');
      const cur = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      writeFileSync(join(dir, 'manifest.json'), JSON.stringify({...cur, ...patch, serverCompleted: new Date().toISOString()}, null, 1));
      gp3State.out?.end();
      gp3State.out = null;
      return json(res, 200, {ok: true});
    }

    // ---- landmark worker ----
    if (req.method === 'GET' && p === '/api/jobs') {
      const list = existsSync(jobsDir) ? readdirSync(jobsDir) : [];
      return json(res, 200, {pending: list.filter(f => f.endsWith('.json')).length, claimed: list.filter(f => f.endsWith('.claimed')).length});
    }
    if (req.method === 'POST' && p === '/api/jobs/next') {
      const files = existsSync(jobsDir) ? readdirSync(jobsDir).filter(f => f.endsWith('.json')).sort() : [];
      if (!files.length) return json(res, 200, {job: null});
      const f = files[0];
      const job = JSON.parse(readFileSync(join(jobsDir, f), 'utf8'));
      renameSync(join(jobsDir, f), join(jobsDir, f.replace(/\.json$/, '.claimed')));
      try {
        const session = loadSession(job.sessionDir);
        const pre = await ensurePreprocessed(session, {tag: 'job', camera: job.camera, preprocess: job.preprocess, model: job.model}, cacheRoot);
        const base = pre.identity ? `/frames/${session.manifest.sessionId}/${job.camera}/` :
            `/pre/${session.manifest.sessionId}/${job.camera}/${job.preprocessKey}/`;
        return json(res, 200, {job: {...job, size: pre.size, frames: pre.frames.map(fr => ({i: fr.i, t: fr.t, url: base + fr.file}))}});
      } catch (e) {
        renameSync(join(jobsDir, f.replace(/\.json$/, '.claimed')), join(jobsDir, f.replace(/\.json$/, '.failed')));
        throw e;
      }
    }
    if ((m = p.match(/^\/api\/jobs\/([^/]+)\/result$/)) && req.method === 'POST') {
      if (!SAFE.test(m[1])) throw httpError(400, 'bad job id');
      const claimed = join(jobsDir, `${m[1]}.claimed`);
      if (!existsSync(claimed)) throw httpError(404, 'job not claimed');
      const job = JSON.parse(readFileSync(claimed, 'utf8'));
      const body = (await readBody(req)).toString();
      const head = JSON.parse(body.slice(0, body.indexOf('\n')));
      if (!head.header || !head.w || !head.h) throw httpError(400, 'missing header');
      const out = join(job.sessionDir, 'landmarks', job.camera);
      mkdirSync(out, {recursive: true});
      writeFileSync(join(out, `${job.landmarkKey}.jsonl`), body.endsWith('\n') ? body : body + '\n');
      renameSync(claimed, join(jobsDir, `${m[1]}.done`));
      return json(res, 200, {ok: true});
    }
    if ((m = p.match(/^\/api\/jobs\/([^/]+)\/fail$/)) && req.method === 'POST') {
      if (!SAFE.test(m[1])) throw httpError(400, 'bad job id');
      const claimed = join(jobsDir, `${m[1]}.claimed`);
      if (existsSync(claimed)) renameSync(claimed, join(jobsDir, `${m[1]}.failed`));
      return json(res, 200, {ok: true});
    }

    // ---- static files ----
    if (req.method === 'GET') {
      let root = null, rel = null;
      if (p === '/') { root = webRoot; rel = 'index.html'; }
      else if ((m = p.match(/^\/web\/(.+)$/))) { root = webRoot; rel = m[1]; }
      else if ((m = p.match(/^\/protocols\/(.+)$/))) { root = protocolsRoot; rel = m[1]; }
      else if ((m = p.match(/^\/shared\/(.+)$/))) { root = sharedRoot; rel = m[1]; }
      else if ((m = p.match(/^\/frames\/([^/]+)\/([^/]+)\/([^/]+)$/))) { root = join(sessionDir(m[1]), 'cameras', m[2], 'frames'); rel = m[3]; }
      else if ((m = p.match(/^\/pre\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/))) { root = join(cacheRoot, m[1], m[2], m[3]); rel = m[4]; }
      if (root) {
        const full = normalize(join(root, rel));
        if (!full.startsWith(resolve(root) + sep) && full !== resolve(root)) throw httpError(403, 'forbidden');
        if (!existsSync(full) || !statSync(full).isFile()) throw httpError(404, 'not found');
        res.writeHead(200, {'content-type': MIME[extname(full)] || 'application/octet-stream', 'cache-control': 'no-store'});
        return createReadStream(full).pipe(res);
      }
    }
    throw httpError(404, 'no route');
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(e => {
      if (res.headersSent) { res.destroy(); return; }
      json(res, e.code && Number.isInteger(e.code) ? e.code : 500, {error: String(e.message || e)});
    });
  });
  return {
    server, now, gp3State,
    listen: (port = 8099, host = '127.0.0.1') => new Promise(r => server.listen(port, host, () => r(server.address().port))),
    close: () => new Promise(r => { gp3State.out?.end(); gp3State.bridge?.close(); server.close(() => r()); server.closeAllConnections?.(); }),
  };
}
