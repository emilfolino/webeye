#!/usr/bin/env python3
"""Paired comparison of pipeline specs from `bin/replay.js` output.

Unit of analysis: participant x spec (x block), averaged over validation
repetitions. Every spec sees identical frames, so comparisons are paired.

  python analysis/analyze.py results/<run>/rows.csv --baseline v001-baseline \
      --metric mean_err_deg --out results/<run>/analysis

Outputs (in --out):
  summary.csv      per-spec mean / median / SD across participants
  contrasts.csv    each spec vs baseline: mean paired difference, cluster-bootstrap
                   95% CI (resampling participants), mixed-model estimate + p,
                   Holm-adjusted p across the family of contrasts
  paired.png       per-participant paired lines baseline -> spec

Inference is on participants, not on frames or targets (those are nested).
Exploratory (dev split) results should be labelled as such; confirmatory
analyses must use specs frozen before the confirm split was touched.
"""
import argparse
import os
import sys

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf


def holm(p):
    p = np.asarray(p, float)
    order = np.argsort(p)
    m = len(p)
    adj = np.empty(m)
    running = 0.0
    for rank, i in enumerate(order):
        running = max(running, (m - rank) * p[i])
        adj[i] = min(1.0, running)
    return adj


def load(path, role, level, metric, blocks):
    df = pd.read_csv(path)
    df = df[(df.role == role) & (df.level == level)]
    if 'fit_ok' in df:
        df = df[df.fit_ok == 1]
    if blocks:
        df = df[df.block.isin(blocks)]
    df = df.dropna(subset=[metric])
    # average over repetitions within participant x tag x block
    g = df.groupby(['participant', 'tag', 'block'], as_index=False)[metric].mean()
    return g


def cluster_bootstrap_ci(diff_by_pid, n_boot=5000, seed=1):
    rng = np.random.default_rng(seed)
    v = np.asarray(diff_by_pid)
    if len(v) < 2:
        return (np.nan, np.nan)
    means = np.array([rng.choice(v, len(v), replace=True).mean() for _ in range(n_boot)])
    return tuple(np.percentile(means, [2.5, 97.5]))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('rows')
    ap.add_argument('--baseline', required=True)
    ap.add_argument('--metric', default='mean_err_deg')
    ap.add_argument('--role', default='validation')
    ap.add_argument('--level', default='pooled')
    ap.add_argument('--blocks', nargs='*', help='restrict to these block ids')
    ap.add_argument('--tags', nargs='*', help='restrict to these spec tags (baseline always kept)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--no-plot', action='store_true')
    a = ap.parse_args(argv)

    os.makedirs(a.out, exist_ok=True)
    g = load(a.rows, a.role, a.level, a.metric, a.blocks)
    if a.tags:
        g = g[g.tag.isin(set(a.tags) | {a.baseline})]
    if a.baseline not in set(g.tag):
        sys.exit(f'baseline {a.baseline!r} not in data')

    # participant x tag means (collapse blocks) for the paired summaries
    pt = g.groupby(['participant', 'tag'], as_index=False)[a.metric].mean()
    wide = pt.pivot(index='participant', columns='tag', values=a.metric)

    summ = pt.groupby('tag')[a.metric].agg(['count', 'mean', 'median', 'std']).reset_index()
    summ.to_csv(os.path.join(a.out, 'summary.csv'), index=False)

    rows = []
    for tag in [t for t in wide.columns if t != a.baseline]:
        pair = wide[[a.baseline, tag]].dropna()
        d = (pair[tag] - pair[a.baseline]).values
        lo, hi = cluster_bootstrap_ci(d)
        est = p = np.nan
        sub = g[g.tag.isin([a.baseline, tag])].rename(columns={a.metric: 'y'})
        sub = sub[sub.participant.isin(pair.index)].copy()
        sub['spec'] = (sub.tag == tag).astype(int)
        try:
            # random intercept per participant; block fixed effect absorbs condition differences
            f = 'y ~ spec + C(block)' if sub.block.nunique() > 1 else 'y ~ spec'
            fit = smf.mixedlm(f, sub, groups=sub['participant']).fit(reml=True)
            est, p = float(fit.params['spec']), float(fit.pvalues['spec'])
        except Exception as e:  # singular fits happen with few participants
            print(f'mixedlm failed for {tag}: {e}', file=sys.stderr)
        rows.append({'tag': tag, 'n_participants': len(d), 'mean_diff': d.mean() if len(d) else np.nan,
                     'boot_lo': lo, 'boot_hi': hi, 'dz': d.mean() / d.std(ddof=1) if len(d) > 1 and d.std(ddof=1) > 0 else np.nan,
                     'lmm_est': est, 'p': p})
    con = pd.DataFrame(rows)
    if len(con):
        ok = con.p.notna()
        con['p_holm'] = np.nan
        con.loc[ok, 'p_holm'] = holm(con.loc[ok, 'p'])
    con.to_csv(os.path.join(a.out, 'contrasts.csv'), index=False)

    print(f'metric={a.metric}  role={a.role}  participants={wide.shape[0]}  baseline={a.baseline}')
    print(summ.to_string(index=False))
    print(con.to_string(index=False))

    if not a.no_plot and len(con):
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        tags = [a.baseline] + list(con.tag)
        fig, ax = plt.subplots(figsize=(1.6 * len(tags) + 2, 4))
        for pid, r in wide.iterrows():
            ax.plot(range(len(tags)), [r.get(t, np.nan) for t in tags], color='0.7', lw=0.8, marker='o', ms=3)
        ax.plot(range(len(tags)), [wide[t].mean() for t in tags], color='C3', lw=2, marker='D', label='mean')
        ax.set_xticks(range(len(tags)))
        ax.set_xticklabels(tags, rotation=30, ha='right')
        ax.set_ylabel(a.metric)
        ax.legend()
        fig.tight_layout()
        fig.savefig(os.path.join(a.out, 'paired.png'), dpi=150)


if __name__ == '__main__':
    main()
