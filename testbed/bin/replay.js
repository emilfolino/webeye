#!/usr/bin/env node
// Replay pipeline specs over recorded sessions and write result tables.
//
//   node bin/replay.js --data data/sessions --specs pipelines/baseline.json [pipelines/x.sweep.json ...]
//        [--sessions P001,P002] [--split dev|confirm|all] [--out results/<name>]
//        [--cv] [--registry experiments/registry.csv] [--no-registry] [--notes "text"]
//
// Missing landmark caches are written as jobs to <data>/_jobs; run the
// worker (see docs/WORKFLOW.md), then re-run. Default split is "dev";
// confirm/all require every spec to carry "frozen": true and are logged.
import {appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {parseArgs} from 'node:util';
import {loadSession} from '../src/engine/session.js';
import {runPipeline, runCv, MissingLandmarksError} from '../src/engine/pipeline.js';
import {landmarkKey, preprocessKey, specHash} from '../src/engine/spec.js';
import {loadSpecs} from '../src/engine/sweep.js';
import {appendRegistry, datasetId, gitInfo, summarise, toCsv} from '../src/engine/results.js';

const root = new URL('..', import.meta.url).pathname;
const {values: a, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    data: {type: 'string'}, specs: {type: 'string', multiple: true}, sessions: {type: 'string'},
    split: {type: 'string', default: 'dev'}, out: {type: 'string'}, cv: {type: 'boolean', default: false},
    registry: {type: 'string', default: join(root, 'experiments/registry.csv')},
    'no-registry': {type: 'boolean', default: false}, notes: {type: 'string', default: ''},
  },
});

if ((!a.data || !(a.specs || positionals).length)) {
  console.error('usage: replay.js --data <sessions dir> --specs <spec.json|sweep.json>... [options]');
  process.exit(1);
}

const specs = loadSpecs([...(a.specs || []), ...positionals]);
const tags = new Set();
for (const s of specs) {
  if (tags.has(s.tag)) throw new Error(`Duplicate tag ${s.tag}`);
  tags.add(s.tag);
}

const dataDir = resolve(a.data);
const wanted = a.sessions ? new Set(a.sessions.split(',')) : null;
let sessions = readdirSync(dataDir, {withFileTypes: true})
    .filter(d => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(dataDir, d.name, 'manifest.json')))
    .map(d => loadSession(join(dataDir, d.name)))
    .filter(s => !wanted || wanted.has(s.manifest.participant.id) || wanted.has(s.manifest.sessionId));
if (a.split !== 'all') sessions = sessions.filter(s => s.split === a.split);
if (!sessions.length) { console.error('No sessions selected.'); process.exit(1); }

// Hold-out discipline: confirmatory data are only touched with frozen specs.
const touchesConfirm = sessions.some(s => s.split === 'confirm' && !s.manifest.simulated);
if (touchesConfirm) {
  const unfrozen = specs.filter(s => !s.frozen).map(s => s.tag);
  if (unfrozen.length) {
    console.error(`Refusing to read confirmatory sessions with non-frozen specs: ${unfrozen.slice(0, 5).join(', ')}...`);
    console.error('Freeze specs ("frozen": true) after tuning on the dev split and pre-registering them.');
    process.exit(3);
  }
  mkdirSync(join(root, 'experiments'), {recursive: true});
  appendFileSync(join(root, 'experiments/confirmatory_access.log'),
      `${new Date().toISOString()} split=${a.split} specs=${specs.map(s => s.tag).join(';')} sessions=${sessions.length}\n`);
}

const git = gitInfo(root);
const outDir = resolve(a.out || join(root, 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}`));
mkdirSync(outDir, {recursive: true});

const allRows = [], qcs = [], missing = new Map();
for (const spec of specs) {
  const rowsForSpec = [];
  for (const session of sessions) {
    try {
      const res = a.cv ? runCv(session, spec) : runPipeline(session, spec);
      rowsForSpec.push(...res.rows);
      if (res.qc) qcs.push(res.qc);
    } catch (e) {
      if (!(e instanceof MissingLandmarksError)) throw e;
      missing.set(`${session.manifest.sessionId}|${landmarkKey(spec)}`, {session, spec});
    }
  }
  allRows.push(...rowsForSpec);
  if (rowsForSpec.length && !a.cv && !a['no-registry']) {
    appendRegistry(a.registry, {
      tag: spec.tag, spec_hash: specHash(spec), date: new Date().toISOString().slice(0, 10),
      code_commit: git.commit, dirty: git.dirty ? 1 : 0, dataset: datasetId(sessions), split: a.split,
      ...summarise(rowsForSpec), notes: a.notes || spec.description,
    });
  }
}

if (missing.size) {
  const jobsDir = join(dataDir, '_jobs');
  mkdirSync(jobsDir, {recursive: true});
  for (const [key, {session, spec}] of missing) {
    const job = {
      id: key.replace('|', '--'), sessionDir: session.dir, sessionId: session.manifest.sessionId,
      camera: spec.camera, landmarkKey: landmarkKey(spec), preprocessKey: preprocessKey(spec),
      preprocess: spec.preprocess, model: spec.model,
    };
    writeFileSync(join(jobsDir, `${job.id}.json`), JSON.stringify(job, null, 1));
  }
  console.error(`${missing.size} landmark job(s) queued in ${jobsDir}. Run the landmark worker, then re-run.`);
}

writeFileSync(join(outDir, 'rows.csv'), toCsv(allRows));
writeFileSync(join(outDir, 'qc.json'), JSON.stringify(qcs, null, 1));
writeFileSync(join(outDir, 'run.json'), JSON.stringify({
  date: new Date().toISOString(), git, node: process.version, split: a.split, cv: a.cv,
  dataset: datasetId(sessions), sessions: sessions.map(s => s.manifest.sessionId),
  specs: specs.map(s => ({...s, spec_hash: specHash(s)})), missingJobs: missing.size,
}, null, 1));
console.log(`${allRows.length} rows -> ${join(outDir, 'rows.csv')}`);
if (missing.size) process.exit(2);
