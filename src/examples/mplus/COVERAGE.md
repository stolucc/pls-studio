# Mplus User's Guide examples: what the app covers

Every example of the Mplus User's Guide (chapters 3–11; chapter 12 is Monte Carlo
simulation, whose data Mplus generates at run time). An example is in the app only when it
runs and reproduces the printed Mplus output (the chapter tests, `chN.webr.test.ts`);
differences are stated in each example's description. Otherwise the reason is given here, and the
missing feature is to be built: a blocked example is a feature to add, not a reason to leave it out.

WLSMV examples use Mplus's standard errors (the app's default: the expected information in the sandwich,
divided by N; lavaan 0.7 puts the observed information there) and, where one group is fitted, Mplus's test
statistic (lavaan's mimic = "Mplus").

## Chapter 3: regression and path analysis

| Example | In the app | Reason if not |
| --- | --- | --- |
| 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8 (parts 1–2), 3.9, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16 | yes | |
| 3.10 | no | The custom likelihood card fits it (nominal logits with the non-linear constraint): log-likelihood −536.568 and the estimates 1.469, −0.398 reproduced, but Mplus’s MLR standard errors (0.040, 0.129) are 5% below the card’s (0.042, 0.136), which the observed information and the sandwich of the scores both give; no identified reason. |
| 3.17 | no | Monte Carlo integration (missing mediator, categorical outcome, MLR). |
| 3.18 | no | Bayes (blavaan is desktop-only; draws are random). |

## Chapter 4: exploratory factor analysis

| Example | In the app | Reason if not |
| --- | --- | --- |
| 4.1 (parts 1–2), 4.2, 4.5, 4.7 | yes | |
| 4.3 | no | Censored and count indicators. |
| 4.4 | no | Mixture EFA. |
| 4.6 | no | Two-level EFA of categorical items (WLSM). |

## Chapter 5: CFA and SEM

| Example | In the app | Reason if not |
| --- | --- | --- |
| 5.1, 5.2, 5.3, 5.5 (parts 1–2), 5.6, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 5.16, 5.17, 5.18, 5.19, 5.20, 5.21, 5.22, 5.23, 5.24, 5.25, 5.27 (and b–e), 5.28, 5.29, 5.30 | yes | |
| 5.4 | no | Censored and count indicators (numerical integration). |
| 5.5 (parts 3–4) | yes | The IRT card’s 3PL and 4PL models with priors (mirt). Part 4’s weakly determined items differ by up to 0.1 SE (Mplus’s 15-point rectangular integration; see the description). |
| 5.7 | no | Indicators on a quadratic factor term (f XWITH f). |
| 5.26 | no | Loading invariance across two ESEM blocks: lavaan rotates each block on its own. |
| 5.31, 5.32, 5.33 | no | Bayes with informative priors (blavaan desktop-only). |

## Chapter 6: growth, survival and time series

| Example | In the app | Reason if not |
| --- | --- | --- |
| 6.1, 6.4, 6.5, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.17, 6.18, 6.19, 6.20, 6.21, 6.23 (and b), 6.24, 6.25 | yes | |
| 6.6, 6.7 | yes | The GLMM card (GLMMadaptive). 6.7: Mplus’s 7 integration points move the zero part’s random intercept (variance 1.226 against 1.189, SE 0.535). |
| 6.2, 6.3, 6.16 | no | Censored and two-part growth (numerical integration). |
| 6.22 | no | Joint survival and factor model (integration). |
| 6.26 (and b), 6.27, 6.28 | no | Dynamic factor models by Bayes. |

## Chapters 7, 8 and 10: mixtures

| Example | In the app | Reason if not |
| --- | --- | --- |
| 7.1–7.15, 7.17, 7.20–7.22, 7.24–7.26, 7.28, 7.30, 8.1, 8.2, 8.6–8.15 (8.13 parts 1–2) | yes | (7.1, 7.2, 7.11–7.15, 7.17, 7.20, 7.21, 7.24, 7.26, 8.6–8.8, 8.11–8.15: the mixture model card; 7.25, 7.30: the regression card) |
| 7.16 | no | Mplus stops at −2598.111 with the WITH parameter at 0.000 (SE 3.1), u2's and u3's thresholds with SEs of 6.4 and a condition number of 0.57E-04: not a maximum. The model without the association reaches −2598.080 and with a loglinear association −2596.678, both above Mplus's value, so its estimates cannot be reproduced. |
| 8.3, 8.5 (parts 1–2) | no | Censored, count or categorical outcomes with growth factor variance: numerical integration. |
| 7.27 | yes | The IRT card’s 2PL mixture (mirt); standard errors not reproduced. |
| 7.18, 7.19, 7.29, 8.4 | no | Factors or random effects with categorical indicators in a mixture: numerical integration. |
| 7.23, 8.16 | no | No data published. |
| 8.17 | no | Cox survival mixture. |
| 10.7 | yes | The LCA card’s multilevel option (glca); standard errors not reproduced. |
| 10.1–10.6, 10.8–10.13 (and 10.2alt, 10.8alt) | no | Two-level mixtures. |

## Chapter 9: multilevel

| Example | In the app | Reason if not |
| --- | --- | --- |
| 9.1a, 9.1b, 9.2a, 9.2b, 9.5, 9.6, 9.11, 9.12, 9.14, 9.16, 9.20, 9.23 | yes | |
| 9.2c, 9.8, 9.10 | no | Random slopes inside a structural model (or with a latent covariate). |
| 9.3, 9.4, 9.7, 9.9, 9.13, 9.15, 9.17, 9.18 | no | Categorical, count or survival outcomes at two levels. |
| 9.19, 9.21, 9.22, 9.24–9.40 (all parts) | no | Bayes, three-level with categorical outcomes, cross-classified and DSEM models. |

## Chapter 11: missing data

| Example | In the app | Reason if not |
| --- | --- | --- |
| 11.1, 11.4, 11.6 | yes | |
| 11.2 | no | TYPE = BASIC with DATA MISSING (DDROPOUT): patterns, coverage, EM moments and Mplus's dropout descriptives; no card computes them yet. |
| 11.5 | no | Means and covariances averaged over 10 imputed data sets: mice (Bayesian normal regression, logistic for x1; one seed) differs from Mplus's averages by up to 3.4 Monte Carlo SDs in several covariances (y3, y4, x1 with x2), so Mplus's joint H1 imputation is not matched by chained equations. |
| 11.3 | no | Diggle–Kenward selection model (Monte Carlo integration). |
| 11.7, 11.8 (parts 1–3) | no | Bayesian plausible values; two-level categorical imputation. |
