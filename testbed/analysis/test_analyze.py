import os, subprocess, sys, tempfile
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
import analyze


def synth(path, effect=0.5, n=12, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for p in range(n):
        base = 2 + rng.normal(0, 0.5)
        for tag, e in [('base', 0), ('better', -effect), ('same', 0)]:
            for blk in ['b1', 'b2']:
                for rep in range(2):
                    rows.append(dict(participant=f'P{p}', tag=tag, block=blk, role='validation', level='pooled',
                                     rep=rep, fit_ok=1, mean_err_deg=base + e + rng.normal(0, 0.15)))
    pd.DataFrame(rows).to_csv(path, index=False)


def test_detects_effect_and_not_null():
    with tempfile.TemporaryDirectory() as d:
        csv = os.path.join(d, 'rows.csv')
        synth(csv)
        analyze.main([csv, '--baseline', 'base', '--out', os.path.join(d, 'o'), '--no-plot'])
        c = pd.read_csv(os.path.join(d, 'o', 'contrasts.csv')).set_index('tag')
        assert c.loc['better', 'mean_diff'] < -0.4
        assert c.loc['better', 'p_holm'] < 0.001
        assert c.loc['better', 'boot_hi'] < 0
        assert c.loc['same', 'p_holm'] > 0.05


def test_holm_monotone():
    adj = analyze.holm([0.01, 0.04, 0.03])
    assert np.allclose(adj, [0.03, 0.06, 0.06])
