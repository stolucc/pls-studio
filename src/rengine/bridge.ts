// Calls into the R bridges (src/rengine/R/*.R). Every bridge function takes a
// JSON request and returns JSON results, or (export = TRUE) the self-contained
// R script that produces them.

import agreementR from './R/agreement.R?raw';
import analysesR from './R/analyses.R?raw';
import bootR from './R/boot.R?raw';
import commonR from './R/common.R?raw';
import cpaR from './R/cpa.R?raw';
import didR from './R/did.R?raw';
import efaR from './R/efa.R?raw';
import endoR from './R/endo.R?raw';
import lavaanR from './R/lavaan.R?raw';
import matchR from './R/match.R?raw';
import itemsR from './R/items.R?raw';
import longitudinalR from './R/longitudinal.R?raw';
import mcR from './R/mc.R?raw';
import mixedR from './R/mixed.R?raw';
import mixtureR from './R/mixture.R?raw';
import ncaR from './R/nca.R?raw';
import nonparametricR from './R/nonparametric.R?raw';
import plsR from './R/pls.R?raw';
import regressionR from './R/regression.R?raw';
import plsxR from './R/plsx.R?raw';
import rsaR from './R/rsa.R?raw';
import screenR from './R/screen.R?raw';
import exploreR from './R/explore.R?raw';
import effectsR from './R/effects.R?raw';
import networkR from './R/network.R?raw';
import segmentR from './R/segment.R?raw';
import testsR from './R/tests.R?raw';
import emmR from './R/emm.R?raw';
import robustR from './R/robust.R?raw';
import bayesR from './R/bayes.R?raw';
import customMlR from './R/customml.R?raw';
import twoLevelEfaR from './R/twolevelefa.R?raw';
import glmmR from './R/glmm.R?raw';
import quadmlR from './R/quadml.R?raw';
import dsemR from './R/dsem.R?raw';
import dfiR from './R/dfi.R?raw';
import validityR from './R/validity.R?raw';
import cbdiagR from './R/cbdiag.R?raw';
import qcaR from './R/qca.R?raw';
import invarianceR from './R/invariance.R?raw';
import powerR from './R/power.R?raw';
import pwrR from './R/pwr.R?raw';
import partialR from './R/partial.R?raw';
import survivalR from './R/survival.R?raw';
import metasemR from './R/metasem.R?raw';
import semtreeR from './R/semtree.R?raw';
import plssemR from './R/plssem.R?raw';
import searchR from './R/search.R?raw';
import sensitivityR from './R/sensitivity.R?raw';
import scoreTestR from './R/scoretest.R?raw';
import psemR from './R/psem.R?raw';
import hypothesesR from './R/hypotheses.R?raw';
import apimR from './R/apim.R?raw';
import metaR from './R/meta.R?raw';
import rocR from './R/roc.R?raw';
import { useCompute } from './compute';
import {
  helperBatch,
  helperCall,
  HelperMissingPackages,
  HelperUnavailable,
  probeHelper,
  useHelper,
} from './helper';
import { reportRWarnings } from './notices';
import { rList } from './rjson';
import { callJson, callString, parallelMap, withR, withSession } from './runtime';

export const SOURCES = {
  did: didR,
  regression: regressionR,
  common: commonR,
  lavaan: lavaanR,
  pls: plsR,
  boot: bootR,
  analyses: analysesR,
  mc: mcR,
  cpa: cpaR,
  longitudinal: longitudinalR,
  items: itemsR,
  mixed: mixedR,
  mixture: mixtureR,
  segment: segmentR,
  endo: endoR,
  match: matchR,
  rsa: rsaR,
  plsx: plsxR,
  nca: ncaR,
  efa: efaR,
  screen: screenR,
  explore: exploreR,
  effects: effectsR,
  network: networkR,
  tests: testsR,
  agreement: agreementR,
  nonparametric: nonparametricR,
  emm: emmR,
  robust: robustR,
  bayes: bayesR,
  customml: customMlR,
  twolevelefa: twoLevelEfaR,
  glmm: glmmR,
  quadml: quadmlR,
  dsem: dsemR,
  dfi: dfiR,
  validity: validityR,
  qca: qcaR,
  cbdiag: cbdiagR,
  scoretest: scoreTestR,
  sensitivity: sensitivityR,
  search: searchR,
  power: powerR,
  pwr: pwrR,
  partial: partialR,
  survival: survivalR,
  metasem: metasemR,
  semtree: semtreeR,
  plssem: plssemR,
  invariance: invarianceR,
  hypotheses: hypothesesR,
  apim: apimR,
  psem: psemR,
  meta: metaR,
  roc: rocR,
};

export const R_PACKAGES = {
  lavaan: ['jsonlite', 'lavaan', 'semTools'],
  // ESEM blocks with invariant loadings: rotated jointly by GPArotation (Mplus ex. 5.26).
  lavaanRotate: ['jsonlite', 'lavaan', 'semTools', 'GPArotation'],
  rsem: ['jsonlite', 'lavaan', 'semTools', 'rsem'],
  cSEM: ['jsonlite', 'cSEM'],
  seminr: ['jsonlite', 'seminr'],
  // Multiple imputation: mice (and lavaan.mi) only when it is chosen.
  mice: ['jsonlite', 'mice'],
  // (Amelia: the alternative imputation, as lavaan.mi's ?HS20imps)
  'lavaan.mi': ['jsonlite', 'lavaan', 'semTools', 'mice', 'Amelia', 'lavaan.mi'],
  cSEMMi: ['jsonlite', 'cSEM', 'mice'],
  seminrMi: ['jsonlite', 'seminr', 'mice'],
  MIIVsem: ['jsonlite', 'lavaan', 'MIIVsem'],
  simulation: ['jsonlite', 'lavaan', 'cSEM'],
  // (boot: the percentile intervals of combined effects, by manymome's rule, boot::boot.ci)
  manymome: ['jsonlite', 'manymome', 'sandwich', 'boot'],
  processGlm: ['jsonlite', 'boot'],
  manymomeSam: ['jsonlite', 'manymome', 'lavaan', 'boot'],
  modsem: ['jsonlite', 'lavaan', 'semTools', 'modsem'],
  ltm: ['jsonlite', 'ltm'],
  poLCA: ['jsonlite', 'poLCA'],
  // 3PL and 4PL IRT with priors on the asymptotes, mixture IRT.
  mirt: ['jsonlite', 'mirt'],
  // Multilevel latent class analysis.
  glca: ['jsonlite', 'glca'],
  // Generalized linear mixed models by adaptive Gauss-Hermite quadrature.
  GLMMadaptive: ['jsonlite', 'GLMMadaptive'],
  lme4: ['jsonlite', 'lme4', 'lmerTest'],
  lcmm: ['jsonlite', 'lcmm'],
  plspm: ['jsonlite', 'plspm'],
  ivreg: ['jsonlite', 'ivreg', 'lmtest'],
  sampleSelection: ['jsonlite', 'sampleSelection'],
  optimx: ['jsonlite', 'ivreg', 'lmtest', 'optimx', 'mvtnorm', 'corpcor'],
  MatchIt: ['jsonlite', 'MatchIt', 'optmatch', 'cobalt', 'sandwich', 'lmtest', 'marginaleffects'],
  WeightIt: ['jsonlite', 'WeightIt', 'cobalt', 'marginaleffects'],
  polynomial: ['jsonlite', 'lavaan'],
  nca: ['jsonlite'],
  // Fuzzy-set QCA: calibration, necessity, truth table and minimisation by the QCA package (Dușa).
  QCA: ['jsonlite', 'QCA'],
  // The custom likelihood card (nlminb; pbivnorm for two binary outcomes, as lavaan uses it).
  customml: ['jsonlite', 'pbivnorm'],
  // Two-level EFA: lavaan's unrotated two-level fit, rotated by GPArotation.
  efa2: ['jsonlite', 'lavaan', 'GPArotation'],
  cta: ['jsonlite'],
  genpathmox: ['jsonlite', 'cSEM', 'genpathmox'],
  flexmix: ['jsonlite', 'cSEM', 'flexmix'],
  psych: ['jsonlite', 'psych', 'GPArotation'],
  // Bayesian scale reliability (Bayesrel, Pfadt et al.): alpha, lambda-2, omega and the glb with credible intervals.
  Bayesrel: ['jsonlite', 'psych', 'GPArotation', 'Bayesrel'],
  // Agreement of several raters: Fleiss' kappa, Krippendorff's alpha, Kendall's W (irr, on lpSolve).
  irr: ['jsonlite', 'irr'],
  // Gwet's AC1 / AC2 with its standard error (irrCAC, on dplyr, tidyr, stringr and tibble).
  irrCAC: ['jsonlite', 'irrCAC'],
  // Exploratory factor analysis with lavaan's efa() (standard errors, the fit by number of factors).
  psychLavaan: ['jsonlite', 'psych', 'GPArotation', 'lavaan'],
  semfindr: ['jsonlite', 'lavaan', 'semTools', 'semfindr'],
  // Regularised SEM (lslx): the model on the canvas with penalised parameters, the penalty level chosen by BIC or AIC.
  lslx: ['jsonlite', 'lavaan', 'semTools', 'lslx'],
  // Little's MCAR test and Jamshidian & Jalal's tests in the missing-data card (misty::na.test; mvnmle's ML estimates).
  misty: ['jsonlite', 'lavaan', 'misty', 'mvnmle'],
  // Sensitivity to an unmeasured confounder: a phantom variable searched by ant colony optimisation (SEMsens) on the
  // CB-SEM model; rho-sensitivity of a simple mediation (mediation::medsens).
  SEMsens: ['jsonlite', 'lavaan', 'semTools', 'SEMsens'],
  mediation: ['jsonlite', 'mediation'],
  // Reading SPSS, Stata and Excel files.
  readData: ['jsonlite', 'haven', 'readxl'],
  bootnet: ['jsonlite', 'bootnet', 'qgraph'],
  // Difference-in-differences: fixest (two-way fixed effects, event studies) and did (Callaway & Sant'Anna).
  did: ['jsonlite', 'fixest', 'did', 'sandwich', 'lmtest'],
  fixest: ['jsonlite', 'fixest'],
  // Regression: base R plus MASS (negative binomial, ordinal), nnet (multinomial) and sandwich / lmtest for robust standard errors.
  regression: ['jsonlite', 'MASS', 'nnet', 'sandwich', 'lmtest'],
  // Censored (tobit) and survival (Cox, piecewise exponential) regressions: the regression card with survival.
  regressionSurvival: ['jsonlite', 'MASS', 'nnet', 'sandwich', 'lmtest', 'survival'],
  // Kaplan-Meier curves, median survival, risk tables and log-rank / Peto tests (survfit, survdiff).
  survival: ['jsonlite', 'survival'],
  // Zero-inflated and hurdle count models (pscl::zeroinfl, pscl::hurdle): the regression card with pscl.
  pscl: ['jsonlite', 'MASS', 'nnet', 'sandwich', 'lmtest', 'pscl'],
  MASS: ['jsonlite', 'MASS'],
  nnet: ['jsonlite', 'nnet', 'MASS'],
  datasets: ['jsonlite'],
  // Textbook datasets: Fox & Weisberg (carData), Faraway (faraway).
  carData: ['jsonlite', 'carData'],
  faraway: ['jsonlite', 'faraway'],
  stats: ['jsonlite'],
  // Normality tests of the descriptives card: Lilliefors (Kolmogorov-Smirnov) and Anderson-Darling (nortest).
  nortest: ['jsonlite', 'nortest'],
  // Effect sizes with confidence intervals for the basic test cards (Cohen's d, Hedges' g, eta², omega², Cramér's V, …);
  // boot for Kruskal-Wallis's rank epsilon-squared, whose bootstrap interval effectsize leaves out when boot (only
  // suggested by effectsize, and not part of webR's base library) is not installed.
  effectsize: ['jsonlite', 'effectsize', 'boot'],
  // Equivalence tests (TOST) of the t-test and correlation cards; effectsize beside it for the effect sizes.
  TOSTER: ['jsonlite', 'effectsize', 'boot', 'TOSTER'],
  // Repeated measures with several between-subjects factors: car::Anova's type II tests (car's ?Anova, OBrienKaiser).
  car: ['jsonlite', 'car'],
  // Estimated marginal means, post hoc tests, simple effects and contrasts (emmeans) of the ANOVA cards' fits;
  // with car for repeated measures with several between factors, with lme4 (pbkrtest: Kenward-Roger df) for LMMs.
  emmeans: ['jsonlite', 'emmeans'],
  carEmmeans: ['jsonlite', 'car', 'emmeans'],
  lme4Emmeans: ['jsonlite', 'lme4', 'lmerTest', 'pbkrtest', 'emmeans'],
  // Robust, bootstrap and permutation alternatives of the basic tests: trimmed means (WRS2), bootstrap intervals
  // (boot), permutation tests (coin); with emmeans for the ANOVA card's marginal means.
  WRS2: ['jsonlite', 'WRS2'],
  coin: ['jsonlite', 'coin'],
  resampling: ['jsonlite', 'emmeans', 'WRS2', 'boot', 'coin'],
  // The basic cards with effect sizes, equivalence tests or marginal means and the resampling together.
  basicTests: ['jsonlite', 'effectsize', 'TOSTER', 'emmeans', 'WRS2', 'boot', 'coin'],
  // Linear regression with bootstrap intervals of the coefficients.
  regressionBoot: ['jsonlite', 'MASS', 'nnet', 'sandwich', 'lmtest', 'boot'],
  EGAnet: ['jsonlite', 'EGAnet'],
  // Bayesian tests (JZS t-tests, correlations; JASP's priors).
  BayesFactor: ['jsonlite', 'BayesFactor'],
  // Bayesian SEM (Stan): desktop R only (DESKTOP_ONLY).
  blavaan: ['jsonlite', 'lavaan', 'blavaan'],
  // Approximate Bayesian SEM (INLAvaan, Jamil & Rue: Laplace approximation, skew-normal marginals; no Stan): also in the browser.
  INLAvaan: ['jsonlite', 'lavaan', 'INLAvaan'],
  // Bayesian multilevel and DSEM models: a Stan program compiled and sampled by rstan (desktop R only, DESKTOP_ONLY).
  rstan: ['jsonlite', 'rstan'],
  // Dynamic fit index cutoffs (dynamic, Wolf & McNeish), on a lavaan fit. In the browser a build patched to load
  // without GenOrd (whose import cubature webR cannot load): scripts/webr/fetch.mjs PATCHED.
  dynamic: ['jsonlite', 'lavaan', 'semTools', 'dynamic'],
  // Alignment optimisation for many groups (Asparouhov & Muthén 2014) on lavaan's configural fit.
  sirt: ['jsonlite', 'lavaan', 'sirt'],
  // Moderated nonlinear factor analysis of binary items (mnlfa).
  mnlfa: ['jsonlite', 'mnlfa'],
  // Analytic power analysis (semPower: a priori, post hoc, compromise; a parameter of the canvas model by lavaan).
  semPower: ['jsonlite', 'lavaan', 'semPower'],
  // Power for standard tests (pwr: t-tests, one-way ANOVA, proportions, correlation, chi-square, regression f2).
  pwr: ['jsonlite', 'pwr'],
  // Partial and semi-partial correlations (ppcor, which depends on MASS).
  ppcor: ['jsonlite', 'MASS', 'ppcor'],
  // Meta-analytic SEM (TSSEM on studies' correlation matrices): metaSEM on OpenMx, desktop R only (DESKTOP_ONLY).
  metaSEM: ['jsonlite', 'lavaan', 'OpenMx', 'metaSEM'],
  // SEM trees and forests of the canvas model (semtree on OpenMx, the model a lavaan fit): desktop R only (DESKTOP_ONLY).
  semtree: ['jsonlite', 'lavaan', 'OpenMx', 'semtree'],
  // Piecewise SEM (Shipley's d-separation tests, Fisher's C; lm / glm, lmer / glmer per equation): piecewiseSEM.
  piecewiseSEM: ['jsonlite', 'piecewiseSEM', 'lme4'],
  // Two-level PLS-SEM (MC-PLSc, random slopes): plssem 0.2.0, desktop R only (DESKTOP_ONLY; the browser's repository has 0.1.5).
  plssem: ['jsonlite', 'plssem'],
  // Score-based invariance tests along a covariate (Merkle & Zeileis): strucchange's fluctuation tests on the lavaan fit.
  strucchange: ['jsonlite', 'lavaan', 'semTools', 'strucchange', 'mvtnorm'], // (mvtnorm: WDMo's p-value; a Suggests of strucchange, so not loaded with it)
  // Datasets of psychotools (YouthGratitude: the strucchange example of Merkle, Fan & Zeileis 2014).
  psychotools: ['jsonlite', 'psychotools'],
  // Comparing two CB-SEM models: Vuong's tests and AIC / BIC difference intervals (nonnest2) beside lavaan's NET and LRT.
  nonnest2: ['jsonlite', 'lavaan', 'nonnest2'],
  // Informative hypotheses on labelled parameters: GORICA (restriktor::goric) and Bayes factors (bain), or both.
  restriktor: ['jsonlite', 'lavaan', 'restriktor'],
  bain: ['jsonlite', 'lavaan', 'bain'],
  informative: ['jsonlite', 'lavaan', 'restriktor', 'bain'],
  // Univariate meta-analysis: metafor's rma / rma.mv, escalc, regtest, ranktest, trimfill, influence, leave1out.
  metafor: ['jsonlite', 'metafor'],
  // Datasets of metadat (dat.bcg, …): the metafor examples' data (metafor depends on metadat).
  metadat: ['jsonlite', 'metadat'],
  // ROC analysis: pROC's curves, AUC intervals (DeLong, bootstrap), cut-points, partial AUC and DeLong's tests.
  pROC: ['jsonlite', 'pROC'],
  // R and package versions (replication packages).
  versions: ['jsonlite'],
} as const;
export type RPackage = keyof typeof R_PACKAGES;
/** Packages that R in the browser cannot run (Stan): only through the desktop helper, never webR. */
export const DESKTOP_ONLY: ReadonlySet<RPackage> = new Set<RPackage>([
  'blavaan',
  'rstan',
  'metaSEM',
  'semtree',
  'plssem',
]);
/** Why each of them cannot run in the browser. */
const DESKTOP_WHY: Partial<Record<RPackage, string>> = {
  blavaan: 'Stan does not run in the browser',
  rstan: 'Stan does not run in the browser',
  metaSEM: 'OpenMx does not run in the browser',
  semtree: 'OpenMx does not run in the browser',
  plssem: 'the browser’s R has plssem 0.1.5, whose multilevel interface differs from 0.2.0’s',
};
export class DesktopOnly extends Error {}
/** What to do when desktop R is not in use or lacks the packages. */
function helperAdvice(): string {
  if (useCompute.getState().backend !== 'helper')
    return 'Choose Desktop R (helper) under R runs in (Model tab), with the PLS Studio Helper running.';
  const h = useHelper.getState();
  return h.state === 'ready'
    ? 'Install the packages from the helper’s menu (Install R packages…) or with: pls-studio-helper setup.'
    : `Desktop R is not available (${h.message || h.state}).`;
}
const desktopOnly = (pkg: RPackage, why: string) =>
  new DesktopOnly(
    `This analysis runs in desktop R (${R_PACKAGES[pkg].filter((p) => p !== 'jsonlite').join(', ')}; ${DESKTOP_WHY[pkg] ?? 'it does not run in the browser'}). ${why}`,
  );

/** Every R package the bridge uses (what the helper's `setup` installs). */
const ALL_R_PACKAGES = [...new Set(Object.values(R_PACKAGES).flat())].sort();

let probed: { at: number; p: Promise<unknown> } | null = null;
/** Probe the helper (again after 30 s when it was not ready). */
export function checkHelper(force = false): Promise<unknown> {
  if (
    force ||
    !probed ||
    (useHelper.getState().state !== 'ready' && Date.now() - probed.at > 30_000)
  ) {
    probed = { at: Date.now(), p: probeHelper(SOURCES, ALL_R_PACKAGES) };
  }
  return probed.p;
}

/**
 * The parallelism in effect. Desktop R (helper ready): automatic, its R
 * processes (cores - 1); the browser: the Parallel setting (1 = off).
 */
export async function parallelism(): Promise<{ where: 'desktop' | 'browser'; sessions: number }> {
  if (useCompute.getState().backend === 'helper') {
    await checkHelper();
    const h = useHelper.getState();
    if (h.state === 'ready' && h.info)
      return { where: 'desktop', sessions: Math.max(1, h.info.workers) };
  }
  return { where: 'browser', sessions: useCompute.getState().workers };
}

/** A request as JSON (non-finite numbers as null, as the browser's R gets them). */
const toJson = (req: unknown) =>
  JSON.stringify(req, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));

/** Bridge functions whose cSEM / seminr resampling runs on several cores of one desktop R process (results identical). */
const MULTICORE = new Set(['ps_pls_boot', 'ps_cca', 'ps_pls_groups', 'ps_influence', 'ps_dsem']);

const told = new Set<string>();
/** Tell the user once per reason that a calculation ran in the browser's R instead of desktop R. */
function fallbackNotice(reason: string) {
  if (told.has(reason)) return;
  told.add(reason);
  void import('../store').then(({ useStore }) =>
    useStore.getState().toast('info', `${reason} Calculating in the browser's R instead.`),
  );
}

/**
 * With "Desktop R (helper)" chosen and the helper ready: the call's result
 * from the helper (JSON text or script). null: use the browser's R.
 */
async function viaHelper(
  fn: string,
  req: unknown,
  pkg: RPackage,
  exportScript: boolean,
): Promise<string | null> {
  if (useCompute.getState().backend !== 'helper') return null;
  await checkHelper();
  const h = useHelper.getState();
  if (h.state !== 'ready') {
    fallbackNotice(`Desktop R is not available (${h.message || h.state}).`);
    return null;
  }
  // cSEM / seminr resampling: all the helper's cores in this one R process (not when drawing chunks).
  const r = req as { boot?: { chunkR?: unknown } };
  const cores =
    MULTICORE.has(fn) && !r.boot?.chunkR ? Math.max(1, h.info?.workers ?? 1) : undefined;
  const json = toJson(cores ? { ...(req as object), cores } : req);
  try {
    return await helperCall(fn, json, [...R_PACKAGES[pkg]], exportScript);
  } catch (e) {
    if (e instanceof HelperMissingPackages) {
      fallbackNotice(
        `${e.message} Install them from the helper’s menu (Install R packages…) or with: pls-studio-helper setup.`,
      );
      return null;
    }
    if (e instanceof HelperUnavailable) {
      fallbackNotice(e.message);
      return null;
    }
    throw e;
  }
}

/** A helper result, marked as calculated in desktop R (engine.desktop: its R version). */
function fromDesktop<T>(json: string): T {
  const v = JSON.parse(json) as { engine?: unknown };
  if (v && typeof v === 'object' && v.engine && typeof v.engine === 'object')
    (v.engine as Record<string, unknown>).desktop = useHelper.getState().info?.r ?? 'R';
  return v as T;
}

/** Every R result passes here: its warnings go to Messages (notices.ts). */
function reported<T>(r: T, pkg: RPackage): T {
  reportRWarnings(r, pkg);
  return r;
}

export async function rCall<T>(fn: string, req: unknown, pkg: RPackage): Promise<T> {
  const h = await viaHelper(fn, req, pkg, false);
  if (h !== null) return reported(fromDesktop<T>(h), pkg);
  if (DESKTOP_ONLY.has(pkg)) throw desktopOnly(pkg, helperAdvice());
  return reported(
    (await withR([...R_PACKAGES[pkg]], SOURCES, (webR) =>
      callJson(webR, `ps_call("${fn}", req)`, req),
    )) as T,
    pkg,
  );
}

/** As rCall, in R session `session` (parallel work; 0 is the main session). The helper has its own pool. */
export async function rCallOn<T>(
  session: number,
  fn: string,
  req: unknown,
  pkg: RPackage,
): Promise<T> {
  const h = await viaHelper(fn, req, pkg, false);
  if (h !== null) return reported(fromDesktop<T>(h), pkg);
  if (DESKTOP_ONLY.has(pkg)) throw desktopOnly(pkg, helperAdvice());
  return reported(
    (await withSession(session, [...R_PACKAGES[pkg]], SOURCES, (webR) =>
      callJson(webR, `ps_call("${fn}", req)`, req),
    )) as T,
    pkg,
  );
}

/**
 * One call per request, results in request order. Desktop R: one streamed
 * batch over all the helper's processes. The browser (also when the helper
 * cannot be used): spread over the R sessions of the Parallel setting.
 */
export async function rCallParallel<T>(
  fn: string,
  reqs: unknown[],
  pkg: RPackage,
  onDone?: (done: number) => void,
): Promise<T[]> {
  const p = await parallelism();
  if (p.where === 'desktop') {
    try {
      const out = await helperBatch(fn, reqs.map(toJson), [...R_PACKAGES[pkg]], onDone);
      return out.map((r) => reported(fromDesktop<T>(r), pkg));
    } catch (e) {
      if (e instanceof HelperMissingPackages)
        fallbackNotice(
          `${e.message} Install them from the helper’s menu (Install R packages…) or with: pls-studio-helper setup.`,
        );
      else if (e instanceof HelperUnavailable) fallbackNotice(e.message);
      else throw e;
    }
  }
  // (the browser's own setting, not the helper's process count)
  return parallelMap(
    reqs,
    useCompute.getState().workers,
    (req, session) =>
      withSession(session, [...R_PACKAGES[pkg]], SOURCES, (webR) =>
        callJson(webR, `ps_call("${fn}", req)`, req),
      ).then((r) => reported(r as T, pkg)),
    onDone,
  );
}

export async function rScript(fn: string, req: unknown, pkg: RPackage): Promise<string> {
  const h = await viaHelper(fn, req, pkg, true);
  if (h !== null) return h;
  if (DESKTOP_ONLY.has(pkg)) throw desktopOnly(pkg, helperAdvice());
  return withR([...R_PACKAGES[pkg]], SOURCES, (webR) =>
    callString(webR, `ps_call("${fn}", req, export = TRUE)`, req),
  );
}

/** Where the next calculation with `pkg` runs and that package's version there. */
export function computeLocation(pkg: string): { where: 'desktop' | 'browser'; version: string } {
  const h = useHelper.getState();
  if (useCompute.getState().backend === 'helper' && h.state === 'ready' && h.packages[pkg])
    return { where: 'desktop', version: h.packages[pkg]! };
  return { where: 'browser', version: '' };
}

/** An R error message without R's call prefix. */
export const rMessage = (e: unknown) =>
  (e instanceof Error ? e.message : String(e))
    .replace(/^Error in [^:]*: /, '')
    .replace(/^Error: /, '');

/**
 * R's JSON (auto_unbox) writes a one-element vector as a scalar: one warning
 * arrives as a string, not a list. Always a list of strings.
 */
export const rStrings = (v: unknown): string[] =>
  rList<unknown>(v).filter((x): x is string => typeof x === 'string');
