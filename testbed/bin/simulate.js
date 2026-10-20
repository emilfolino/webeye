#!/usr/bin/env node
// Generate simulated sessions (+ landmark caches for the given specs) to
// exercise the toolchain end to end. Output is NOT real data.
//   node bin/simulate.js --out /tmp/sim --n 12 --specs pipelines/resolution-sweep.sweep.json
import {readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {simulateSession, simulateLandmarks} from '../src/engine/simulate.js';
import {loadSpecs} from '../src/engine/sweep.js';
import {gaussian, mulberry32} from '../src/shared/rng.js';

const root = new URL('..', import.meta.url).pathname;
const {values: a, positionals} = parseArgs({allowPositionals: true, options: {
  out: {type: 'string'}, n: {type: 'string', default: '8'}, specs: {type: 'string', multiple: true},
  seed: {type: 'string', default: '1'}, protocol: {type: 'string', default: join(root, 'protocols/webeye-main.protocol.json')},
}});
if (!a.out) { console.error('--out required'); process.exit(1); }
const protocol = JSON.parse(readFileSync(a.protocol, 'utf8'));
const specs = loadSpecs([...(a.specs || []), ...positionals]);
const rand = mulberry32(Number(a.seed));
for (let i = 0; i < Number(a.n); i++) {
  const id = `S${String(i + 1).padStart(3, '0')}`;
  // Between-participant variation: noisier / biased participants.
  const subject = {
    fixationBiasDeg: Math.abs(0.3 + gaussian(rand) * 0.1), gazeNoiseDeg: 0.15,
    pursuitLagMs: 120 + gaussian(rand) * 20,
  };
  const sim = simulateSession({dir: join(resolve(a.out), id), protocol, participantId: id, participantIndex: i, seed: Number(a.seed) + i, subject});
  for (const s of specs) if (s.model.runtime !== 'gp3') simulateLandmarks(sim, s);
  console.log('simulated', id);
}
