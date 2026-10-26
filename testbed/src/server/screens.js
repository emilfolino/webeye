// Physical screen size from the monitor's EDID (Linux: /sys/class/drm). The
// browser cannot know it. EDID can be wrong (projectors, TVs, adapters report
// placeholders), so the recorder lets the operator accept or override with the
// card calibration. Other platforms return [] and the recorder falls back.
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

/** Parse a 128+ byte EDID block. Returns null if it is not a valid EDID. */
export function parseEdid(buf) {
  const magic = [0, 255, 255, 255, 255, 255, 255, 0];
  if (buf.length < 128 || magic.some((v, i) => buf[i] !== v)) return null;
  if (buf.subarray(0, 128).reduce((s, v) => s + v, 0) % 256 !== 0) return null;
  // Preferred detailed timing descriptor: pixel and mm size (1 mm resolution).
  const d = buf.subarray(54, 72);
  let widthMm = 0, heightMm = 0, hres = 0, vres = 0;
  if (d[0] || d[1]) {
    hres = d[2] | ((d[4] & 0xF0) << 4);
    vres = d[5] | ((d[7] & 0xF0) << 4);
    widthMm = d[12] | ((d[14] & 0xF0) << 4);
    heightMm = d[13] | ((d[14] & 0x0F) << 8);
  }
  let source = 'edid-dtd';
  if (!widthMm || !heightMm) {  // fall back to basic block (1 cm resolution)
    widthMm = buf[21] * 10;
    heightMm = buf[22] * 10;
    source = 'edid-basic';
  }
  let name = '';
  for (let o = 54; o <= 108; o += 18) {
    if (buf[o] === 0 && buf[o + 1] === 0 && buf[o + 3] === 0xFC) {
      name = buf.subarray(o + 5, o + 18).toString('latin1').split('\n')[0].trim();
    }
  }
  if (!widthMm || !heightMm) return null;  // 0 cm means projector / unknown
  return {widthMm, heightMm, hres, vres, name, source};
}

export function detectScreens(drmRoot = '/sys/class/drm') {
  if (!existsSync(drmRoot)) return [];
  const out = [];
  for (const entry of readdirSync(drmRoot)) {
    const dir = join(drmRoot, entry);
    try {
      if (readFileSync(join(dir, 'status'), 'utf8').trim() !== 'connected') continue;
      const edid = parseEdid(readFileSync(join(dir, 'edid')));
      if (edid) out.push({connector: entry, ...edid});
    } catch { /* no edid / status for this entry */ }
  }
  return out;
}
