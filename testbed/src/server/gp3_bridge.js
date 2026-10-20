// Gazepoint GP3 Open Gaze API bridge (TCP, XML-like lines, default port 4242).
// Message names follow the Gazepoint API documentation from memory; verify
// against the manual for your Gazepoint Control version (see docs/GP3.md).
import net from 'node:net';
import {EventEmitter} from 'node:events';

const ENABLE = [
  'ENABLE_SEND_TIME', 'ENABLE_SEND_TIME_TICK', 'ENABLE_SEND_COUNTER', 'ENABLE_SEND_POG_FIX',
  'ENABLE_SEND_POG_BEST', 'ENABLE_SEND_POG_LEFT', 'ENABLE_SEND_POG_RIGHT',
  'ENABLE_SEND_PUPIL_LEFT', 'ENABLE_SEND_PUPIL_RIGHT', 'ENABLE_SEND_USER_DATA',
  'ENABLE_SEND_DATA',
];

/** Parse one `<REC ... />` line into a flat sample object (lowercase keys). */
export function parseRec(line) {
  if (!line.startsWith('<REC')) return null;
  const out = {};
  for (const m of line.matchAll(/([A-Z_0-9]+)="([^"]*)"/g)) {
    const n = Number(m[2]);
    out[m[1].toLowerCase()] = m[2] !== '' && Number.isFinite(n) ? n : m[2];
  }
  return out;
}

export class Gp3Bridge extends EventEmitter {
  /** @param now () => ms on the server clock used for receive stamps */
  constructor({host = '127.0.0.1', port = 4242, now = () => performance.now()} = {}) {
    super();
    Object.assign(this, {host, port, now});
    this.sock = null;
    this.buf = '';
    this.stats = {connected: false, samples: 0, valid: 0, lastRx: null};
  }

  connect() {
    return new Promise((resolve, reject) => {
      const s = net.createConnection({host: this.host, port: this.port});
      s.setNoDelay(true);
      s.once('error', reject);
      s.on('connect', () => {
        this.sock = s;
        this.stats.connected = true;
        s.off('error', reject);
        s.on('error', e => this.emit('error', e));
        for (const id of ENABLE) this.send(`<SET ID="${id}" STATE="1" />`);
        resolve();
      });
      s.on('data', d => this._onData(d));
      s.on('close', () => { this.stats.connected = false; this.emit('close'); });
    });
  }

  send(msg) { this.sock?.write(msg + '\r\n'); }

  /** Insert a marker visible in the GP3 stream (USER_DATA) for clock sync. */
  marker(text) { this.send(`<SET ID="USER_DATA" VALUE="${String(text).replace(/"/g, '')}" />`); }

  _onData(d) {
    const rx = this.now();
    this.buf += d.toString('utf8');
    let idx;
    while ((idx = this.buf.indexOf('\r\n')) >= 0) {
      const line = this.buf.slice(0, idx).trim();
      this.buf = this.buf.slice(idx + 2);
      const rec = parseRec(line);
      if (!rec) continue;
      rec.rx = rx;
      this.stats.samples++;
      if (rec.bpogv === 1) this.stats.valid++;
      this.stats.lastRx = rx;
      this.emit('sample', rec);
    }
  }

  close() { this.sock?.destroy(); }
}
