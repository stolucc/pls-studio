# PLS Studio

Browser-based editor for structural equation modelling: PLS-SEM, consistent PLS and composites,
and covariance-based SEM. Calculations are done by the reference R packages (lavaan, cSEM,
seminr, MIIVsem, semTools) running in the browser via [webR](https://docs.r-wasm.org/webr/),
or by a built-in engine validated against them. Data never leave the computer, and every
analysis can be exported as the R script that produced it.

## Run

```bash
npm install
npm run webr:fetch # webR + pinned R packages (and their sources) into public/webr (~300 MB, once)
npm run data:fetch # example data the app may not distribute (Mplus User's Guide, RI-CLPM) into .cache/, for the tests
npm run dev        # http://localhost:5175
npm test           # client tests; npm run test:webr runs the R packages in webR; npm run test:server
npm run build      # production build in dist/ (fetches public/webr if missing; strict CSP injected)
```

The R packages are pinned in `scripts/webr/webr-lock.json` (versions and checksums) and served from
the app's own origin; no code is loaded from third parties at run time (only the data of examples whose licence
does not let PLS Studio distribute them, downloaded from their source when such an example is opened). The page must be served
cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy:
require-corp`) and allow WebAssembly (`script-src 'wasm-unsafe-eval'`); the dev/preview servers and
`server/` do this.

## Licence

PLS Studio is free software: GNU General Public License, version 2 or (at your option) any later
version ([LICENSE](LICENSE)). It serves webR and R packages that keep their own licences (many GPL);
the source of every served version is published with the app (`public/webr/src`) and listed in the
app's **About & licences** dialog. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for all
components, fonts and datasets (`npm run notices` regenerates it).

Data credits: the gamification example uses the replication package of Stol, Schaarschmidt &
Goldblit (2022), *Empirical Software Engineering* 27:35 (doi:10.5281/zenodo.6322761, CC BY 4.0);
the other example and test datasets come from the R packages lavaan, seminr and cSEM.

## Methods

| | PLS-SEM | PLSc | CB-SEM |
|---|---|---|---|
| Estimation | Wold/Lohmöller PLS (path, factor, centroid) | PLS + ρA correction of common factors | ML, MLM, MLMV, MLR, GLS, ULS; MIIV-2SLS (Bollen 1996) |
| Constructs | common factors (ellipse), composites (hexagon), Mode A/B | same | common factors |
| Moderation | two-stage interaction, simple slopes | — | latent interaction (matched-pair product indicators), Johnson–Neyman |
| Inference | bootstrap | bootstrap | (robust) SEs; bootstrap for indirect effects |
| Fit | SRMR, d_ULS, d_G + bootstrap test of exact fit (HI95/HI99) | same | χ² (scaled/shifted), CFI/TLI/RMSEA (+ scaled, robust), SRMR, AIC/BIC |
| Other | IPMA (construct and indicator level), HTMT/HTMT2 | same | HTMT/HTMT2, residual correlations |

**Covariance-matrix input** (CB-SEM): import a labelled covariance matrix CSV (as from R's
`write.csv(cov(x))`), give N, and optionally a NACOV matrix for robust MLM/MLMV, as lavaan's
`sample.cov` / `sample.nobs` / `NACOV`. CB-SEM also supports second-order factors and observed
covariates with lavaan's `fixed.x` semantics (drawn as rectangles).

**MIIV-2SLS**: Bollen's model-implied instrumental variables. Each measurement, second-order and
structural equation is estimated separately by 2SLS on scaling indicators, with automatically derived
instruments and a Sargan overidentification test per equation; works from raw data or a covariance
matrix. Misspecification in one equation does not propagate to others.

**Examples**: 364 examples from the R packages' own documentation (lavaan, dynamic, sirt, mnlfa, MIIVsem, modsem, manymome, plspm, genpathmox, ivreg, REndo, sampleSelection, MatchIt, RSA, NCA, QCA,
cSEM, seminr, ltm, mirt, poLCA, glca, lme4, GLMMadaptive, lcmm, did, fixest, MASS, nnet, datasets, carData, faraway, BayesFactor, blavaan, semPower, metaSEM, semtree, lslx, misty, SEMsens, mediation, strucchange, INLAvaan, nonnest2, pscl, plssem; data loaded from the packages, each linked to its source) and from the Mplus User's Guide (Muthén & Muthén; their generated example data are not distributed with the app but downloaded from statmodel.com each time an example is opened, through the PLS Studio server or the desktop helper, fitted with lavaan, glm, survival, ltm, mirt, poLCA, glca, lme4, GLMMadaptive, modsem and maximum likelihood written out in R), plus a synthetic customer survey (PLS, raw data) and the published model of Stol,
Schaarschmidt & Goldblit (2022), *Gamification in software engineering*, Empirical Software
Engineering 27:35 (CB-SEM, MLM, from the covariance and NACOV matrices of the replication
package, doi:10.5281/zenodo.6322761, CC BY 4.0). The example reproduces the paper's results.

**Monte Carlo** (Simulate button): specify a population (common factors with loadings, composites
with weights and indicator correlations, standardised paths, exogenous correlations; or take the
current estimates), then run replications at several sample sizes with any mix of PLS, PLSc and
CB-SEM estimators. Reports mean, bias, relative bias, SD, RMSE, CI coverage and power (Type I error
for zero paths), with power curves. Data can be multivariate normal or non-normal (Vale–Maurelli:
Fleishman polynomials with target skewness/excess kurtosis, population correlations preserved);
for CB-SEM estimators the model χ² test's rejection rate is tracked, showing e.g. ML over-rejecting
under kurtosis while the Satorra–Bentler χ² holds its level. CB-SEM also offers Monte Carlo CIs for indirect effects
(Preacher & Selig 2012).

Bootstrapping, the fit test and simulations run on all CPU cores (one Web Worker per core, minus one).
Each bootstrap sample has its own seed, so results are identical whatever the core count.

## Collaboration

Sign in (email + password with optional TOTP, or Google), use **Share** to upload a project
and invite people by email as editors or viewers, and edit together in real time: live
cursors, selections and presence, merged edits (Y.js), undo that only reverts your own
changes. Shared datasets are stored encrypted on the server (AES-256-GCM, per-project keys).
Calculations run on each person's computer. The server lives in `server/` (see its README);
`npm run server` starts it for development.

## Home screen

The app opens on a home screen: start a new project (empty, or from a data file), open a project
file, reopen a recent project, or open an example. Projects are kept automatically under Recent
projects in this browser (IndexedDB); Save still writes a portable `.plsproj.json` file. The Home
button (or the logo) in the editor returns to it.

## Features

- Import CSV (comma/semicolon/tab, quoted fields, decimal comma, missing codes)
- Draw models: drag variables onto the canvas to create constructs, drop onto a construct to add
  indicators, drag from a construct's dot to draw a path; reflective (Mode A) or formative (Mode B)
- PLS algorithm: path / factor / centroid weighting, mean replacement or casewise deletion
- Results on the diagram (β, R², loadings/weights) and in tables:
  R², adj. R², f², inner/outer VIF, loadings, weights, Cronbach's α, ρA, ρC, AVE, HTMT,
  Fornell–Larcker, construct correlations, indirect and total effects, construct scores
- Bootstrapping with seeded RNG: standard errors, t, p, percentile CIs, cancellable
- Undo/redo, auto-arrange, save/open project files (`.plsproj.json`, includes data), autosave
- Copy any table as TSV or download as CSV

## Shortcuts

V select · C add construct · P draw path · Del delete · ⌘Z / ⌘⇧Z undo/redo ·
⌘S save · ⌘O open · ⌘↵ calculate · ⌘⇧↵ bootstrap

## Design

`ARCHITECTURE.md` describes how the app is put together: the stores, the built-in engine, how the
front end talks to R (webR and the desktop helper), the Analyses log, collaboration and deployment.

## Validation

Three layers, run by `.github/workflows/ci.yml` on every push:

1. **The estimators are the R packages themselves.** lavaan, cSEM, seminr, MIIVsem, semTools, modsem, mice and
   the rest run unchanged in webR (versions pinned in `scripts/webr/webr-lock.json`). Only the built-in PLS
   engine (`src/engine`) and the simulation engine are reimplementations.
2. **Native R references.** `npm test` runs ~900 client tests, among them a reference corpus in
   `src/engine/__fixtures__/validation` (54 cases) produced by `npm run validate:generate`
   (`scripts/validation/generate.R`) and further fixtures from the 37 scripts in `scripts/validation/`, all
   written by native R. `npm run test:webr` (~900 tests) re-runs the packages in webR, through the same bridge
   code the app uses, and compares with those fixtures; the slowest checks run only with `WEBR_SLOW=1`
   (`npm run test:webr:all`, nightly in CI). `npm run test:native` runs the same tests with the bridge's calls
   in desktop R instead of webR (the helper's R workers and library, `src/rengine/nativeR.ts`): several times
   faster, for development; the validation record is always produced with webR, which is what the browser
   computes. `npm run test:server` runs the server's 61 integration tests against a real PostgreSQL database.
3. **Published results.** `src/rengine/published.webr.test.ts` reproduces, to the printed three decimals and
   with every engine (seminr, cSEM, built-in), values printed by other people with other software: the
   corporate reputation models of Hair et al. (2021), *PLS-SEM Using R*, chapters 4 and 6 (reliabilities,
   √AVE, correlations, loadings, paths, R², total effects, f²; the SmartPLS case study of the authors' Primer),
   and the ECSI model of Monecke & Leisch (2012, *J. Stat. Software* 48(3)) on mobi (12 paths, 24 loadings,
   centroid scheme). Tenenhaus et al. (2005, Fig. 2) fitted ECSI to unstandardised indicators, which the app
   does not do (plspm with `scaled = FALSE` reproduces that figure).

**The evidence users see.** Every comparison these tests make is also recorded: `npm run validate:evidence` runs the
webR tests with `PS_VALIDATION_DIR` set, then the plain tests listed in `src/validation/evidenceRuns.json` (`fixture`:
the built-in engine against R fixtures, recorded desktop runs) without R, and writes `public/validation.json`
(`src/validation/`: `record.ts` grades the examples, `setup.ts` records every `toBeCloseTo` and `near()` of the feature
tests listed in `features.ts`). `npm run validate:evidence:desktop` adds the desktop-only packages' tests (metaSEM,
semtree, plssem; `evidenceRuns.json` `desktop`), run in desktop R and marked as such. `src/validation/cards.ts` names the
correctness evidence of every analysis card, every mode of a card, the Model tab's analyses and the built-in engine;
`cards.test.ts` keeps it complete. The app shows it all as a badge on each example (reproduces published results /
matches native R / recovers known values / runs as documented), a Validation page with every number compared and an
Analyses tab listing every analysis with its evidence, a "Check this browser" self-check that re-runs ten examples and
compares their digests, and a badge on the results of an unmodified example. `src/validation/evidence.test.ts` fails
when the record is incomplete (an example, test file or analysis without checks), has a failed check, is older than an
example's definition, or was made with other package versions.

Independently of all this, **File → Download R script** gives the exact lavaan/cSEM/seminr syntax a project
runs, and a replication package bundles it with the data: run it in native R and compare.

The reference corpus:

| Reference | Cases |
|---|---|
| seminr 2.3.2 | PLS on mobi (Mode A/B), corp_rep (Hair et al.), two-stage moderation (2) |
| plspm 0.5 | PLS on satisfaction, path / factor / centroid schemes |
| cSEM 0.5.0 | PLSc, composite models, SRMR/d_ULS/d_G, HTMT/HTMT2, IPMA (raw, rescaled, bounded) |
| MIIVsem 0.5.8 | MIIV-2SLS: instrument sets, coefficients, SEs, Sargan tests (Holzinger–Swineford, PoliticalDemocracy, mobi, Stol et al. 2022 from its covariance matrix) |
| semTools 0.5.6 | Monte Carlo CIs for indirect effects (ML, MLR); HTMT/HTMT2 from a covariance matrix |
| Stol et al. (2022) replication package | the paper's SEM (ML, MLM with NACOV: second-order factor, fixed.x covariates, indirect effect) and second-order CFA, reproduced via lavaan |
| lavaan 0.6.16 | Holzinger–Swineford, PoliticalDemocracy, threecommonfactors, mobi × ML/MLM/MLMV/MLR/GLS/ULS; latent interactions with conditional effects (Johnson–Neyman) |

Every estimate, standard error, z, p, standardised value, R² and fit measure is compared
(tolerance 1e-5 relative). A fit measure reported by lavaan but missing here fails the test.

Vale–Maurelli: Fleishman coefficients and intermediate correlations match high-precision R
solutions to 1e-9 (`scripts/make-vm-fixtures.R`) and Fleishman's published table.

The simulation engine is checked by exactness tests: on samples rotated to the population
covariance, CB-ML and PLSc recover common-factor populations and PLS Mode B recovers composite
populations to 1e-6; replication splitting across workers is result-invariant; CB-ML coverage,
Type I error and PLS attenuation behave as theory predicts.

Conventions matched (documented in code): lavaan fits GLS/ULS to the unbiased covariance
matrix and uses N − 1 for their χ², SEs and RMSEA; SRMR is Bentler's (observed SDs); d_G
uses the natural log (cSEM uses log10); f² re-estimates the model without the path; two-stage
interaction effects are per unit of the product of standardised scores (as seminr); ρA is reported for
Mode A constructs under every engine (cSEM itself reports 1 for every construct when not disattenuating,
as all are composites then; the bridge computes Dijkstra & Henseler's ρA from the weights, as seminr does).
