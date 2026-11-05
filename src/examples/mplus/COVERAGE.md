# Mplus User's Guide examples: what the app covers

Every example of the Mplus User's Guide (chapters 3–11; chapter 12 is Monte Carlo
simulation, whose data Mplus generates at run time). An example is in the app only when it
runs and reproduces the printed Mplus output (the chapter tests, `chN.webr.test.ts`);
differences are stated in each example's description. Otherwise the reason is given here.

## Chapter 3: regression and path analysis

| Example | In the app | Reason if not |
| --- | --- | --- |
| 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8 (parts 1–2), 3.11 | yes | |
| 3.9 | no | A random slope in a single-level model (the residual variance quadratic in x1): no card fits it. |
| 3.10 | no | Non-linear MODEL CONSTRAINT between the logits of a nominal outcome. |
| 3.12, 3.13, 3.14 | no | Categorical path models: lavaan's WLSMV estimates match, several standard errors differ from Mplus's by up to 7% for no identified reason. |
| 3.15 | no | Censored, categorical and nominal outcomes in one ML path model. |
| 3.16 | no | 3.11 with 1000 bootstrap draws: random, and CB-SEM has no bootstrap standard errors. |
| 3.17 | no | Monte Carlo integration (missing mediator, categorical outcome, MLR). |
| 3.18 | no | Bayes (blavaan is desktop-only; draws are random). |

## Chapter 4: exploratory factor analysis

| Example | In the app | Reason if not |
| --- | --- | --- |
| 4.1 (parts 1–2), 4.2, 4.7 | yes | |
| 4.3 | no | Censored and count indicators. |
| 4.4 | no | Mixture EFA. |
| 4.5, 4.6 | no | Two-level EFA (unrestricted levels; categorical two-level). |

## Chapter 5: CFA and SEM

| Example | In the app | Reason if not |
| --- | --- | --- |
| 5.1, 5.2, 5.3, 5.5 (parts 1–2), 5.6, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 5.16, 5.17, 5.20, 5.21, 5.22, 5.24, 5.25, 5.27, 5.28, 5.29, 5.30 | yes | |
| 5.4 | no | Censored and count indicators (numerical integration). |
| 5.5 (parts 3–4) | no | 3PL/4PL with Mplus's priors on the guessing parameters; ltm has no priors and no 4PL. |
| 5.7 | no | Indicators on a quadratic factor term (f XWITH f). |
| 5.18, 5.19 | no | ACE factors sharing indicators; 5.21 and 5.22 are the same models through constraints. |
| 5.23 | no | A constraint on a per-person data value (pihat). |
| 5.26 | no | Loading invariance across two ESEM blocks: lavaan rotates each block on its own. |
| 5.27 (parts b–e) | no | Invariant ESEM: lavaan matches the fit but rotates differently. |
| 5.31, 5.32, 5.33 | no | Bayes with informative priors (blavaan desktop-only). |

## Chapter 6: growth, survival and time series

| Example | In the app | Reason if not |
| --- | --- | --- |
| 6.1, 6.8, 6.9, 6.10, 6.11, 6.13, 6.14, 6.17, 6.18, 6.19, 6.20, 6.21, 6.23 (and b), 6.24 | yes | |
| 6.2, 6.3, 6.6, 6.7, 6.16 | no | Censored, count and two-part growth (numerical integration). |
| 6.4, 6.5, 6.15 | no | Categorical growth: estimates match, standard errors 2–6% off. |
| 6.12 | no | Random slopes of time-varying covariates with occasion-specific residual variances. |
| 6.22 | no | Joint survival and factor model (integration). |
| 6.25 | no | Bivariate Bayes time series: the ML residual variances differ from Mplus's posterior medians. |
| 6.26 (and b), 6.27, 6.28 | no | Dynamic factor models by Bayes. |

## Chapters 7, 8 and 10: mixtures

| Example | In the app | Reason if not |
| --- | --- | --- |
| 7.3–7.10, 7.22, 8.1, 8.2, 8.9, 8.10 | yes | |
| 7.1 | no | Mixture regression: flexmix does not reach Mplus's maximum. |
| 7.2, 7.11, 7.25, 8.3, 8.5 (parts 1–2), 8.11 | no | Zero-inflated, censored or count indicators/outcomes in a mixture. |
| 7.12, 7.13, 7.16, 7.24 | no | Direct effects, parameter constraints or within-class residual covariances in LCA. |
| 7.14, 7.15, 7.18, 8.7, 8.12–8.15 (8.13 parts 1–2) | no | Several categorical latent variables (loglinear, latent transition, hidden Markov). |
| 7.17, 7.19, 7.20, 7.26, 7.27, 8.4 | no | Factor mixtures or random effects needing integration. |
| 7.21, 7.28, 7.29, 8.8 | no | KNOWNCLASS (and twin constraints). |
| 7.23, 8.16 | no | No data published. |
| 7.30, 8.17 | no | Cox survival mixtures. |
| 8.6 | no | Growth mixture with a categorical distal outcome. |
| 10.1–10.13 (and 10.2alt, 10.8alt) | no | Two-level mixtures. |

## Chapter 9: multilevel

| Example | In the app | Reason if not |
| --- | --- | --- |
| 9.1a, 9.1b, 9.2a, 9.2b, 9.6, 9.16 | yes | |
| 9.2c, 9.5, 9.8, 9.10, 9.14 | no | Random slopes inside a structural model (or with a latent covariate). |
| 9.3, 9.4, 9.7, 9.9, 9.13, 9.15, 9.17, 9.18 | no | Categorical, count or survival outcomes at two levels. |
| 9.11 | no | Two-level two-group: weakly identified between level, estimates differ by up to 0.07. |
| 9.12 | no | The log-likelihood differs by 0.03 for an unidentified reason. |
| 9.19–9.40 (all parts) | no | Bayes, three-level, cross-classified and DSEM models. |

## Chapter 11: missing data

| Example | In the app | Reason if not |
| --- | --- | --- |
| 11.1, 11.4 | yes | |
| 11.2, 11.5 | no | Descriptive statistics only (TYPE = BASIC). |
| 11.3 | no | Diggle–Kenward selection model (Monte Carlo integration). |
| 11.6 | no | Multiple imputation from Mplus's Bayesian H1 model: random draws. |
| 11.7, 11.8 (parts 1–3) | no | Bayesian plausible values; two-level categorical imputation. |
