import {readFileSync} from 'node:fs';
import {normaliseSpec} from './spec.js';

// Sweep files expand a base spec over factor levels (full factorial).
//   {"base": {...spec}, "tagPrefix": "res-x-map", "factors": {"preprocess.resize": [[1280,720],[640,360]], "mapping.degree": [1,2]}}
// Factor keys are dotted paths into the spec. Each level may also be an object
// {"label": "...", "value": ...} to give readable tags.

function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  keys.slice(0, -1).forEach(k => { cur[k] = cur[k] && typeof cur[k] === 'object' ? {...cur[k]} : {}; cur = cur[k]; });
  cur[keys.at(-1)] = value;
}

export function expandSweep(sweep) {
  const entries = Object.entries(sweep.factors);
  let combos = [[]];
  for (const [path, levels] of entries) {
    combos = combos.flatMap(c => levels.map((lv, i) => [...c, {path, i, lv}]));
  }
  return combos.map((combo, idx) => {
    const spec = JSON.parse(JSON.stringify(sweep.base || {}));
    const labels = [];
    for (const {path, i, lv} of combo) {
      const isLabelled = lv && typeof lv === 'object' && 'label' in lv && 'value' in lv;
      setPath(spec, path, isLabelled ? lv.value : lv);
      labels.push(isLabelled ? lv.label : `${path.split('.').at(-1)}${i}`);
    }
    spec.tag = `${sweep.tagPrefix}-${String(idx + 1).padStart(3, '0')}`;
    spec.description = [sweep.description || '', labels.join(' ')].filter(Boolean).join(' | ');
    spec.sweepLabels = labels;
    if (sweep.frozen) spec.frozen = true;
    return spec;
  });
}

/** Load spec files: single spec, array of specs, or a sweep; returns normalised specs. */
export function loadSpecs(files) {
  const specs = [];
  for (const f of files) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    if (j.factors) specs.push(...expandSweep(j));
    else specs.push(...(Array.isArray(j) ? j : [j]));
  }
  return specs.map(normaliseSpec);
}
