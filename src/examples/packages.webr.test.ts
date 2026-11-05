// Every package example: its dataset loads from the package in webR, contains
// the columns the example uses, and the package estimates the example as
// documented. Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CbEstimator } from '../engine/cbsem';
import type { Dataset } from '../engine/types';
import { type DataInfo, DEFAULT_SETTINGS, toSpec } from '../model/project';
import { processInput } from '../process/input';
import { miivR } from '../rengine/analyses';
import { rCall, type RPackage } from '../rengine/bridge';
import { setWarningSink } from '../rengine/notices';
import { endoR } from '../rengine/endo';
import { matchR } from '../rengine/match';
import { rsaR } from '../rengine/rsa';
import { groupsR } from '../rengine/plsx';
import { ncaR } from '../rengine/nca';
import { categoriesOf } from '../io';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimateCpaR } from '../rengine/cpa';
import { irtR, lcaR } from '../rengine/items';
import { lcaSpec } from '../analyses/items';
import { estimateCbLavaan } from '../rengine/lavaan';
import { growthR } from '../rengine/longitudinal';
import { gmmR, lmmR } from '../rengine/mixed';
import { gmmInput } from '../analyses/longitudinal';
import { readPackageFile } from '../data/readFile';
import { fimixR, pathmoxR, rebusR } from '../rengine/segment';
import { plsScriptR, estimatePlsR } from '../rengine/pls';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { exampleModel, examplePanels, PACKAGE_EXAMPLES, panelColumns, type PackageExample } from './packages';
import { against, cleanRun, example, near, same } from '../validation/record';
import type { EvidenceSource } from '../validation/types';
import { exampleTestData } from './testData';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

// Every warning and note R raises while an example runs, by example. A
// documented example runs without a warning; the notes it may carry are
// listed here with their reason (they explain a result, nothing is wrong).
const raised: Record<string, { warnings: string[]; notes: string[] }> = {};
let currentExample = '';
beforeAll(() => setWarningSink((lines, _source, level) => { if (currentExample) (raised[currentExample] ??= { warnings: [], notes: [] })[level === 'info' ? 'notes' : 'warnings'].push(...lines); }));
afterAll(() => {
  setWarningSink(null);
  if (process.env.PS_EXAMPLE_WARNINGS) writeFileSync(process.env.PS_EXAMPLE_WARNINGS, JSON.stringify(raised, null, 2));
});
/** Notes an example is expected to carry, and why. */
const EXPECTED_NOTES: Record<string, RegExp[]> = {
  // plspm's simdata: Price and Quality are simulated as independent, so their items' correlations have mixed signs.
  'plspm-rebus': [/items of Price and Quality correlate with mixed signs/],
  'plspm-fimix': [/items of Price and Quality correlate with mixed signs/],
  // Yoo et al. (2000): several driver constructs are nearly uncorrelated in the data.
  'csem-yoo': [/correlate with mixed signs/],
  // mice's nhanes: cholesterol (mg/dL) has a variance a thousand times that of age (coded 1-3); lavaan's advice on scaling.
  'mice-nhanes': [/observed variances are \(at least\) a factor/],
  // Bollen's data: income in dollars and weight in pounds next to ratings on short scales; lavaan's advice on scaling.
  'bollen-felson': [/observed variances are \(at least\) a factor/],
};
/** Warnings that are the source's own result, and why. */
const EXPECTED_WARNINGS: Record<string, RegExp[]> = {
  // ?bollen1996's four-factor model as written: the variances estimated after MIIV-2SLS give factor correlations above 1 (stated on the card).
  'bollen-accessibility': [/not positive definite/],
  // lavaan's own notes under non-linear equality constraints (Mplus MODEL CONSTRAINT): its augmented-Lagrangian optimiser
  // passes through infeasible points, Browne's test is not defined, and the standardised solution's constraint check
  // and a standardised defined parameter come with cautions. The estimates are Mplus's (mplus/ch5, ch6 tests).
  'mplus-ex5.20': [/NA\/NaN function evaluation/, /browne\.residual\.nt\.model/, /number of items to replace/],
  // Mplus's own estimate of y4's residual variance is near zero (0.340, SE 0.254): some imputed data sets give a negative one.
  'mplus-ex11.6': [/some estimated ov variances are negative/],
  // ?mirt's 3PL of the LSAT7 patterns: its information matrix is singular, as on the help page (estimates as there, no SEs).
  'mirt-lsat7-3pl': [/Could not invert information matrix/],
  'mplus-ex6.17': [/browne\.residual\.nt\.model/, /standardized value of the defined parameter/],
  // ?fisher.test's job-satisfaction table: expected counts below 5, so chisq.test warns; the help page reads the exact test.
  'stats-contingency-job': [/approximation may be incorrect/],
};
const checkClean = (id: string) => {
  const r = raised[id] ?? { warnings: [], notes: [] };
  const warned = r.warnings.filter((w) => !(EXPECTED_WARNINGS[id] ?? []).some((re) => re.test(w)));
  const unexpected = [...new Set(r.notes)].filter((n) => !(EXPECTED_NOTES[id] ?? []).some((re) => re.test(n)));
  cleanRun(warned.length + unexpected.length);
  expect(warned, `${id} warned`).toEqual([]);
  expect(unexpected, `${id} carries an unexpected note`).toEqual([]);
};

/** The method family of an example, for the validation page. */
const PANEL_METHOD: Record<string, string> = {
  growth: 'Longitudinal', gmm: 'Longitudinal', lmm: 'Longitudinal', irt: 'Items', lca: 'Items', endo: 'Regression', regression: 'Regression', rsa: 'Regression',
  match: 'Causal inference', did: 'Causal inference', nca: 'NCA', efa: 'EFA', screen: 'CB-SEM', network: 'Networks', ega: 'Networks', bcorrelation: 'Bayesian', bsem: 'Bayesian',
};
const methodOf = (ex: PackageExample) => (ex.panel ? PANEL_METHOD[ex.panel.kind] ?? 'Analyses'
  : ex.settings.method === 'process' ? 'PROCESS' : ex.settings.method === 'cbsem' ? 'CB-SEM' : 'PLS-SEM');

/** Where the numbers an example is compared with come from (all from the packages' own documentation, or the package run natively). */
const doc = (label: string, url?: string): EvidenceSource & { level: 'native' } => ({ label, level: 'native', ...(url ? { url } : {}) });
const nativeScript = (name: string, what: string): EvidenceSource & { level: 'native' } => ({ label: `${what}, scripts/validation/${name}`, script: `scripts/validation/${name}`, level: 'native' });
const TUTORIAL = doc('lavaan tutorial, printed output', 'https://lavaan.ugent.be/tutorial/');
const SOURCES: Record<string, (EvidenceSource & { level: 'native' })[]> = {
  'lavaan-hs': [TUTORIAL], 'lavaan-hs-means': [TUTORIAL], 'lavaan-poldem': [TUTORIAL], 'lavaan-hs-groups': [TUTORIAL], 'lavaan-hs-esem': [TUTORIAL], 'lavaan-growth': [TUTORIAL],
  'lavaan-growth-conditional': [doc('the lavaan tutorial’s model run in desktop lavaan')],
  'did-mpdta': [doc('did, ?aggte (printed)', 'https://bcallaway11.github.io/did/reference/aggte.html')],
  'ivreg-kmenta': [doc('ivreg, ?ivreg (printed)')], 'nca-example': [doc('NCA, ?nca_analysis (printed)')], 'rsa-motcon': [doc('RSA run in desktop R')],
  'weightit-lalonde': [doc('WeightIt vignette (printed)'), nativeScript('weightit.R', 'desktop WeightIt and marginaleffects')],
  'lme4-sleepstudy': [doc('lme4, ?lmer (printed)')], 'ltm-lsat': [doc('ltm 1.2-0 run in desktop R')],
  'polca-carcinoma': [doc('poLCA, ?carcinoma (printed)')], 'polca-values': [doc('poLCA, ?values (printed)')],
  'modsem-oneint': [doc('modsem.org, “LMS and QML approaches” (printed)', 'https://modsem.org')],
  'csem-2ndorder': [nativeScript('secondorder.R', 'desktop cSEM')], 'csem-2ndorder-embedded': [nativeScript('hoc-approaches.R', 'desktop cSEM')], 'csem-2ndorder-repeated': [nativeScript('hoc-approaches.R', 'desktop cSEM')],
  'seminr-interaction-methods': [doc('seminr 2.5.0, ?interaction_term run in desktop R')], 'seminr-hoc': [doc('seminr 2.5.0 demo run in desktop R')],
  'csem-yoo': [nativeScript('secondorder.R', 'desktop cSEM')], 'plspm-rebus': [doc('plspm, ?it.reb (printed)')],
};

/** The Mplus growth examples' degrees of freedom (6.8 latent basis, 6.9 quadratic, 6.10 covariates). */
const GROWTH_DF: Record<string, number> = { 'mplus-ex6.8': 3, 'mplus-ex6.9': 1, 'mplus-ex6.10': 21, 'mplus-ex6.11': 6, 'mplus-ex6.13': 24, 'mplus-ex6.14': 33, 'mplus-ex6.17': 7, 'mplus-ex6.18': 77, 'mplus-ex11.4': 37 };
/** Documented values the estimate must reproduce. */
const CHISQ: Record<string, number> = { 'lavaan-twolevel': 8.092, 'lavaan-hs-esem': 22.897, 'lavaan-poldem': 40.179, 'lavaan-hs': 85.306, 'lavaan-hs-means': 85.306, 'lavaan-hs-groups': 164.103 };
/** lavaan tutorial, mean structures: cfa(HS.model, data = HolzingerSwineford1939, meanstructure = TRUE), the intercepts (native lavaan, 3 decimals). */
const HS_INTERCEPTS: Record<string, number> = { x1: 4.936, x2: 6.088, x3: 2.250, x4: 3.061, x5: 4.341, x6: 2.186, x7: 4.186, x8: 5.527, x9: 5.374 };

async function load(ex: PackageExample): Promise<Dataset & { levels?: unknown }> {
  // Data shipped with the app (packages that cannot run in the browser's R).
  const fromFile = exampleTestData(ex);
  if (fromFile) return fromFile;
  const pf = ex.data.packageFile;
  if (pf) return (await readPackageFile(ex.data.package, pf.path, pf.format, pf.sheet)).data;
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; n: number; levels?: Record<string, string[]> }>('ps_dataset', { package: ex.data.package, name: ex.data.name, na: ex.data.na ?? [] }, ex.data.package as RPackage);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), levels: raw.levels, ...categoriesOf(raw.levels) };
}

/** cSEM's two-stage second-order example against cSEM run natively (scripts/validation/secondorder.R). */
/** Paths, R² and the second-order loadings and weights against a native reference. */
type SecondOrderRef = { paths: Record<string, number>; r2: Record<string, number>; secondOrder: { loadings: Record<string, number>; weights: Record<string, number> }; firstOrderWeights?: Record<string, number> };
function sameSecondOrder(r: Awaited<ReturnType<typeof estimatePlsR>>, ref: SecondOrderRef, hoc: string, digits = 5) {
  const C = r.constructs, at = (n: string) => C.indexOf(n);
  for (const [k, b] of Object.entries(ref.paths)) { const [f, t] = k.split(' -> '); expect(r.pathCoef[at(f)][at(t)], `path ${k}`).toBeCloseTo(b, digits); }
  for (const [k, v] of Object.entries(ref.r2)) expect(r.rSquared[at(k)], `R² ${k}`).toBeCloseTo(v, digits);
  for (const comp of Object.keys(ref.secondOrder.loadings)) {
    const h = r.higherOrder!.find((x) => C[x.construct] === hoc && C[x.component] === comp)!;
    expect(h.loading, `second-order loading ${comp}`).toBeCloseTo(ref.secondOrder.loadings[comp], digits);
    expect(h.weight, `second-order weight ${comp}`).toBeCloseTo(ref.secondOrder.weights[comp], digits);
  }
}

async function checkSecondOrder(data: Dataset, spec: ReturnType<typeof toSpec>, r: Awaited<ReturnType<typeof estimatePlsR>>, st: typeof DEFAULT_SETTINGS) {
  const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'secondorder', 'reference.json'), 'utf8'));
  sameSecondOrder(r, ref, 'c4');
  for (const [ind, w] of Object.entries(ref.firstOrderWeights as Record<string, number>)) expect(r.weights[r.indicators.findIndex((x) => x.name === ind)], ind).toBeCloseTo(w, 5);
  for (const [ind, v] of Object.entries(ref.vifModeB as Record<string, number>)) expect(r.vifOuter[r.indicators.findIndex((x) => x.name === ind)], `VIF ${ind}`).toBeCloseTo(v, 5);
  // The bootstrap (one call, cSEM's own resampling, same seed) reproduces cSEM's standard errors.
  const { bootstrapR } = await import('../rengine/analyses');
  const b = await bootstrapR(data, spec, { kind: 'plsBoot', pkg: 'cSEM', boot: { samples: 100, seed: 1, confidence: 0.95 },
    options: { scheme: st.scheme, consistent: st.consistent, missing: st.missing, tolerance: 1e-7, maxIter: 300 } }, () => '');
  const sd = (key: string) => b.stats.find((x) => x.key === key)!.sd;
  expect(sd('path:eta1:c4')).toBeCloseTo(ref.bootSE['eta1 -> c4'], 4);
  expect(sd('path:c4:eta2')).toBeCloseTo(ref.bootSE['c4 -> eta2'], 4);
  expect(sd('hoLoading:c4:c1')).toBeCloseTo(ref.bootSE['c4 =~ c1'], 4);
}

describe.each(PACKAGE_EXAMPLES.map((e) => [e.id, e] as const))('package example %s in webR', (_id, ex) => {
  it('loads its data from the package and estimates', async () => {
    currentExample = ex.id;
    example(ex.id, { title: ex.title, method: methodOf(ex), packages: [ex.package], definition: ex });
    for (const s of SOURCES[ex.id] ?? []) against(s);
    let data = await load(ex);
    // The help page's recodes (computed columns, category labels), as the example loader applies them.
    if (ex.computed?.length || ex.labels) {
      const { computeColumn } = await import('../data/compute');
      let inf0: DataInfo = { fileName: 'x', rows: data.cols[0].length, missingCells: 0, excluded: [] };
      for (const k of ex.computed ?? []) ({ data, info: inf0 } = computeColumn(data, inf0, k.name, k.expr));
      if (ex.labels) data = { ...data, categories: { ...(data.categories ?? {}), ...ex.labels } };
    }
    const st = { ...DEFAULT_SETTINGS, ...ex.settings };
    if (ex.panel) {
      const p = ex.panel;
      for (const q of examplePanels(ex)) for (const c of panelColumns(q)) expect(data.names, `${ex.id}: ${c}`).toContain(c);
      if (p.kind === 'endo') {
        const { kind: _k, ...pre } = p;
        const r = await endoR(data, { method: 'iv', outcome: '', exogenous: [], endogenous: [], instruments: [], hetRegressors: [], hmTypes: [], selection: { outcome: '', regressors: [] },
          heckmanMethod: 'ml', boot: { samples: 50, seed: 1, confidence: 0.95 }, ...pre });
        expect(r.coefficients.length).toBeGreaterThan(0);
        if (ex.id === 'ivreg-kmenta') expect(r.coefficients.find((x) => x.term === 'P')!.est, 'coefficient of P').toBeCloseTo(-0.2436, 4);  // ?ivreg
      } else if (p.kind === 'nca') {
        const r = await ncaR(data, p.x, p.y, 50);
        expect(r.conditions[0].ceFdh, 'CE-FDH effect size, Individualism').toBeCloseTo(0.4155, 3);  // ?nca_analysis: Individualism, CE-FDH
      } else if (p.kind === 'rsa') {
        const { kind: _k, ...pre } = p;
        const r = await rsaR(data, { outcome: '', x: '', y: '', controls: [], estimation: 'OLS', center: 'none', midpoint: 0, confidence: 0.95, ...pre });
        expect(r.surface.find((s) => s.name === 'a1')!.est, 'surface parameter a1').toBeCloseTo(0.5553, 3);  // RSA: a1 on motcon
      } else if (p.kind === 'match') {
        const { kind: _k, ...pre } = p;
        const r = await matchR(data, { treatment: '', covariates: [], outcome: '', method: 'nearest', distance: 'glm', estimand: 'ATT', ratio: 1, caliper: null, replace: false, seed: 1, confidence: 0.95, ...pre });
        expect(r.counts[1].treated).toBe(185);
        if (ex.id === 'weightit-lalonde') {
          // (the example's entropy balancing is checked against the vignette in causal.webr.test.ts)
          against(SOURCES[ex.id][0]);
          near('ATT (entropy balancing)', r.effect!.est, 1273, 0.5);
          against(SOURCES[ex.id][1]);
          // Propensity-score weights (the vignette's first step), against WeightIt + marginaleffects run natively (scripts/validation/weightit.R).
          const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'match', 'weightit.json'), 'utf8'));
          const glm = await matchR(data, { treatment: '', covariates: [], outcome: '', method: 'nearest', distance: 'glm', estimand: 'ATT', ratio: 1, caliper: null, replace: false, seed: 1, confidence: 0.95, ...pre, weightMethod: 'glm' });
          const r2 = glm;
          expect(r2.effect!.est, 'ATT (propensity-score weights, doubly robust)').toBeCloseTo(ref.dr.est, 4);
          // (marginaleffects differentiates numerically: SEs agree to about 6 significant digits across builds)
          near('SE / reference SE', r2.effect!.se / ref.dr.se, 1, 1e-5);
          near('CI lower / reference', r2.effect!.ciLow / ref.dr.low, 1, 1e-4);
          expect(r2.counts[1].control, 'effective sample size, control').toBeCloseTo(ref.essControl, 6);
          expect(r2.balance.find((b) => b.variable === 'age')!.diffAfter, 'balance on age after weighting').toBeCloseTo(ref.ageAfter, 8);
          const ipw = await matchR(data, { treatment: '', covariates: [], outcome: '', method: 'nearest', distance: 'glm', estimand: 'ATT', ratio: 1, caliper: null, replace: false, seed: 1, confidence: 0.95, ...pre, weightMethod: 'glm', effectModel: 'ipw' });
          expect(ipw.effect!.est, 'ATT (IPW)').toBeCloseTo(ref.ipw.est, 4);
          expect(ipw.effect!.se, 'SE (IPW)').toBeCloseTo(ref.ipw.se, 4);
        }
      } else if (p.kind === 'lmm') {
        const { kind: _k, ...input } = p;
        const r = await lmmR(data, input);
        expect(r.fixed.length).toBeGreaterThan(0);
        if (ex.id === 'lme4-sleepstudy') {
          expect(r.fixed.find((f) => f.term === 'Days')!.est, 'fixed effect of Days').toBeCloseTo(10.4673, 3);  // ?lmer: fixef(fm1)
          expect(r.clusters).toBe(18);
        }  // (the Mplus two-level regressions: checked in mplus/ch9.webr.test.ts)
      } else if (p.kind === 'gmm') {
        const { kind: _k, ...options } = p;
        const r = await gmmR(data, gmmInput(options, 1));
        expect(r.models.map((m) => m.k)).toEqual(Array.from({ length: options.to }, (_, i) => i + 1));
        if (ex.id === 'lcmm-hlme') expect(r.n).toBe(100);  // (the Mplus growth mixtures: checked in mplus/ch8.webr.test.ts)
      } else if (p.kind === 'regression') {
        // (each of these is checked coefficient by coefficient in src/rengine/regression.webr.test.ts)
        const { regressionR } = await import('../rengine/regression');
        const { kind: _k, ...opts } = p;
        const r = await regressionR(data, { ...opts, confidence: 0.95 });
        expect(r.coefficients.length).toBeGreaterThan(0);
        // (a likelihood-ratio test against the null model; not for the censored, inflated and survival models, checked in mplus/ch3 and ch6surv)
        if (opts.family !== 'censored' && opts.family !== 'survival' && !opts.inflated && !opts.randomSlope) expect(r.lrt).toBeTruthy();
      } else if (p.kind === 'did') {
        const { didR } = await import('../rengine/did');
        const { kind: _k, ...opts } = p;
        const r = await didR(data, { ...opts, seed: 1, confidence: 0.95 });
        if (ex.id === 'did-mpdta') { expect(r.att.est, 'overall ATT').toBeCloseTo(-0.04, 2); expect(r.att.se, 'SE of the ATT').toBeCloseTo(0.013, 2); expect(r.groupTime!.length).toBeGreaterThanOrEqual(12); }  // ?aggte: ATT -0.04 (0.013)
        else { expect(r.units).toBe(new Set(data.cols[data.names.indexOf('id')]).size); expect(r.periods).toBe(10); expect(r.event.length).toBe(10); expect(r.att.est).toBeGreaterThan(0); }
      } else if (p.kind === 'growth') {
        const r = await growthR(data, { ...p, estimator: 'ML', missing: st.missing });
        if (ex.id === 'lavaan-growth-conditional') { expect(r.fit.df).toBe(21); expect(r.fit.chisq, 'χ²').toBeCloseTo(26.059, 2); }  // the tutorial's model, run natively
        else expect(r.fit.df).toBe(GROWTH_DF[ex.id] ?? 5);
        if (ex.id === 'lavaan-growth') expect(r.fit.chisq, 'χ²').toBeCloseTo(8.069, 3);  // the tutorial prints 8.069 on 5 df  // ?growth: linear growth on four occasions; the Mplus growth examples (checked in mplus.webr.test.ts)
      } else if (p.kind === 'irt' && (p.model === 'threepl' || p.model === 'fourpl' || (p.classes ?? 1) > 1)) {
        // (the mirt models with priors and mixtures: estimated with their options, at length, in their own tests,
        // examples/mplus/ch5irt and ch7irt and examples/cards/items; here the data and the card's options)
        expect(p.items.every((i) => data.names.includes(i))).toBe(true);
      } else if (p.kind === 'irt') {
        const r = await irtR(data, p.items, p.model);
        expect(r.params.length).toBe(p.items.length);
        if (ex.id === 'ltm-lsat') expect(r.logLik, 'log-likelihood').toBeCloseTo(-2466.9376, 3);  // rasch(LSAT) in native R (ltm 1.2-0)
      } else if (p.kind === 'lca') {
        const r = await lcaR(data, p.items, Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from + i), 10, st.seed, lcaSpec(p));
        expect(r.models.map((m) => m.k)).toEqual(Array.from({ length: p.to - p.from + 1 }, (_, i) => p.from + i));
        // The log-likelihoods the help pages print (poLCA's ?carcinoma: 2, 3, 4 classes; ?values: 1, 2, 3).
        const LL: Record<string, number[]> = { 'polca-carcinoma': [-317.2568, -293.705, -289.2858], 'polca-values': [-543.6498, -504.4677, -503.3011] };
        if (LL[ex.id]) r.models.forEach((m, i) => expect(m.llik, `${ex.id} k = ${m.k}`).toBeCloseTo(LL[ex.id][i], 3));
      }
      checkClean(ex.id);
      return;
    }
    const model = exampleModel(ex);
    const spec = toSpec(model);
    for (const c of spec.constructs) for (const i of c.indicators) expect(data.names, `${ex.id}: ${i}`).toContain(i);
    for (const col of [ex.multigroup?.column, ex.multilevel?.column]) if (col) expect(data.names).toContain(col);
    if (st.method === 'process') {
      const input = processInput(model, st, data)!;
      const r = await estimateCpaR(data, { ...input, boot: { samples: 200, seed: 1 } });
      expect(r.equations.length).toBeGreaterThan(0);
    } else if (st.method === 'cbsem' && st.estimator === '2SLS') {
      const r = await miivR(data, spec, st.missing);
      expect(r.equations.length).toBeGreaterThan(0);
    } else if (st.method === 'cbsem') {
      const r = await estimateCbLavaan(data, spec, st.missing, st.estimator as CbEstimator, st.interaction);
      expect(r.converged).toBe(true);
      if (CHISQ[ex.id] !== undefined) expect(r.fit.chisq, 'χ²').toBeCloseTo(CHISQ[ex.id], 2);
      if (ex.id === 'modsem-oneint') {
        // ?compare_fit: LMS on oneInt against its null model (estimate_h0). modsem 1.0.23 (webR): D = 676.55 on 1 df,
        // which is 2 x (logLik h1 - logLik h0) of its own fits; modsem 1.0.10 computed a different LMS log-likelihood
        // for h1 (D = 6288) with the same h0, so the value is version-bound (the native scratch library has 1.0.10).
        expect(r.interaction).toBe('lms');
        expect(r.lrt?.df).toBe(1);
        expect(r.lrt?.D, 'likelihood-ratio D (modsem 1.0.23)').toBeCloseTo(676.55, 1);
        expect(r.lrt?.p).toBeLessThan(0.001);
        // modsem.org, article "LMS and QML approaches" (modsem 1.0.24): Y ~ X 0.673 (0.031), Z 0.569 (0.030), X:Z 0.718 (0.028); H0 chi-square 17.52 on 24 df.
        const reg = (rhs: RegExp) => r.estimates.find((e) => e.op === '~' && e.lhs === 'Y' && rhs.test(e.rhs))!;
        expect(reg(/^X$/).est, 'Y ~ X').toBeCloseTo(0.673, 3); expect(reg(/^X$/).se!, 'SE of Y ~ X').toBeCloseTo(0.031, 3);
        expect(reg(/^Z$/).est, 'Y ~ Z').toBeCloseTo(0.569, 3);
        expect(reg(/X.*Z|Z.*X/).est, 'Y ~ X:Z').toBeCloseTo(0.718, 3); expect(reg(/X.*Z|Z.*X/).se!, 'SE of Y ~ X:Z').toBeCloseTo(0.028, 3);
        near('H0 χ²', r.fit.chisq, 17.52, 0.01); expect(r.fit.df).toBe(24);  // (17.529: modsem's printout truncates)
      }
      if (ex.id === 'lavaan-hs-means') {
        expect(spec.meanStructure).toBe(true);
        const intercepts = r.estimates.filter((e) => e.kind === 'intercept');
        expect(intercepts.map((e) => e.lhs).sort()).toEqual(Object.keys(HS_INTERCEPTS));
        for (const e of intercepts) expect(e.est, `intercept of ${e.lhs}`).toBeCloseTo(HS_INTERCEPTS[e.lhs], 3);
        for (const e of r.estimates.filter((e) => e.kind === 'mean')) expect(e.est, e.lhs).toBe(0);  // latent means stay fixed at zero: no arrows drawn
      }
    } else {
      // (each example at its own settings: scheme, PLSc, tolerance and iterations as its source)
      const r = await estimatePlsR(data, spec, { scheme: st.scheme, consistent: st.consistent, missing: st.missing, tolerance: 10 ** -st.stopExp, maxIter: st.maxIter, hocApproach: st.hocApproach }, st.plsPackage);
      expect(r.converged).toBe(true);
      if (ex.id === 'csem-2ndorder') await checkSecondOrder(data, spec, r, st);
      if (ex.id === 'csem-2ndorder-embedded' || ex.id === 'csem-2ndorder-repeated') {
        // cSEM's help page run natively: res_mixed and res_RI (scripts/validation/hoc-approaches.R).
        const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'secondorder', 'approaches.json'), 'utf8'));
        sameSecondOrder(r, ex.id === 'csem-2ndorder-embedded' ? ref.csemEmbedded : ref.csemRepeated, 'c4');
        const script = await plsScriptR(data, spec, { scheme: st.scheme, consistent: st.consistent, missing: st.missing, tolerance: 1e-5, maxIter: 100, hocApproach: st.hocApproach }, 'cSEM');
        if (ex.id === 'csem-2ndorder-embedded') expect(script).toContain('.approach_2ndorder = "mixed"');
        else { expect(script).toContain('data <- cbind(data, setNames(data[rep_items], paste0(rep_items, "_rep")))'); expect(script).toContain('c4 ~ eta1 + c1 + c2 + c3'); expect(script).not.toContain('.approach_2ndorder'); }
      }
      if (ex.id === 'seminr-interaction-methods') {
        // ?interaction_term run natively (seminr 2.5.0): the path coefficients on Satisfaction.
        const path = (from: string) => r.pathCoef[r.constructs.indexOf(from)][r.constructs.indexOf('Satisfaction')];
        for (const [from, v] of [['Image', 0.4532], ['Expectation', 0.1705], ['Value', 0.3122], ['Image × Expectation', -0.1672], ['Image × Value', 0.0221]] as const) expect(path(from), from).toBeCloseTo(v, 4);
        const script = await plsScriptR(data, spec, { scheme: st.scheme, consistent: st.consistent, missing: st.missing, tolerance: 1e-7, maxIter: 300 }, 'seminr');
        expect(script).toContain('method = orthogonal)');
        expect(script).toContain('method = product_indicator)');
      }
      if (ex.id === 'seminr-hoc') {
        // seminr's demo, both variants, against seminr 2.5.0 run natively.
        const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'secondorder', 'seminr.json'), 'utf8'));
        const check = (res: typeof r, v: SecondOrderRef) => {
          sameSecondOrder(res, v, 'Satisfaction', 5);
          for (const [ind, w] of Object.entries(v.firstOrderWeights as Record<string, number>)) expect(res.weights[res.indicators.findIndex((x) => x.name === ind)], ind).toBeCloseTo(w, 5);
        };
        check(r, ref.modeA);
        const modeB = { ...spec, constructs: spec.constructs.map((k) => (k.name === 'Image' || k.name === 'Value' ? { ...k, mode: 'B' as const } : k)) };
        check(await estimatePlsR(data, modeB, { scheme: st.scheme, consistent: false, missing: st.missing, tolerance: 1e-7, maxIter: 300 }, 'seminr'), ref.modeB);
      }
      if (ex.id === 'csem-yoo') {
        const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'secondorder', 'yoo.json'), 'utf8'));
        sameSecondOrder(r, ref, 'BR', 4);
        for (const [ind, l] of Object.entries(ref.firstOrderLoadings as Record<string, number>)) expect(r.loadings[r.indicators.findIndex((x) => x.name === ind)], ind).toBeCloseTo(l, 4);
      }
    }
    if (ex.assessment?.group) {
      const g = await groupsR(data, spec, { scheme: st.scheme, consistent: false, missing: 'casewise', tolerance: 1e-7, maxIter: 300 }, { group: ex.assessment.group, approaches: ['Klesel'], samples: 20, seed: 1 });
      expect(g.groups).toHaveLength(2);
    }
    if (ex.segmentation?.method === 'fimix') {
      const t = await fimixR(data, spec, { scheme: st.scheme, consistent: false, missing: 'casewise', tolerance: 1e-7, maxIter: 300 }, { classes: [1, 2, 3], nrep: 10, seed: 1, intercepts: true });
      expect(t.models.reduce((a, b) => (b.criteria.BIC < a.criteria.BIC ? b : a)).k).toBe(2);
    } else if (ex.segmentation?.method === 'pathmox') {
      const cats = (data as Dataset).categories ?? {};
      const segments = (ex.segmentation.segments ?? []).map((sg) => ({ column: sg.column, labels: cats[sg.column] ?? [], ordered: !!sg.order, ...(sg.order ? { order: sg.order.map((l) => cats[sg.column].indexOf(l) + 1) } : {}) }));
      const t = await pathmoxR(data, spec, { scheme: st.scheme, consistent: st.consistent, missing: 'casewise', tolerance: 1e-7, maxIter: 300 }, { segments, alpha: 0.05, depth: 2, size: 0.1 });
      expect(t.nodes).toHaveLength(7);  // ?pls.pathmox: age, then education and region
    } else if (ex.segmentation) {
      const seg = await rebusR(data, spec, { scheme: st.scheme, consistent: false, missing: 'casewise', tolerance: 1e-6, maxIter: 100 },
        { classes: [ex.segmentation.from ?? 2], stopCrit: 0.005, iterMax: 100, seed: 1 });
      if (ex.id === 'plspm-rebus') expect(seg.models[0].gqi, 'GQI, two classes').toBeCloseTo(0.8341, 3);  // ?it.reb, nk = 2
    }
    checkClean(ex.id);
  }, 600_000);
});

it('factors arrive as codes in level order, with their levels', async () => {
  const d = await load(PACKAGE_EXAMPLES.find((e) => e.id === 'lavaan-hs-groups')!);
  const school = d.cols[d.names.indexOf('school')];
  expect(new Set(school)).toEqual(new Set([1, 2]));
  expect((d.levels as Record<string, string[]>).school).toEqual(['Grant-White', 'Pasteur']);
}, 600_000);

it('lavaan-twolevel reproduces the multilevel tutorial: the estimates within and between clusters', async () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'lavaan-twolevel')!;
  example(ex.id, { title: ex.title, method: 'CB-SEM', packages: [ex.package], definition: ex });
  against(doc('lavaan tutorial, “Multilevel SEM” (printed)', 'https://lavaan.ugent.be/tutorial/multilevel.html'));
  const data = await load(ex);
  const r = await estimateCbLavaan(data, toSpec(exampleModel(ex)), 'casewise', 'ML', 'product');
  same('df', r.fit.df, 10); same('free parameters', r.fit.npar, 20); expect(r.fit.chisq, 'χ²').toBeCloseTo(8.092, 3);
  const [within, between] = r.groups!.results;
  const est = (g: typeof within, lhs: string, rhs: string) => g.estimates.find((e) => e.op === '~' && e.lhs === lhs && e.rhs === rhs)!.est;
  // Printed: fw ~ x1 0.510, x2 0.407, x3 0.205; fb ~ w1 0.165, w2 0.131; fb =~ y2 0.717, y3 0.587.
  expect(est(within, 'fw', 'x1'), 'within: fw ~ x1').toBeCloseTo(0.510, 3); expect(est(within, 'fw', 'x2'), 'within: fw ~ x2').toBeCloseTo(0.407, 3); expect(est(within, 'fw', 'x3'), 'within: fw ~ x3').toBeCloseTo(0.205, 3);
  expect(est(between, 'fw', 'w1'), 'between: fw ~ w1').toBeCloseTo(0.165, 3); expect(est(between, 'fw', 'w2'), 'between: fw ~ w2').toBeCloseTo(0.131, 3);
  expect(between.estimates.find((e) => e.op === '=~' && e.lhs === 'fw' && e.rhs === 'y2')!.est, 'between: fw =~ y2').toBeCloseTo(0.717, 3);
}, 600_000);
