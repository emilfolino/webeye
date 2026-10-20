// Result tables, registry and provenance.
import {appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {mean} from './stats.js';
import {sha} from './spec.js';

const csvCell = v => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows, columns) {
  const cols = columns || [...rows.reduce((set, r) => {
    Object.keys(r).forEach(k => set.add(k));
    return set;
  }, new Set())];
  return [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\n') + '\n';
}

export function gitInfo(cwd) {
  try {
    const commit = execSync('git rev-parse --short HEAD', {cwd, stdio: ['ignore', 'pipe', 'ignore']}).toString().trim();
    const dirty = execSync('git status --porcelain', {cwd, stdio: ['ignore', 'pipe', 'ignore']}).toString().trim() !== '';
    return {commit, dirty};
  } catch {
    return {commit: 'unknown', dirty: false};
  }
}

export function datasetId(sessions) {
  const parts = sessions.map(s => {
    const ev = existsSync(join(s.dir, 'events.jsonl')) ? readFileSync(join(s.dir, 'events.jsonl'), 'utf8') : '';
    return `${s.manifest.sessionId}:${sha(JSON.stringify(s.manifest) + ev, 8)}`;
  }).sort();
  return sha(parts.join('|'), 10);
}

/** Headline numbers for one tag: per-session mean of pooled validation rows, then across sessions. */
export function summarise(rows) {
  const val = rows.filter(r => r.level === 'pooled' && r.role === 'validation');
  const bySession = new Map();
  for (const r of val) {
    if (!bySession.has(r.session)) bySession.set(r.session, []);
    bySession.get(r.session).push(r);
  }
  const per = [...bySession.values()];
  const m = k => per.length ? mean(per.map(rs => mean(rs.map(r => r[k]).filter(Number.isFinite)))) : NaN;
  return {
    n_sessions: per.length,
    n_participants: new Set(val.map(r => r.participant)).size,
    mean_accuracy_deg: m('accuracy_deg'), mean_p95_err_deg: m('p95_err_deg'),
    mean_precision_sd_deg: m('precision_sd_deg'), mean_precision_rms_s2s_deg: m('precision_rms_s2s_deg'),
    mean_loss: m('loss'),
  };
}

export const REGISTRY_COLUMNS = [
  'tag', 'spec_hash', 'date', 'code_commit', 'dirty', 'dataset', 'split', 'n_participants', 'n_sessions',
  'mean_accuracy_deg', 'mean_p95_err_deg', 'mean_precision_sd_deg', 'mean_precision_rms_s2s_deg', 'mean_loss', 'notes',
];

export function appendRegistry(path, entry) {
  mkdirSync(dirname(path), {recursive: true});
  if (!existsSync(path)) writeFileSync(path, REGISTRY_COLUMNS.join(',') + '\n');
  appendFileSync(path, toCsv([entry], REGISTRY_COLUMNS).split('\n')[1] + '\n');
}
