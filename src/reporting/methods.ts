// A draft of the methods section from what was configured and run: the method,
// the software and package versions the results carry, the estimator, missing
// data, bootstrap, standardisation, the model's structure, and the criteria
// (with thresholds and their sources) the results panel reports. It describes;
// it reports no estimates (those belong in the results section), and every
// number in it comes from the settings, the model or the results themselves.

import type { BootstrapResult, PlsResult } from '../engine/types';
import type { CbResult } from '../engine/cbsem';
import type { MiivResult } from '../engine/miiv';
import type { CpaResult } from '../rengine/cpa';
import type { InvarianceResult } from '../rengine/lavaan';
import type { DataInfo, ModelState, Settings } from '../model/project';
import { processGraph } from '../process/fromModel';
import { latexText } from '../latex';
import { bibtex, citeText } from './citations';
import { deletedItemsMethods } from '../measurement/report';

/** Which software computed a result (the R bridge adds it; absent: the built-in engine). */
export interface EngineTag {
  package: string;
  version: string;
  desktop?: string;
}
type WithEngine<T> = T & { engine?: EngineTag };

/** A card of the analysis log, as far as the texts need it. */
export interface LogEntry {
  type: string;
  run: boolean;
}

/** Everything the methods text and the reviewer checklist read. */
export interface ReportInput {
  model: ModelState;
  settings: Settings;
  info: DataInfo | null;
  pls?: WithEngine<PlsResult> | null;
  cb?: WithEngine<CbResult> | null;
  miiv?: WithEngine<MiivResult> | null;
  boot?: (BootstrapResult & { seed?: number }) | null;
  process?: CpaResult | null;
  invariance?: InvarianceResult | null;
  /** The other cards of the analysis log (which assessments were run). */
  log?: LogEntry[];
  /** R and webR versions of the browser's R session (for results computed there). */
  runtime?: { R?: string; webR?: string };
}

export interface MethodsText {
  /** Plain text, author–year citations. */
  text: string;
  /** The same as LaTeX (natbib \citep / \citet). */
  latex: string;
  /** The cited works. */
  bibtex: string;
  keys: string[];
}

// Citation markers inside the draft: ⟦key,key⟧ parenthetical, ⟦t:key⟧ narrative, ⟦a:key⟧ bare (already inside
// parentheses: natbib's \citealp), ⟦pre|key⟧ with a prefix inside the parentheses.
const OPEN = '⟦';
const CLOSE = '⟧';
const cite = (...keys: string[]) => `${OPEN}${keys.join(',')}${CLOSE}`;
const citePre = (pre: string, ...keys: string[]) => `${OPEN}${pre}|${keys.join(',')}${CLOSE}`;
const citet = (key: string) => `${OPEN}t:${key}${CLOSE}`;
const citealp = (...keys: string[]) => `${OPEN}a:${keys.join(',')}${CLOSE}`;
const MARKER = new RegExp(`${OPEN}([^${CLOSE}]*)${CLOSE}`, 'g');

/** "a", "a and b", "a, b, and c". */
function list(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')}, and ${xs[xs.length - 1]}`;
}
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (c: number) => `${Math.round(c * 1000) / 10}%`;

/** The packages behind an engine tag ("lavaan::sam + manymome" with "0.6-19 / 0.2.4"; "stats (lm, glm)" is base R). */
export function enginePackages(e: EngineTag): { name: string; version: string }[] {
  const names = e.package.split(/\s*\+\s*/).map((p) =>
    p
      .replace(/::.*$/, '')
      .replace(/\s*\(.*\)$/, '')
      .trim(),
  );
  const versions = e.version.split(/\s*\/\s*/);
  return names.map((name, i) => ({
    name: name === 'stats' || name === 'R' ? 'R' : name,
    version: versions[i] ?? versions[0],
  }));
}
const PACKAGE_KEY: Record<string, string> = {
  cSEM: 'csem',
  seminr: 'seminr',
  lavaan: 'rosseel2012',
  manymome: 'cheung2024',
  modsem: 'slupphaug2025',
  MIIVsem: 'fisher2021',
};
/** The R version the results were computed in: the desktop helper's, or the browser session's. */
function rVersion(e: EngineTag | undefined, input: ReportInput): string | null {
  if (e?.desktop) return /R version ([0-9.]+)/.exec(e.desktop)?.[1] ?? null;
  return input.runtime?.R ?? null;
}

class Draft {
  readonly parts: string[] = [];
  readonly versions: Record<string, string> = {};
  add(s: string | null | false | undefined) {
    if (s) this.parts.push(s);
  }
}

/** "the R package cSEM (version 0.7.1; Rademaker & Schuberth, 2020) in R (version 4.5.1; R Core Team, 2025)". */
function software(e: EngineTag | undefined, input: ReportInput, d: Draft, builtin: string): string {
  if (!e) return `${builtin} of PLS Studio`;
  const pkgs = enginePackages(e).filter((p) => p.name !== 'R');
  const named = pkgs.map((p) => {
    const key = PACKAGE_KEY[p.name];
    if (key) d.versions[key] = p.version;
    return key
      ? `${p.name} ${citePre(`version ${p.version};`, key)}`
      : `${p.name} (version ${p.version})`;
  });
  const rPackageVersion = enginePackages(e).find((p) => p.name === 'R')?.version || null;
  const rv = rVersion(e, input) ?? rPackageVersion;
  if (rv) d.versions.rcore = rv;
  const r = rv ? `R ${citePre(`version ${rv};`, 'rcore')}` : `R ${cite('rcore')}`;
  // Results computed in the browser name webR as well.
  const webR = e.desktop ? undefined : input.runtime?.webR;
  let where = '';
  if (webR) {
    where = `, run in the web browser through webR ${citePre(`version ${webR};`, 'webr')}`;
    d.versions.webr = webR;
  }
  const packages = named.length
    ? `the R ${named.length === 1 ? 'package' : 'packages'} ${list(named)} in `
    : '';
  return `${packages}${r}${where}, through PLS Studio`;
}

const nameOf = (m: ModelState) => {
  const by = new Map(m.constructs.map((k) => [k.id, k.name]));
  return (id: string) => by.get(id) ?? id;
};

/** Constructs with indicators: "A (reflective, 3 indicators)". */
function measurement(m: ModelState, method: Settings['method']): string {
  const first = m.constructs.filter((k) => !k.components?.length);
  const desc = first.map((k) => {
    const n = k.indicators.length;
    if (method === 'process') {
      let scale = 'observed';
      if (n > 1) scale = k.latent ? `latent, ${n} indicators` : `mean of ${n} items`;
      return `${k.name} (${scale})`;
    }
    if (k.covariate) return `${k.name} (observed covariate)`;
    if (n === 1) return `${k.name} (single indicator)`;
    let kind = 'composite';
    if (k.type === 'factor') kind = 'reflective';
    else if (method === 'pls')
      kind = `composite, Mode ${k.mode === 'unit' ? 'unit weights' : k.mode}`;
    return `${k.name} (${kind}, ${n} indicators)`;
  });
  const items = new Set(first.flatMap((k) => k.indicators)).size;
  return `${count(first.length, 'construct')} measured by ${count(items, 'indicator')}: ${list(desc)}`;
}

function structural(m: ModelState): string | null {
  const name = nameOf(m);
  if (!m.paths.length) return null;
  const arrows = m.paths.map((p) => `${name(p.from)} → ${name(p.to)}`).join('; ');
  return `${count(m.paths.length, 'structural path')} (${arrows})`;
}

/** "The model comprises <measurement>, and <structural paths>." */
function comprises(m: ModelState, method: Settings['method']): string {
  const paths = structural(m);
  return `The model comprises ${measurement(m, method)}${paths ? `, and ${paths}` : ''}.`;
}

function higherOrder(m: ModelState): string[] {
  const name = nameOf(m);
  return m.constructs
    .filter((k) => k.components?.length)
    .map((k) => `${k.name} (formed by ${list(k.components!.map(name))})`);
}

function moderationText(m: ModelState): string[] {
  const name = nameOf(m);
  const path = new Map(m.paths.map((p) => [p.id, p]));
  return m.moderations.flatMap((mo) => {
    const p = path.get(mo.path);
    if (!p) return [];
    // A construct moderating its own path is a quadratic effect.
    if (mo.moderator === p.from) return [`${name(p.from)}² → ${name(p.to)}`];
    return [`${name(mo.moderator)} moderating ${name(p.from)} → ${name(p.to)}`];
  });
}

function missingText(
  input: ReportInput,
  n: number | null,
  dropped: number,
  imputations: number | undefined,
): string | null {
  const { settings: s, info } = input;
  if (info?.kind === 'matrix')
    return 'The model was fitted to a covariance matrix (summary statistics), so no case-level missing-data treatment applied.';
  if (info && info.missingCells === 0) return 'The data had no missing values.';
  const cells = info ? ` (${count(info.missingCells, 'missing cell')})` : '';
  switch (s.missing) {
    case 'mean':
      return `Missing values${cells} were replaced by the indicator’s mean.`;
    case 'casewise': {
      const removing = dropped ? `, removing ${count(dropped, 'case')}` : '';
      const leaving = n !== null ? `, leaving N = ${n}` : '';
      return `Cases with missing values${cells} were deleted listwise${removing}${leaving}.`;
    }
    case 'pairwise':
      return `Missing values${cells} were handled by pairwise deletion.`;
    case 'fiml': {
      const fiml = abbr('FIML', ['arbuckle1996', 'enders2001']);
      const robust =
        s.method === 'cbsem' && s.estimator === 'MLR'
          ? `, with robust standard errors and test statistic for incomplete non-normal data ${cite('yuan2000')}`
          : '';
      return `Missing values${cells} were handled by full-information maximum likelihood ${fiml}${robust}.`;
    }
    case 'twostage':
    case 'robusttwostage':
      return `Missing values${cells} were handled by the ${s.missing === 'robusttwostage' ? 'robust ' : ''}two-stage approach ${cite('savalei2009')}.`;
    case 'mi': {
      const m = imputations ?? s.miImputations;
      const how = imputationMethod(s.miMethod);
      return `Missing values${cells} were multiply imputed (${count(m, 'imputed data set')}) by ${how}; the estimates were pooled by Rubin’s rules ${cite('rubin1987')}.`;
    }
  }
}

function imputationMethod(miMethod: Settings['miMethod']): string {
  if (miMethod === 'amelia') return `Amelia II ${cite('honaker2011')}`;
  if (miMethod === 'joint')
    return 'joint-model data augmentation under the unrestricted multivariate normal model';
  const model =
    miMethod === 'micenorm' ? ' (Bayesian normal regression)' : ' (predictive mean matching)';
  return `chained equations with mice ${cite('vanbuuren2011')}${model}`;
}

function bootText(b: (BootstrapResult & { seed?: number }) | null | undefined): string | null {
  if (!b) return null;
  let interval = 'percentile';
  if (b.interval === 'bca') interval = 'bias-corrected and accelerated (BCa)';
  else if (b.interval === 'studentized') interval = 'studentized';
  const failed = b.failed
    ? `, of which ${b.failed} failed and ${b.failed === 1 ? 'was' : 'were'} skipped,`
    : '';
  const seed = b.seed !== undefined ? `, random seed ${b.seed}` : '';
  const resamples = b.samples.toLocaleString('en-US');
  const tails = b.tails === 1 ? 'one' : 'two';
  return (
    `Standard errors and ${pct(b.confidence)} ${interval} confidence intervals came from ` +
    `${resamples} bootstrap resamples ${cite('efron1993')}${failed || ','} with ${tails}-tailed tests${seed}.`
  );
}

/** Has a card of one of these types run (in the analysis log)? */
export const ran = (input: ReportInput, ...types: string[]) =>
  (input.log ?? []).some((c) => c.run && types.includes(c.type));

// ---------------------------------------------------------------- PLS-SEM

function plsMethodName(approach: string, consistent: boolean | undefined): string {
  if (approach === 'GSCA') return 'generalized structured component analysis (GSCA)';
  if (approach === 'PCA') return 'principal component scores';
  if (approach === 'unit') return 'unit-weighted sum scores';
  if (consistent)
    return `consistent partial least squares structural equation modelling ${abbr('PLSc-SEM', ['dijkstra2015'])}`;
  return 'partial least squares structural equation modelling (PLS-SEM)';
}

function plsDraft(input: ReportInput, pls: WithEngine<PlsResult>, d: Draft) {
  const { model: m, settings: s } = input;
  const approach = pls.approach ?? 'PLS-PM';
  const method = plsMethodName(approach, pls.consistent);
  const by = software(pls.engine, input, d, 'the built-in PLS-SEM engine');
  d.add(`The model was estimated by ${method} with ${by}, on N = ${pls.n} cases.`);
  if (approach === 'PLS-PM') {
    const scheme = s.scheme === 'factor' ? 'factorial' : s.scheme;
    const iterations = count(pls.iterations, 'iteration');
    const outcome = pls.converged
      ? `converged after ${iterations}`
      : `did not converge within ${iterations}`;
    d.add(
      `The PLS algorithm used the ${scheme} weighting scheme and stopped when the outer weights changed by ` +
        `less than 10^−${s.stopExp} (at most ${s.maxIter} iterations); it ${outcome}.`,
    );
  }
  d.add(
    'The indicators were standardised (mean 0, variance 1) before estimation, so loadings, weights and path coefficients are standardised.',
  );
  d.add(comprises(m, 'pls'));
  const hoc = higherOrder(m);
  if (hoc.length) {
    const how = {
      two_stage: 'disjoint two-stage approach',
      embedded: 'embedded two-stage approach',
      repeated: 'repeated indicators approach',
    }[pls.hocApproach ?? s.hocApproach];
    const one = hoc.length === 1;
    d.add(
      `The higher-order ${one ? 'construct' : 'constructs'} ${list(hoc)} ${one ? 'was' : 'were'} ` +
        `estimated with the ${how} ${cite('becker2012', 'sarstedt2019')}.`,
    );
  }
  if (pls.moderations.length) {
    const methods = [...new Set(pls.moderations.map((x) => x.method ?? 'two_stage'))].map(
      (x) =>
        ({
          two_stage: 'two-stage approach (products of the construct scores)',
          orthogonal: 'orthogonalising approach',
          product_indicator: 'product indicator approach',
        })[x],
    );
    d.add(
      `Interaction terms (${list(moderationText(m))}) were generated with the ${list(methods)} ${cite('becker2018')}.`,
    );
  }
  d.add(missingText(input, pls.n, pls.droppedRows, pls.imputations));
  d.add(bootText(input.boot));
  // Assessment criteria, as the results panel reports them.
  const types = pls.types.slice(0, m.constructs.length);
  const modeA = m.constructs.filter(
    (k, i) =>
      !k.components?.length && k.indicators.length > 1 && (types[i] === 'factor' || k.mode === 'A'),
  );
  const modeB = m.constructs.filter(
    (k) => !k.components?.length && k.indicators.length > 1 && k.mode === 'B',
  );
  const reflectiveCriteria = modeA.length
    ? 'the reflectively measured (Mode A) constructs were assessed by indicator loadings (at least 0.708), ' +
      `internal consistency reliability (Cronbach’s α, ρA and ρC between 0.70 and 0.95; ρA: ${citealp('dijkstra2015')}), ` +
      `convergent validity (average variance extracted, AVE, at least 0.50; ${citealp('fornell1981')}) ` +
      'and discriminant validity (heterotrait–monotrait ratio, HTMT, below 0.85, or 0.90 for conceptually ' +
      `similar constructs; ${citealp('henseler2015')})`
    : 'the measurement models were assessed';
  let formativeCriteria = '';
  if (modeB.length)
    formativeCriteria =
      `${modeA.length ? '; the' : ', and the'} formatively measured (Mode B) constructs by indicator ` +
      'collinearity (VIF below 3; 5 or above is critical) and the significance and relevance of their outer weights';
  d.add(
    `Following the reporting guidelines of ${citet('hair2019')} and ${citet('becker2023')}, ` +
      reflectiveCriteria +
      formativeCriteria +
      '.',
  );
  if (modeA.length) d.add(deletedItemsMethods(m, cite));
  if (m.paths.length) {
    const significance = input.boot
      ? ' and the significance of the path coefficients by their bootstrap confidence intervals'
      : '';
    d.add(
      'The structural model was assessed by collinearity among predictors (inner VIF below 3), ' +
        `the coefficient of determination R² (0.25, 0.50 and 0.75 as weak, moderate and substantial; ${citealp('hair2019')}), ` +
        `the effect size f² (0.02, 0.15 and 0.35 as small, medium and large; ${citealp('cohen1988')})${significance}.`,
    );
  }
  d.add(
    `As a measure of approximate model fit, the SRMR of the estimated model is reported against the threshold of 0.08 ${cite('henseler2014')}, with the caveat that fit measures are of limited use in PLS-SEM ${cite('hair2019')}.`,
  );
  if (ran(input, 'plspredict'))
    d.add(
      `Out-of-sample predictive power was assessed with PLSpredict (Q²predict above 0, and the RMSE or MAE of PLS-SEM against a linear benchmark) ${cite('shmueli2019')}.`,
    );
  if (ran(input, 'mga'))
    d.add(
      `Before comparing groups, measurement invariance of the composites was tested with the MICOM procedure ${cite('henseler2016')}.`,
    );
}

// ---------------------------------------------------------------- CB-SEM

/** Each estimator's description, abbreviation and sources. */
const ESTIMATOR: Record<string, [string, string, string[]]> = {
  ML: ['maximum likelihood', 'ML', []],
  MLR: [
    'maximum likelihood with robust (Huber–White) standard errors and a scaled test statistic',
    'MLR',
    ['yuan2000'],
  ],
  MLM: [
    'maximum likelihood with robust standard errors and the Satorra–Bentler scaled test statistic',
    'MLM',
    ['satorra1994'],
  ],
  MLMV: [
    'maximum likelihood with robust standard errors and a mean- and variance-adjusted test statistic',
    'MLMV',
    ['satorra1994'],
  ],
  GLS: ['generalised least squares', 'GLS', []],
  ULS: ['unweighted least squares', 'ULS', []],
  WLS: ['weighted least squares (asymptotically distribution-free)', 'WLS', []],
  WLSMV: [
    'diagonally weighted least squares with robust standard errors and a mean- and variance-adjusted test statistic',
    'WLSMV',
    ['muthen1997'],
  ],
  RML: ['robust maximum likelihood with case weights', 'RML', []],
};
/** "(MLR; Yuan & Bentler, 2000)", or "(ML)" without sources. */
const abbr = (short: string, keys: string[]) =>
  keys.length ? citePre(`${short};`, ...keys) : `(${short})`;

function cbDraft(input: ReportInput, cb: WithEngine<CbResult>, d: Draft) {
  const m = input.model;
  const cfa = !m.paths.length;
  const [est, short, estKeys] = ESTIMATOR[cb.estimator] ?? [cb.estimator, cb.estimator, []];
  const kind = cfa
    ? 'confirmatory factor analysis (CFA)'
    : 'covariance-based structural equation model (CB-SEM)';
  const by = software(cb.engine, input, d, 'the built-in CB-SEM engine');
  d.add(
    `The model was estimated as a ${kind} by ${est} ${abbr(short, estKeys)} with ${by}, on N = ${cb.n} cases.`,
  );
  if (cb.engine?.package === 'modsem' || cb.interaction) {
    const interactionMethod =
      cb.interaction === 'qml'
        ? `quasi-maximum likelihood ${abbr('QML', ['klein2007'])}`
        : `the latent moderated structural equations method ${abbr('LMS', ['klein2000'])}`;
    d.add(`The latent interactions were estimated by ${interactionMethod}.`);
  } else if (m.moderations.length)
    d.add(
      `Latent interactions (${list(moderationText(m))}) were estimated with product indicators ${cite('marsh2004')}.`,
    );
  d.add(comprises(m, 'cbsem'));
  const hoc = higherOrder(m);
  if (hoc.length) d.add(`Second-order ${hoc.length === 1 ? 'factor' : 'factors'}: ${list(hoc)}.`);
  const variance = m.constructs.filter((k) => k.scaling === 'variance').map((k) => k.name);
  const multiItem = m.constructs.filter((k) => k.indicators.length > 1).length;
  let scaling: string;
  if (variance.length && variance.length === multiItem)
    scaling = 'Each factor was scaled by fixing its variance to 1';
  else {
    const exceptions = variance.length ? ` (${list(variance)}: by fixing the variance to 1)` : '';
    scaling = `Each factor was scaled by fixing the loading of its first indicator to 1${exceptions}`;
  }
  d.add(
    `${scaling}; standardised estimates (latent and observed variables standardised) are reported alongside the unstandardised ones.`,
  );
  if (m.ordered?.length)
    d.add(
      `${list(m.ordered)} ${m.ordered.length === 1 ? 'was' : 'were'} treated as ordered categorical, with polychoric correlations and thresholds.`,
    );
  if (m.multigroup)
    d.add(
      `The model was estimated in several groups (by ${m.multigroup.column || 'dataset'}) at the ${m.multigroup.invariance} level of measurement invariance.`,
    );
  if (m.cluster) d.add(`Standard errors account for the clustering of cases in ${m.cluster}.`);
  if (m.weights) d.add(`Sampling weights from ${m.weights} were applied.`);
  d.add(missingText(input, cb.n, cb.droppedRows, cb.imputations));
  d.add(bootText(input.boot));
  const robust = cb.fit.cfiRobust !== undefined || cb.fit.rmseaRobust !== undefined;
  if (Number.isFinite(cb.fit.chisq)) {
    const scaled = cb.fit.chisqScaled !== undefined ? ' (scaled)' : '';
    const robustIndices = robust
      ? `, using the robust CFI, TLI and RMSEA ${cite('brosseau2012', 'brosseau2014')}`
      : '';
    d.add(
      `Global fit was evaluated with the χ² test${scaled}, the comparative fit index (CFI), the Tucker–Lewis index (TLI), ` +
        'the root mean square error of approximation (RMSEA) with its 90% confidence interval and ' +
        `the standardised root mean square residual (SRMR)${robustIndices}; following ${citet('hu1999')}, ` +
        'CFI and TLI of at least 0.95, RMSEA of at most 0.06 and SRMR of at most 0.08 indicate good fit, ' +
        `cut-offs that are guidelines rather than tests ${cite('jackson2009')}.`,
    );
  }
  if (m.constructs.some((k) => k.type === 'factor' && k.indicators.length > 1))
    d.add(
      `Convergent validity was assessed by standardised loadings (at least 0.50, ideally 0.70), composite reliability (at least 0.70) and the average variance extracted (at least 0.50; ${citealp('fornell1981')}), and discriminant validity by the heterotrait–monotrait ratio (below 0.85; ${citealp('henseler2015')}).`,
    );
  if (input.invariance) {
    const strict = input.invariance.levels.some((l) => l.level === 'strict') ? ' and strict' : '';
    d.add(
      `Measurement invariance across groups was tested by comparing configural, metric, scalar${strict} models ` +
        'with χ² difference tests and changes in CFI and RMSEA.',
    );
  }
}

function miivDraft(input: ReportInput, miiv: WithEngine<MiivResult>, d: Draft) {
  d.add(
    `The model was estimated equation by equation by model-implied instrumental variable two-stage least squares ${abbr('MIIV-2SLS', ['bollen1996'])} with ${software(miiv.engine, input, d, 'the built-in MIIV-2SLS engine')}, on N = ${miiv.n} cases.`,
  );
  d.add(comprises(input.model, 'cbsem'));
  d.add(
    'Each equation’s instruments were tested with the Sargan overidentification test; MIIV-2SLS gives no global fit statistics.',
  );
  d.add(missingText(input, null, 0, undefined));
}

// ---------------------------------------------------------------- conditional process analysis

function processDraft(input: ReportInput, r: CpaResult, d: Draft) {
  const { model: m, settings: s } = input;
  const g = processGraph(m);
  const label = g.recognised
    ? `model ${g.recognised.model} of PROCESS`
    : 'a custom conditional process model';
  const latent = r.latent.length > 0;
  const eng: EngineTag = r.engine as EngineTag;
  const by = software(eng, input, d, 'PLS Studio');
  const latentScales = latent
    ? `, the scales ${list(r.latent)} modelled as latent variables by the structural-after-measurement approach ${cite('rosseel2024')}`
    : '';
  d.add(
    `The conditional process analysis (${label}; ${citealp('hayes2022')}) was estimated with ${by}${latentScales}, on N = ${r.n} cases.`,
  );
  if (g.graph) {
    const name = nameOf(m);
    const mods = [
      ...new Set([
        ...g.graph.moderations.map((x) => x.by),
        ...g.graph.threeWay.flatMap((x) => x.by),
      ]),
    ].map(name);
    const { mediators } = g.graph;
    const mediatorText = mediators.length
      ? `, with ${mediators.length === 1 ? 'the mediator' : 'the mediators'} ${list(mediators.map(name))}`
      : '';
    const moderatorText = mods.length
      ? `, ${mods.length === 1 ? 'the moderator' : 'the moderators'} ${list(mods)}`
      : '';
    const covariateText = g.covariates.length
      ? `, and the ${g.covariates.length === 1 ? 'covariate' : 'covariates'} ${list(g.covariates)} in every equation`
      : '';
    d.add(
      `X was ${name(g.graph.x)} and Y ${name(g.graph.y)}${mediatorText}${moderatorText}${covariateText}.`,
    );
  }
  d.add(
    `The variables were ${measurement(m, 'process').replace(/^\d+ constructs? measured by \d+ indicators?: /, '')}.`,
  );
  const equations = r.binaryY
    ? `The equation of the dichotomous Y was a logistic regression and the others`
    : 'The equations were';
  const estimation = latent
    ? 'estimated within the latent-variable model'
    : 'ordinary least squares regressions';
  const hcErrors =
    !latent && r.hc !== 'none'
      ? ` and ${r.hc} heteroskedasticity-consistent standard errors ${cite('hayes2007', 'long2000')}`
      : '';
  d.add(
    `${equations} ${estimation}, with variables in their original metric (unstandardised coefficients)${hcErrors}.`,
  );
  if (r.indirect.length || r.indices.length) {
    const samples = r.boot.samples.toLocaleString('en-US');
    const level = pct(s.confidence);
    d.add(
      r.inference === 'montecarlo'
        ? `Indirect effects were tested with ${level} Monte Carlo confidence intervals from ${samples} draws ${cite('preacher2012')}, random seed ${s.seed}.`
        : `Indirect effects were tested with ${level} percentile bootstrap confidence intervals from ${samples} resamples ${cite('efron1993')}, random seed ${s.seed}.`,
    );
  }
  if (r.moderators.length) {
    const probedAt =
      s.probe === 'meansd'
        ? 'the mean and one standard deviation below and above the mean'
        : 'the 16th, 50th and 84th percentiles';
    const jn = r.jn.length
      ? ', and regions of significance were found with the Johnson–Neyman technique'
      : '';
    d.add(
      `Conditional effects were probed at ${probedAt} of each moderator${jn} ${cite('hayes2022')}.`,
    );
  }
  d.add(missingText(input, r.n, 0, undefined));
}

// ---------------------------------------------------------------- rendering

/** A parsed citation marker as a natbib command. */
function latexCite(c: { narrative: boolean; bare: boolean; pre: string; keys: string[] }): string {
  const keys = c.keys.join(',');
  if (c.narrative) return `\\citet{${keys}}`;
  if (c.bare) return `\\citealp{${keys}}`;
  if (c.pre) return `\\citep[${latexText(c.pre)}][]{${keys}}`;
  return `\\citep{${keys}}`;
}

/** Plain text and LaTeX of a draft with citation markers. */
export function render(
  draft: string,
  versions: Record<string, string> = {},
): { text: string; latex: string; keys: string[] } {
  const keys: string[] = [];
  const parse = (body: string) => {
    const narrative = body.startsWith('t:');
    const bare = body.startsWith('a:');
    let pre = '';
    let ks = body;
    if (narrative || bare) ks = body.slice(2);
    else if (body.includes('|')) [pre, ks] = body.split('|') as [string, string];
    const list = ks.split(',').filter(Boolean);
    for (const k of list) if (!keys.includes(k)) keys.push(k);
    return { narrative, bare, pre: pre.trim(), keys: list };
  };
  const text = draft.replace(MARKER, (_, body: string) => {
    const c = parse(body);
    const cites = c.keys.map((k) => citeText(k, versions[k]));
    if (c.narrative) {
      const [who, year] = cites[0].split(/, (?=[^,]+$)/);
      return `${who.replace(' & ', ' and ')} (${year})`;
    }
    if (c.bare) return cites.join('; ');
    return `(${c.pre ? `${c.pre} ` : ''}${cites.join('; ')})`;
  });
  let latex = '';
  let last = 0;
  for (const mm of draft.matchAll(MARKER)) {
    latex += latexText(draft.slice(last, mm.index));
    latex += latexCite(parse(mm[1]));
    last = mm.index! + mm[0].length;
  }
  latex += latexText(draft.slice(last));
  return { text, latex: latex.replace(/10\\textasciicircum\{\}\$-\$(\d+)/g, '$$10^{-$1}$$'), keys };
}

/** Why there is nothing to describe yet; null when the results for the method are there. */
export function methodsBlocked(input: ReportInput): string | null {
  const s = input.settings;
  const twoSls = s.method === 'cbsem' && s.estimator === '2SLS';
  let have: unknown;
  if (s.method === 'pls') have = input.pls;
  else if (s.method === 'process') have = input.process;
  else if (twoSls) have = input.miiv;
  else have = input.cb;
  return have
    ? null
    : 'Calculate the model first (Model tab): the text describes the results it was estimated with.';
}

/** The methods paragraph for the model, settings and results given. */
export function methodsText(input: ReportInput): MethodsText {
  const d = new Draft();
  const s = input.settings;
  if (s.method === 'pls' && input.pls) plsDraft(input, input.pls, d);
  else if (s.method === 'process' && input.process) processDraft(input, input.process, d);
  else if (s.method === 'cbsem' && s.estimator === '2SLS' && input.miiv)
    miivDraft(input, input.miiv, d);
  else if (s.method === 'cbsem' && input.cb) cbDraft(input, input.cb, d);
  else throw new Error(methodsBlocked(input) ?? 'No results to describe.');
  const { text, latex, keys } = render(d.parts.join(' '), d.versions);
  return {
    text,
    latex: `% Methods (drafted by PLS Studio; natbib citations, the works in the accompanying .bib file)\n${latex}\n`,
    bibtex: bibtex(keys, d.versions),
    keys,
  };
}
