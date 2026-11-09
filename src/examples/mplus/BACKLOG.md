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

## Medium features

| Feature | Unlocks |
| --- | --- |

## Large features

| Feature | Unlocks |
| --- | --- |
| Built: the integration card (one level, no mixture) and integration in the mixture engine (7.16, 7.18, 7.19, 7.27, 7.29, 8.3, 8.5 part 2, two-level mixtures). Still needing: a faster optimizer for integrated mixtures (8.4, 8.5 part 1, 10.1, 10.5, 10.8–10.10, 10.12: the likelihood is right — at Mplus’s estimates it reproduces the printed values — but BFGS between adaptations crawls, or takes longer than a browser card may), a Cox baseline hazard in a mixture (8.17), at two levels without a mixture, and EFA of mixed indicators | 4.3, 8.4, 8.5 part 1, 8.17, 10.1, 10.5, 10.8–10.10, 10.12, 9.2c, 9.3, 9.7, 9.8, 9.10, 9.22 |
| Mixture of factor analysers with rotation | 4.4 |
| Bayes on the helper, still to add to the DSEM card: three levels with a level-2 observed variable that has a level-3 part and covariances with observed between-level outcomes; faster sampling of long series of latent states (9.36: hours; 9.33b: an ARMA residual factor does not converge). 9.19 part 2: an improper posterior under Mplus’s flat priors | 9.19 part 2, 9.21, 9.33b, 9.36 |
| Two-level categorical estimation (WLSM/WLSMV), no R package | 4.6, 9.4, 9.9, 9.15, 9.13, 9.17, 9.18, 11.8 parts 1–3 |

## No data published

7.23 and 8.16 publish no data and no output.

## Built in November 2026 (now in the app)

3.10 (the custom likelihood card's standard errors “Sandwich, Mplus’s information under constraints”: Mplus’s MLR for
parameters under MODEL CONSTRAINT counts the parts’ curvature term twice, which reproduces its SEs and scaling factor
0.9447), 5.16 and 5.17 with Mplus’s χ² (mimic’s test-statistic options written out with groups; 5.17’s female group:
Mplus stopped on a flat stretch, shown by fixing f1’s variance at its value), ordinal mediators of other outcomes
(delta), 5.26 (invariant ESEM blocks rotated jointly: geomin’s stationarity conditions as constraints), 11.2 (the
missing-data card), 11.5 (joint H1 imputation, miMethod = joint), repeated measures with several between factors
(car::Anova, type II) and Friedman / post hoc tests per within factor, seminr’s PLSpredict and LM benchmark.
Not resolved: 9.23’s log-likelihood (Mplus −56044.769, 0.055 above the maximum of the same 25-parameter model, which
Mplus’s own printed estimates do not reach either: −56044.83).

5.27b–e (invariant ESEM rotates the unstandardised loadings, std.ov = FALSE), 3.15 (examples that open several cards: `morePanels`), 5.18 and 5.19 (an indicator in several CB-SEM factors), 5.23 and 7.28 (the custom likelihood card), 6.25 (the Bayesian multivariate regression card, exact posterior), 4.5 (the two-level EFA card), 11.6 (CB-SEM multiple imputation by mice's Bayesian normal regression, miMethod = micenorm). 5.5 parts 3–4 and 7.27 (mirt on the IRT card: 3PL and 4PL with priors on the asymptotes, robust standard errors, the 2PL mixture), 6.6 and 6.7 (the GLMM card, GLMMadaptive), 10.7 (multilevel latent classes on the LCA card, glca). 3.18, 5.31–5.33 and 11.7 (the Bayesian SEM card, blavaan in desktop R: Mplus’s default priors, priors on labelled parameters, approximate invariance by wiggle, a quantity over a moderator (LOOP), ordinal indicators, plausible values; run natively by bsem.native.test.ts, recorded in __fixtures__/blavaan/mplus.json). 6.26–6.28, 9.19 parts 1 and 3, 9.24–9.26, 9.28–9.40 (the Bayesian multilevel / DSEM card: Mplus’s syntax read into a Stan program, sampled by rstan in desktop R; random intercepts, slopes, loadings and log residual variances, cross-classified clusters, lags of observed variables and factors, MODEL PRIORS; run natively by dsem.native.test.ts, recorded in __fixtures__/dsem/mplus.json).

## Done: the integration engine

The integration card (analyses/quadml.tsx, quadmlSyntax.ts, R/quadml.R) reads Mplus's syntax for one-level models with
continuous latent variables and censored (and censored-inflated), count (Poisson, negative binomial, zero-inflated),
categorical (logit, probit; 3PL and 4PL with MODEL PRIORS), survival (piecewise-constant baseline hazard) or XWITH
outcomes, and continuous mediators missing for some cases; maximum likelihood by Mplus's integration rule (adaptive
rectangular, 15 points over ±5, fewer over ±points/2; Gauss–Hermite, Monte Carlo), MLR standard errors. It fits 3.17,
5.4, 5.7, 6.2, 6.3, 6.16, 6.22 and 11.3, and is the GLMM card's option for Mplus's rule (6.6, 6.7). The IRT card has the
same option (2PL, 3PL, 4PL with priors).

## Done: integration and two levels in the mixture engine

The mixture model card integrates continuous latent variables numerically (R/mixture.R, mixq_*: Mplus's rule by
default, rectangular with 15 points per dimension over ±5, adaptive per case or cluster and per class; GAUSSHERMITE and
MONTECARLO; Fisher's-identity scores, MLR sandwich), inside the classes (factors of categorical, count, censored or
negative binomial outcomes, growth factors with variance) or outside them (c ON f; cluster-level random effects), with
non-linear MODEL CONSTRAINT (NEW parameters), RESCOVARIANCES, and TYPE = TWOLEVEL MIXTURE (CLUSTER, WITHIN, BETWEEN,
%WITHIN%/%BETWEEN%, cluster-level random intercepts of outcomes and class logits, between factors and latent class
variables, cluster-level outcomes, random slopes without variance). Random starts run over the app's parallel R sessions
(the same result with any number). See COVERAGE.md for what each example reproduces.

## Done: the mixture likelihood engine

The mixture model card (analyses/mixture.tsx, R/mixture.R) reads Mplus's syntax for TYPE = MIXTURE and fits 7.1, 7.2, 7.11–7.15,
7.17, 7.20, 7.21, 7.24, 7.26, 8.6–8.8, 8.11–8.15 with MLR standard errors; 7.25 and 7.30 run on the regression card. Not
added: 7.16 (Mplus's solution is not a maximum: see COVERAGE.md). Still needing numerical integration in a mixture
(categorical or count indicators of factors with variance): 7.18, 7.19, 7.29, 8.3, 8.4, 8.5 (7.27, mixture IRT, runs on the IRT card).
