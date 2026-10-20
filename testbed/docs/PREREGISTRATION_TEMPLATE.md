# Pre-registration template (fill in, register on OSF/AsPredicted before touching `confirm` data)

1. **Research questions / hypotheses** (directional where justified):
   - H1: Higher input resolution lowers mean angular error (4K-derived 1080p/720p/480p).
   - H2: ... (runtime, mapping, filtering)
2. **Design**: within-subject; every pipeline spec is replayed on identical recordings. Factors and levels: ______ (from `pipelines/confirmatory.sweep.json`, frozen at commit ______, spec hashes ______).
3. **Sample**: target N = ____ (justification / simulation-based power), `dev` fraction 0.3 via salted hash (`salt` = ______), stopping rule: ______.
4. **Inclusion / exclusion** (fixed before data): sessions failing `validate-session.js`; GP3 validation error > ___ deg; participants with > ___% no-face frames in the baseline pipeline; how exclusions are reported.
5. **Primary outcome**: mean validation error (deg) per participant x spec, averaged over repetitions. **Secondary**: p95 error, precision (SD, RMS-S2S), data loss, pursuit lag, drift across repetitions, ms/frame.
6. **Analysis**: linear mixed model (participant random intercept, block fixed), cluster bootstrap CIs over participants (5000 resamples), Holm correction over the confirmatory contrast family. Alpha = 0.05. Equivalence margin for "no difference": ___ deg.
7. **Exploratory analyses** (dev split only, labelled as such): ______.
8. **Deviations** will be listed in the paper.
9. **Data/code availability**: derived landmarks released for consenting participants; raw video only with opt-in consent; code and specs at ______.
