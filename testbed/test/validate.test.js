import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {simulateSession} from '../src/engine/simulate.js';
import {tmp} from './helpers.js';

const protocol = JSON.parse(readFileSync(new URL('../protocols/webeye-main.protocol.json', import.meta.url), 'utf8'));
const run = dir => spawnSync('node', [new URL('../bin/validate-session.js', import.meta.url).pathname, dir], {encoding: 'utf8'});

test('validate-session accepts a complete session and rejects an interrupted one', () => {
  const dir = join(tmp(), 's');
  simulateSession({dir, protocol, participantId: 'V1', seed: 3});
  assert.equal(run(dir).status, 0);
  const ev = readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter(l => l && !l.includes('session_end'));
  writeFileSync(join(dir, 'events.jsonl'), ev.join('\n') + '\n');
  const r = run(dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /no session_end/);
});
