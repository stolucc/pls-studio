# Mplus User's Guide examples: what the app covers

Every example of the Mplus User's Guide (chapters 3–11; chapter 12 is Monte Carlo
simulation, whose data Mplus generates at run time). An example is in the app only when it
runs and reproduces the printed Mplus output (the chapter tests, `chN.webr.test.ts`);
differences are stated in each example's description. Otherwise the reason is given here, and the
missing feature is to be built: a blocked example is a feature to add, not a reason to leave it out.

WLSMV examples use Mplus's standard errors (the app's default: the expected information in the sandwich,
divided by N; lavaan 0.7 puts the observed information there) and Mplus's test statistic (lavaan's mimic = "Mplus";
with groups the options mimic sets for the statistic are written out, since mimic itself would also hold loadings
and thresholds equal in a configural model). An ordinal mediator whose predictors include other outcomes (delta
parameterisation) stands for its own variable in the lavaan syntax, so lavaan imposes the non-linear constraint on
its residual variance (checked against the same model written as syntax).

## Chapter 3: regression and path analysis

| Example | In the app | Reason if not |
| --- | --- | --- |
| 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8 (parts 1–2), 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16 | yes | |
| 3.17 | yes | The integration card: the exact likelihood (the missing mediator integrated over); Mplus’s Monte Carlo integration (250 random points) moves its log-likelihood by 0.07 and the estimates by up to 0.005 (see the description). |
| 3.18 | yes | The Bayesian SEM card (blavaan, desktop R) with Mplus’s priors and the indirect effect over the moderator (LOOP); posterior medians within 0.03 SDs of Mplus’s. |

## Chapter 4: exploratory factor analysis

| Example | In the app | Reason if not |
| --- | --- | --- |
| 4.1 (parts 1–2), 4.2, 4.5, 4.7 | yes | |
| 4.3 | no | EFA with censored, count and categorical indicators: the integration card fits each number of factors unrotated, but Mplus’s one-factor log-likelihood (−6933.890) is above the exact maximum (−6934.026) and above what Mplus’s 7- and 15-point rectangular rules give (−6935.679, −6933.946), with Heywood solutions and saddle points for 3–4 factors; its EFA rule and the rotation of these models (geomin, with standard errors) are not built. |
| 4.4 | no | Mixture EFA (TYPE = MIXTURE EFA 1 2): a mixture of factor analysers with class-specific geomin rotation and rotated SEs is not built yet (the mixture engine fits the unrotated class-specific factor models; the per-class rotation and its delta-method SEs are missing). |
| 4.6 | no | Two-level EFA of categorical items (WLSM). |

## Chapter 5: CFA and SEM

| Example | In the app | Reason if not |
| --- | --- | --- |
| 5.1, 5.2, 5.3, 5.5 (parts 1–2), 5.6, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 5.16, 5.17, 5.18, 5.19, 5.20, 5.21, 5.22, 5.23, 5.24, 5.25, 5.26, 5.27 (and b–e), 5.28, 5.29, 5.30 | yes | |
| 5.4 | yes | The integration card (Mplus’s adaptive rectangular rule). |
| 5.5 (parts 3–4) | yes | The IRT card’s 3PL and 4PL models with priors (mirt). Part 4’s weakly determined items differ by up to 0.1 SE (Mplus’s 15-point rectangular integration; see the description). |
| 5.7 | yes | The integration card (XWITH). Mplus stops before the maximum of its own integration rule on this flat likelihood: estimates within 0.02 (see the description). |
| 5.31, 5.32, 5.33 | yes | The Bayesian SEM card (blavaan, desktop R): priors on labelled parameters (MODEL PRIORS), Mplus’s default priors, approximate invariance (5.33: blavaan’s wiggle, whose prior centres the groups on the first rather than on each other, as stated). Within Monte Carlo error of Mplus (tolerances in bsemkit.ts); 5.33 within 0.70 SDs. |

## Chapter 6: growth, survival and time series

| Example | In the app | Reason if not |
| --- | --- | --- |
| 6.1, 6.4, 6.5, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.17, 6.18, 6.19, 6.20, 6.21, 6.23 (and b), 6.24, 6.25 | yes | |
| 6.6, 6.7 | yes | The GLMM card with Mplus’s integration rule (its option: adaptive rectangular, 15 points over ±5, 7 points over ±3.5), which reproduces Mplus’s numbers; 6.7’s ii variance 1.186 against 1.189 (SE 0.535). |
| 6.2, 6.3, 6.16 | yes | The integration card (censored, censored-inflated and two-part growth; 6.16’s DATA TWOPART as computed columns). |
| 6.22 | yes | The integration card (piecewise-constant baseline hazard, a factor of binary items); the MLR standard error of the factor’s residual variance 0.607 against 0.597. |
| 6.26 (and b), 6.27, 6.28 | yes | The Bayesian multilevel / DSEM card (Mplus syntax, Stan in desktop R through rstan, Mplus’s default priors): posterior medians and SDs within Monte Carlo error of Mplus’s (dsemkit.ts: Mplus’s effective draws taken as its iterations / 50). |

## Chapters 7, 8 and 10: mixtures

| Example | In the app | Reason if not |
| --- | --- | --- |
| 7.1–7.15, 7.17, 7.20–7.22, 7.24–7.26, 7.28, 7.30, 8.1, 8.2, 8.6–8.15 (8.13 parts 1–2) | yes | (7.1, 7.2, 7.11–7.15, 7.17, 7.20, 7.21, 7.24, 7.26, 8.6–8.8, 8.11–8.15: the mixture model card; 7.25, 7.30: the regression card) |
| 7.16 | yes | The mixture model card (RESCOVARIANCES: the residual covariance as an integrated factor). Stated difference: Mplus’s printed solution (−2598.111, the covariance at 0.000 with SE 3.1, u2’s and u3’s class-1 thresholds with SEs of 6.4) is not a maximum; the card reaches −2598.078; the class logit and the other thresholds agree within 0.025. |
| 8.3, 8.5 part 2 | yes | The mixture model card with numerical integration. 8.3: Mplus’s log-likelihood is 0.011 below the integral at the same estimates (finer rules confirm the card’s); 8.5 part 2: the class logits on x diverge (x separates the classes), their ratio agrees. |
| 8.4, 8.5 part 1 | no | The engine evaluates them (at Mplus’s estimates 8.4’s log-likelihood is −3463.891, Mplus −3463.892), but its optimizer does not reach Mplus’s maximum from the random starts within the time a card can take: two growth-factor dimensions of ordinal or zero-inflated outcomes, where adaptive BFGS rounds crawl. |
| 7.27 | yes | The IRT card’s 2PL mixture (mirt), and the mixture model card with Mplus’s input, which gives the MLR standard errors (within 0.004, class 2’s factor variance 0.996 against 1.013). |
| 7.18, 7.19, 7.29 | yes | The mixture model card with numerical integration (ALGORITHM = INTEGRATION; 7.29 with non-linear MODEL CONSTRAINT and NEW parameters). |
| 7.23, 8.16 | no | No data published. |
| 8.17 | no | Cox survival mixture: Mplus’s nonparametric baseline hazard (a step at each event time, profiled out) inside a mixture, with its sandwich over the baseline, is not built in the mixture engine. |
| 10.7 | yes | The LCA card’s multilevel option (glca); standard errors not reproduced. |
| 10.2 (and 10.2alt), 10.3, 10.4, 10.6, 10.11, 10.13 | yes | The mixture model card, TYPE = TWOLEVEL MIXTURE (ch10mix.ts). 10.2–10.6: Mplus’s log-likelihood is its own integration’s (0.002–0.014 from the integral, which the closed form confirms for 10.2), so its estimates differ slightly (see each description). |
| 10.1 | no | The engine reaches a higher maximum (−1752.439, Mplus −1752.471: c#1’s random-intercept variance goes to 0, where Mplus stops at 0.013) and takes over 10 minutes in the browser. |
| 10.5, 10.12 | no | Fitted by the engine (10.5 reproduces −9004.551 natively; 10.12’s log-likelihood at Mplus’s estimates is −10250.454, as printed), but the random starts take longer than a card may in the browser (13 and over 15 minutes). |
| 10.8 (and 10.8alt), 10.9, 10.10 | no | Three-level growth with numerical integration over two cluster-level dimensions: 10–30 minutes natively; 10.8 ends 0.033 above Mplus’s log-likelihood (its integration), 10.9’s random starts do not reach Mplus’s maximum. A faster optimizer is needed (BACKLOG.md). |

## Chapter 9: multilevel

| Example | In the app | Reason if not |
| --- | --- | --- |
| 9.1a, 9.1b, 9.2a, 9.2b, 9.5, 9.6, 9.11, 9.12, 9.14, 9.16, 9.20, 9.23 | yes | |
| 9.2c, 9.8, 9.10 | no | Random slopes inside a structural model (or with a latent covariate). |
| 9.3, 9.4, 9.7, 9.9, 9.13, 9.15, 9.17, 9.18 | no | Categorical, count or survival outcomes at two levels. |
| 9.19 (parts 1, 3), 9.24–9.35, 9.37–9.40 (and 9.30b, 9.32b, 9.38b, 9.39b, 9.40 part 2) | yes | The Bayesian multilevel / DSEM card (Stan in desktop R): random intercepts, slopes, loadings and log residual variances, cross-classified clusters, lagged observed variables and factors. Within Monte Carlo error of Mplus (dsemkit.ts); 9.24’s and 9.25’s means of cross-classified random intercepts, where Mplus’s short chains (2,000 and 800 iterations) are 0.6–0.8 SDs away, agree with the maximum-likelihood estimates (lme4). |
| 9.19 part 2 | no | Under Mplus’s flat priors the between-level factor’s posterior is improper: as its variance goes to 0 its free loadings are no longer determined (the density along that ridge is not integrable), so Stan’s chains reach variance 0 with loadings of either sign; Mplus’s 1,000 Gibbs iterations stay in the mode with positive loadings (variance 0.130, SD 0.087). Reproducing it needs a prior Mplus does not use. |
| 9.21 | no | Three levels with a binary outcome, a level-2 observed variable (y2) that has a level-3 random part, and covariances between random effects and observed between-level outcomes (y WITH y2, u WITH y3): not on the DSEM card yet. |
| 9.22 | no | Three-level MIMIC model by ML with random slopes of factors on both levels (numerical integration). |
| 9.33b | no | The ARMA(1,1) form of 9.33 (a lagged residual factor with the indicator's residual variance fixed at 0.01): the 20,000 latent residuals are tied to each other almost deterministically, and Stan's chains do not converge in 2 × 2,000 iterations (R-hat 1.08; y ON e&1 −0.151 against Mplus’s −0.100). 9.33, the same data as AR(1) with measurement error, is in the app. |
| 9.36 | no | Runs on the DSEM card (64 parameters, as Mplus), but two AR factors with 20,000 latent states each and random cross-lagged slopes take Stan more than two hours per chain on two cores: not validated. |

## Chapter 11: missing data

| Example | In the app | Reason if not |
| --- | --- | --- |
| 11.1, 11.2, 11.4, 11.5, 11.6 | yes | 11.2: the missing-data card (Mplus’s H1 log-likelihood with the dropout dummies is not a maximum: see the description). 11.5: joint H1 imputation, within Monte Carlo error. |
| 11.3 | yes | The integration card (SDROPOUT as computed columns), integrated exactly (adaptive Gauss–Hermite); Mplus’s Monte Carlo integration moves the dropout logits by up to 0.02 (an eighth of their SEs; see the description). |
| 11.7 | yes | The Bayesian SEM card (blavaan, desktop R): ordinal indicators, Mplus’s priors and plausible values (FSCORES(20)). |
| 11.8 (parts 1–3) | no | Two-level categorical imputation. |
