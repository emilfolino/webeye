import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {Gp3Bridge, parseRec} from '../src/server/gp3_bridge.js';

test('parseRec parses REC attributes', () => {
  const r = parseRec('<REC CNT="12" TIME="3.5" BPOGX="0.5" BPOGY="0.25" BPOGV="1" USER="a" />');
  assert.equal(r.cnt, 12);
  assert.equal(r.time, 3.5);
  assert.equal(r.bpogv, 1);
  assert.equal(r.user, 'a');
  assert.equal(parseRec('<ACK ID="X" />'), null);
});

test('bridge enables streaming and receives fragmented REC lines', async () => {
  const received = [];
  const srv = net.createServer(sock => {
    sock.on('data', d => received.push(d.toString()));
    const msg = '<REC TIME="1.0" BPOGX="0.1" BPOGY="0.2" BPOGV="1" />\r\n<REC TIME="1.0166" BPOGX="0.3" BPOGY="0.4" BPOGV="0" />\r\n';
    setTimeout(() => sock.write(msg.slice(0, 20)), 10);
    setTimeout(() => sock.write(msg.slice(20)), 30);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const b = new Gp3Bridge({port: srv.address().port});
  const samples = [];
  b.on('sample', s => samples.push(s));
  await b.connect();
  b.marker('sync-1');
  await new Promise(r => setTimeout(r, 120));
  b.close();
  srv.close();
  assert.equal(samples.length, 2);
  assert.equal(samples[1].bpogx, 0.3);
  assert.ok(Number.isFinite(samples[0].rx));
  assert.equal(b.stats.valid, 1);
  const sent = received.join('');
  assert.match(sent, /ENABLE_SEND_POG_BEST" STATE="1"/);
  assert.match(sent, /USER_DATA" VALUE="sync-1"/);
});
