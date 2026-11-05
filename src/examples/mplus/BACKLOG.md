# Mplus examples not yet in the app: what each needs

From an audit (November 2026) of every example COVERAGE.md lists as not in the app, against the
code and in R. "W" = available to webR; anything on CRAN can run on the desktop helper. A blocked
example is a feature to build (see COVERAGE.md).

## No new feature needed (add the example)

| Example | How |
| --- | --- |

## Small features

| Feature | Unlocks |
| --- | --- |
| Built: the custom likelihood card (5.23, 7.28). 3.10 runs on it, but Mplus's MLR standard errors are 5% smaller than the observed-information and sandwich ones (unexplained) | 3.10 |
| Missing-data summary card (patterns, coverage, EM moments, dropout) | 11.2 |

## Medium features

| Feature | Unlocks |
| --- | --- |
| Imputed-data TYPE = BASIC (averages over imputed data sets): chained equations (mice norm/logreg) differ from Mplus's joint H1 imputation by up to 3.4 Monte Carlo SDs in several covariances | 11.5 |

## Large features

| Feature | Unlocks |
| --- | --- |
| Quadrature ML for censored, count and categorical outcomes with factors or random effects | 3.17, 4.3, 5.4, 5.7, 6.2, 6.3, 6.16, 6.22, 8.3, 8.4, 8.5, 8.17, 9.2c, 9.3, 9.7, 9.8, 9.10, 9.22, 11.3, 7.18, 7.19, 7.29 |
| Mixture of factor analysers with rotation | 4.4 |
| Joint rotation of equal-loading ESEM blocks | 5.26 |
| Bayes on the helper: per-parameter priors, defined parameters, multigroup (wiggle), ordinal, brms/Stan models, DSEM | 3.18, 5.31, 5.32, 5.33, 6.26–6.28, 11.7, 9.19, 9.21, 9.24–9.40 (all random draws: within Monte Carlo error) |
| Two-level mixtures | 10.1–10.6, 10.8–10.13 |
| Two-level categorical estimation (WLSM/WLSMV), no R package | 4.6, 9.4, 9.9, 9.15, 9.13, 9.17, 9.18, 11.8 parts 1–3 |

## No data published

7.23 and 8.16 publish no data and no output.

## Built in November 2026 (now in the app)

5.27b–e (invariant ESEM rotates the unstandardised loadings, std.ov = FALSE), 3.15 (examples that open several cards: `morePanels`), 5.18 and 5.19 (an indicator in several CB-SEM factors), 5.23 and 7.28 (the custom likelihood card), 6.25 (the Bayesian multivariate regression card, exact posterior), 4.5 (the two-level EFA card), 11.6 (CB-SEM multiple imputation by mice's Bayesian normal regression, miMethod = micenorm). 5.5 parts 3–4 and 7.27 (mirt on the IRT card: 3PL and 4PL with priors on the asymptotes, robust standard errors, the 2PL mixture), 6.6 and 6.7 (the GLMM card, GLMMadaptive), 10.7 (multilevel latent classes on the LCA card, glca).

## Done: the mixture likelihood engine

The mixture model card (analyses/mixture.tsx, R/mixture.R) reads Mplus's syntax for TYPE = MIXTURE and fits 7.1, 7.2, 7.11–7.15,
7.17, 7.20, 7.21, 7.24, 7.26, 8.6–8.8, 8.11–8.15 with MLR standard errors; 7.25 and 7.30 run on the regression card. Not
added: 7.16 (Mplus's solution is not a maximum: see COVERAGE.md). Still needing numerical integration in a mixture
(categorical or count indicators of factors with variance): 7.18, 7.19, 7.29, 8.3, 8.4, 8.5 (7.27, mixture IRT, runs on the IRT card).
