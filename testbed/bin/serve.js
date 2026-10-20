#!/usr/bin/env node
// Start the local study server.
//   node bin/serve.js [--data data/sessions] [--port 8099] [--gp3 127.0.0.1:4242]
// Then open http://localhost:8099/ (recorder) or /web/worker.html (landmark worker).
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {createStudyServer} from '../src/server/server.js';

const root = new URL('..', import.meta.url).pathname;
const {values: a} = parseArgs({options: {
  data: {type: 'string', default: join(root, 'data/sessions')}, port: {type: 'string', default: '8099'},
  gp3: {type: 'string'},
}});
const gp3 = a.gp3 ? {host: a.gp3.split(':')[0], port: Number(a.gp3.split(':')[1] || 4242)} : null;
const s = createStudyServer({dataDir: a.data, webRoot: join(root, 'src/web'), sharedRoot: join(root, 'src/shared'), gp3});
const port = await s.listen(Number(a.port));
console.log(`WebEye study server on http://127.0.0.1:${port}  data=${a.data}  gp3=${a.gp3 || 'off'}`);
