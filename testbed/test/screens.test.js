import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {parseEdid, detectScreens} from '../src/server/screens.js';
import {tmp} from './helpers.js';

function makeEdid({hres = 2560, vres = 1440, wMm = 597, hMm = 336, name = 'TESTMON', basicCm = 60}) {
  const b = Buffer.alloc(128);
  [0, 255, 255, 255, 255, 255, 255, 0].forEach((v, i) => { b[i] = v; });
  b[21] = basicCm; b[22] = Math.round(hMm / 10);
  const d = 54;
  b[d] = 0x01; b[d + 1] = 0x1d;  // nonzero pixel clock
  b[d + 2] = hres & 255; b[d + 4] = (hres >> 8) << 4;
  b[d + 5] = vres & 255; b[d + 7] = (vres >> 8) << 4;
  b[d + 12] = wMm & 255; b[d + 13] = hMm & 255; b[d + 14] = ((wMm >> 8) << 4) | (hMm >> 8);
  const n = 72;
  b[n + 3] = 0xFC; b.write(name + '\n', n + 5, 'latin1');
  b[127] = (256 - (b.subarray(0, 127).reduce((s, v) => s + v, 0) % 256)) % 256;
  return b;
}

test('parseEdid reads mm from the preferred timing, name and pixels', () => {
  const e = parseEdid(makeEdid({}));
  assert.deepEqual([e.widthMm, e.heightMm, e.hres, e.vres, e.name, e.source], [597, 336, 2560, 1440, 'TESTMON', 'edid-dtd']);
});

test('parseEdid falls back to basic cm, rejects bad checksum and zero size', () => {
  const noDtd = makeEdid({wMm: 0, hMm: 0});
  noDtd[22] = 34;
  noDtd[127] = (256 - (noDtd.subarray(0, 127).reduce((s, v) => s + v, 0) % 256)) % 256;
  assert.equal(parseEdid(noDtd).source, 'edid-basic');
  assert.equal(parseEdid(noDtd).widthMm, 600);
  const bad = makeEdid({}); bad[10] ^= 1;
  assert.equal(parseEdid(bad), null);
  const proj = makeEdid({wMm: 0, hMm: 0, basicCm: 0}); proj[22] = 0;
  proj[127] = (256 - (proj.subarray(0, 127).reduce((s, v) => s + v, 0) % 256)) % 256;
  assert.equal(parseEdid(proj), null);
});

test('detectScreens lists only connected connectors with valid EDID', () => {
  const root = tmp();
  for (const [name, status] of [['card0-eDP-1', 'connected'], ['card0-HDMI-A-1', 'disconnected']]) {
    mkdirSync(join(root, name));
    writeFileSync(join(root, name, 'status'), status + '\n');
    writeFileSync(join(root, name, 'edid'), makeEdid({}));
  }
  const s = detectScreens(root);
  assert.equal(s.length, 1);
  assert.equal(s[0].connector, 'card0-eDP-1');
  assert.deepEqual(detectScreens(join(root, 'nope')), []);
});
