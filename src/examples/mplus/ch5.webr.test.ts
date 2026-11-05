// Mplus User's Guide, chapter 5: the examples in webR against what their Mplus outputs print
// (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { CbEstimator } from '../../engine/cbsem';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { estimateCbLavaan } from '../../rengine/lavaan';
import { irtR } from '../../rengine/items';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { exampleModel } from '../packages';
import { evidence, example, load, MPLUS, runCards, sameFit, samePrinted } from './testkit';
import type { CustomMlResult } from '../../rengine/customml';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

it.each([['ex3.11'], ['ex5.1'], ['ex5.2'], ['ex5.6'], ['ex5.8'], ['ex5.11'], ['ex5.14'], ['ex5.15'], ['ex5.25']])('%s reproduces the Mplus output: fit, estimates and standard errors', async (key) => {
  const ex = example(key);
  evidence(key, 'CB-SEM', ['lavaan']);
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const r = await estimateCbLavaan(load(key), toSpec(exampleModel(ex)), 'casewise', st.estimator as CbEstimator, 'product');
  const want = MPLUS[key];
  expect(r.converged).toBe(true);
  if (key === 'ex5.2') {
    // WLSMV with the test statistic as Mplus's (mimic = "Mplus").
    same('free parameters', r.fit.npar, want.fit.npar!);
    same('df', r.fit.df, want.fit.df!);
    near('χ² (WLSMV, as Mplus)', r.fit.chisqScaled!, want.fit.chisq!, 0.002);
    // Reliability with ordinal indicators: categorical omega and ordinal alpha, without a warning from semTools.
    expect(r.warnings).toEqual([]);
    for (const rel of r.reliability) { expect(rel.omega).toBeGreaterThan(0.5); expect(rel.alpha).toBeGreaterThan(0.5); }
  } else sameFit(r.fit, want.fit);
  if (r.groups) {
    expect(r.groups.labels.length).toBe(2);
    for (const g of [1, 2]) samePrinted(r.groups.results[g - 1].estimates, want.estimates.filter((p) => p.group === g), `${key} group ${g}`);
  } else samePrinted(r.estimates, want.estimates, key);
}, 600_000);

it('ex5.13: the latent interaction by LMS reproduces the Mplus estimates to two decimals', async () => {
  const ex = example('ex5.13');
  evidence('ex5.13', 'CB-SEM', ['modsem']);
  const r = await estimateCbLavaan(load('ex5.13'), toSpec(exampleModel(ex)), 'casewise', 'ML', 'lms');
  expect(r.interaction).toBe('lms');
  // Mplus integrates numerically (MLR); modsem's LMS uses its own quadrature (ML): the loadings and paths agree
  // within 0.002, the standard errors and the log-likelihood are not comparable (both documented on the card).
  const mine = r.estimates.map((e) => (e.op === '~' && /f1.*f2|f2.*f1/.test(e.rhs) ? { ...e, rhs: 'f1:f2' } : e));
  samePrinted(mine, MPLUS['ex5.13'].estimates.filter((p) => p.op === '=~' || p.op === '~'), 'ex5.13', { tol: 0.002, ses: false });
}, 600_000);

it('the replication scripts carry the Mplus defaults: observed information, geomin ε, no mean structure, intercepts of observed variables', async () => {
  const { cbScriptLavaan } = await import('../../rengine/lavaan');
  const script = async (key: string) => cbScriptLavaan(load(key), toSpec(exampleModel(example(key))), 'casewise', 'ML');
  const s525 = await script('ex5.25');
  expect(s525).toContain('information = "observed"');
  expect(s525).toContain('rotation.args = list(geomin.epsilon = 0.0001)');
  const s514 = await script('ex5.14');
  expect(s514).toContain('meanstructure = FALSE');
  expect(s514).not.toContain('information = "observed"');
  // An observed variable's intercept on its construct (the indicator's fixed at 0), in one group.
  const s311 = await script('ex3.11');
  expect(s311).toMatch(/y3_lv ~ 1/);
  expect(s311).toMatch(/y3 ~ 0\*1 {3}# the intercept of y3_lv/);
  // Ordinal groups as Mplus: scale factors (delta) or residual variances (theta) free after the first group, u3's fixed;
  // u3's thresholds freed with its loading; equality constraints and per-group labels as lavaan syntax.
  const s516 = await script('ex5.16'), s517 = await script('ex5.17');
  expect(s516).toMatch(/u1 ~\*~ c\(1, NA\)\*u1/);
  expect(s516).toMatch(/u3 ~\*~ c\(1, 1\)\*u3/);
  expect(s516).toContain('"u3|t1"');
  expect(s517).toMatch(/u1 ~~ c\(1, NA\)\*u1/);
  expect(s517).toContain('parameterization = "theta"');
  const s520 = await script('ex5.20');
  expect(s520).toMatch(/\(rel5\) == \(rel2\)|rel5 == rel2/);
  expect(s520).toMatch(/y2 ~~ ve2\*y2/);
  const s521 = await script('ex5.21');
  expect(s521).toMatch(/~~ c\(covmz, covdz\)\*/);
  expect(s521).toMatch(/~~ c\(v, v\)\*/);
}, 600_000);


/** MODEL CONSTRAINT's NEW parameters and MODEL INDIRECT's effects, where the output prints them (extra keys of the printed file). */
const printedExtra = (key: string) => MPLUS[key] as unknown as { new?: Record<string, { est: number; se: number }>; indirect?: { from: string; to: string; effect: string; est: number; se: number }[] };
type Result = Awaited<ReturnType<typeof estimateCbLavaan>>;
const fitOf = async (key: string): Promise<Result> => {
  const ex = example(key);
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const r = await estimateCbLavaan(load(key), toSpec(exampleModel(ex)), 'casewise', st.estimator as CbEstimator, 'product');
  expect(r.converged).toBe(true);
  return r;
};
/** Each group's estimates against what Mplus prints for it (Mplus's Scales are lavaan's ~*~ rows). */
const sameByGroup = (r: Result, key: string, opts: Parameters<typeof samePrinted>[3] = {}) => {
  const scales = (e: Result['estimates'][number]) => (e.kind === 'scale' ? { ...e, op: 'Scales', rhs: '' } : e);
  if (!r.groups) { samePrinted(r.estimates.map(scales), MPLUS[key].estimates, key, opts); return; }
  for (const g of [1, 2]) samePrinted(r.groups.results[g - 1].estimates.map(scales), MPLUS[key].estimates.filter((p) => p.group === g), `${key} group ${g}`, opts);
};
/** NEW parameters (Mplus) against the defined parameters (lavaan :=), which every group's table lists. */
const sameNew = (r: Result, key: string, seTol = 0.001) => {
  const est = (r.groups ? r.groups.results[0].estimates : r.estimates).filter((e) => e.kind === 'defined');
  for (const [name, p] of Object.entries(printedExtra(key).new!)) {
    const e = est.find((x) => x.lhs === name);
    expect(e, `${key}: ${name}`).toBeDefined();
    near(name, e!.est, p.est, 0.001);
    near(`SE of ${name}`, e!.se!, p.se, seTol);
  }
};
const scaledFit = (r: Result, key: string, tol: number) => {
  const want = MPLUS[key].fit;
  same('free parameters', r.fit.npar, want.npar!);
  same('df', r.fit.df, want.df!);
  near('χ² (WLSMV, scaled and shifted)', r.fit.chisqScaled!, want.chisq!, tol);
};

it('ex5.9, ex5.12: equal intercepts; the indirect effect (MODEL INDIRECT) with its delta-method standard error', async () => {
  for (const key of ['ex5.9', 'ex5.12']) {
    evidence(key, 'CB-SEM', ['lavaan']);
    const r = await fitOf(key);
    sameFit(r.fit, MPLUS[key].fit);
    samePrinted(r.estimates, MPLUS[key].estimates, key);
    expect(r.warnings).toEqual([]);
  }
  // ex5.9: the intercepts are equal within each factor (one label each).
  const r9 = await fitOf('ex5.9');
  const ints = r9.estimates.filter((e) => e.op === '~1' && e.kind === 'intercept');
  expect(new Set(ints.filter((e) => e.lhs.startsWith('y1')).map((e) => e.est.toFixed(10))).size).toBe(1);
  const r12 = await fitOf('ex5.12');
  const ind = r12.estimates.find((e) => e.kind === 'defined' && e.lhs === 'ind')!;
  const want = printedExtra('ex5.12').indirect!.find((x) => x.from === 'f1' && x.to === 'f4' && x.effect === 'Indirect')!;
  near('indirect effect of f1 on f4 via f3', ind.est, want.est, 0.001);
  near('SE of the indirect effect (delta method)', ind.se!, want.se, 0.001);
}, 600_000);

it('ex5.20, ex5.21: non-linear constraints and NEW parameters (defined parameters, == and > constraints, values per group)', async () => {
  for (const key of ['ex5.20', 'ex5.21']) {
    evidence(key, 'CB-SEM', ['lavaan']);
    const r = await fitOf(key);
    sameFit(r.fit, MPLUS[key].fit);
    const isNew = (p: { lhs: string }) => p.lhs in printedExtra(key).new!;
    // ex5.20: one standard error, of f2's variance, is 0.0880 against Mplus's printed 0.087 (documented on the card).
    sameByGroup(r, key, { skip: isNew, seTol: key === 'ex5.20' ? 0.0011 : 0.001 });
    sameNew(r, key);
  }
}, 600_000);

it('ex5.3, ex5.10, ex5.16, ex5.22: categorical indicators by WLSMV, estimates and standard errors as Mplus prints them', async () => {
  // ex5.10: thresholds held equal (the test statistic as Mplus's, mimic = "Mplus"); ex5.22: the twin model for binary
  // outcomes. Every estimate and SE as printed.
  for (const [key, chiTol] of [['ex5.10', 0.002], ['ex5.22', 0.002]] as const) {
    evidence(key, 'CB-SEM', ['lavaan']);
    const r = await fitOf(key);
    scaledFit(r, key, chiTol);
    sameByGroup(r, key, { skip: (p) => !!printedExtra(key).new && p.lhs in printedExtra(key).new! });
    if (printedExtra(key).new) sameNew(r, key);
    expect(r.warnings).toEqual([]);
  }
  // ex5.3: continuous and binary indicators, with Mplus's standard errors (the default) and test statistic (mimic =
  // "Mplus", which also weights the continuous indicators' variances as Mplus): every estimate and SE as printed.
  evidence('ex5.3', 'CB-SEM', ['lavaan']);
  const r3 = await fitOf('ex5.3');
  scaledFit(r3, 'ex5.3', 0.002);
  samePrinted(r3.estimates, MPLUS['ex5.3'].estimates, 'ex5.3');
  // ex5.16: two groups, thresholds and loadings equal, scale factors free in the second group; u3's loading and
  // threshold free for females, its scale fixed at 1. Every estimate and SE as printed (Mplus's standard errors: the
  // expected information in the sandwich, divided by N, not N − 2). lavaan's χ² (mimic = "Mplus" would change the
  // groups' equalities) is 33.693 against Mplus's 33.718.
  evidence('ex5.16', 'CB-SEM', ['lavaan']);
  const r16 = await fitOf('ex5.16');
  scaledFit(r16, 'ex5.16', 0.03);
  sameByGroup(r16, 'ex5.16');
  expect(r16.warnings).toEqual([]);
}, 600_000);

it('ex5.17: the theta parameterisation is the same model as ex5.16 (same χ²); Mplus’s printed estimates sit on a flat stretch of the fit function', async () => {
  evidence('ex5.17', 'CB-SEM', ['lavaan']);
  const r = await fitOf('ex5.17');
  scaledFit(r, 'ex5.17', 0.03);
  const r16 = await fitOf('ex5.16');
  near('χ² equal to the delta parameterisation’s', r.fit.chisqScaled!, r16.fit.chisqScaled!, 1e-6);
  // Male group (residual variances fixed at 1): estimates within 0.002, every SE within 0.001 (Mplus's standard errors).
  // Female group: within 0.021 (estimates) and 0.009 (SEs, which follow the estimates: f1's variance 0.711 against 0.719); lavaan's objective at Mplus's
  // printed values is 0.0048524 against 0.0048522 at its own minimum (documented).
  samePrinted(r.groups!.results[0].estimates, MPLUS['ex5.17'].estimates.filter((p) => p.group === 1), 'ex5.17 group 1', { tol: 0.002 });
  samePrinted(r.groups!.results[1].estimates, MPLUS['ex5.17'].estimates.filter((p) => p.group === 2), 'ex5.17 group 2', { tol: 0.021, seTol: 0.009 });
  expect(r.warnings).toEqual([]);
}, 600_000);

it.each([['ex5.5part2', 'twopl'], ['ex5.5', 'gpcm']])('%s: the IRT model (ltm, %s) reproduces the Mplus output: log-likelihood, loadings, thresholds and their MLR standard errors', async (key) => {
  const ex = example(key);
  evidence(key, 'Item response theory', ['ltm']);
  const p = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'irt' }>;
  const r = await irtR(load(key), p.items, p.model, { quadrature: p.quadrature, robust: p.robust });
  const want = MPLUS[key];
  const npar = Math.round((r.aic + 2 * r.logLik) / 2);
  same('free parameters', npar, want.fit.npar!);
  near('log-likelihood', r.logLik, want.fit.logl!, 0.002);
  near('AIC', r.aic, want.fit.aic!, 0.004);
  near('BIC', r.bic, want.fit.bic!, 0.004);
  // Mplus's =~ rows are the loadings; its thresholds (2PL) and steps (partial credit) are minus ltm's intercepts.
  const mine = r.coefficients!.map((k) => ({ lhs: k.parameter === 'loading' ? 'f' : p.model === 'gpcm' ? `${k.item}$${k.parameter.slice(5)}` : k.item,
    op: k.parameter === 'loading' ? '=~' : p.model === 'gpcm' ? 'Steps' : '|', rhs: k.parameter === 'loading' ? k.item : p.model === 'gpcm' ? '' : 't1', est: k.est, se: k.se }));
  samePrinted(mine, want.estimates.filter((q) => q.se > 0), key, { tol: 0.002 });
}, 900_000);

it('ex5.18, ex5.19: twin ACE models whose outcomes load on several factors (an indicator in several CB-SEM factors) reproduce the Mplus output', async () => {
  evidence('ex5.18', 'CB-SEM', ['lavaan']);
  const r18 = await fitOf('ex5.18');
  sameFit(r18.fit, MPLUS['ex5.18'].fit);
  sameByGroup(r18, 'ex5.18');
  expect(r18.warnings).toEqual([]);
  // ex5.19: WLSMV; c is weakly determined (c² = 2cov(dz) − cov(mz)): 0.228 (SE 0.200) against Mplus's 0.229 (0.199),
  // as in example 5.22, the same model by constraints (stated on the card).
  evidence('ex5.19', 'CB-SEM', ['lavaan']);
  const r19 = await fitOf('ex5.19');
  scaledFit(r19, 'ex5.19', 0.002);
  sameByGroup(r19, 'ex5.19', { tol: 0.0015, seTol: 0.0015 });
  expect(r19.warnings).toEqual([]);
  const { cbScriptLavaan } = await import('../../rengine/lavaan');
  const s18 = await cbScriptLavaan(load('ex5.18'), toSpec(exampleModel(example('ex5.18'))), 'casewise', 'ML');
  for (const [f, l] of [['a1', 'la'], ['c1', 'lc'], ['e1', 'le']]) expect(s18).toContain(`${f} =~ NA*y1 + c(${l}, ${l})*y1`);
  expect(s18.match(/y1 ~~ 0\*y1/g)?.length).toBe(1);
}, 600_000);

it('ex5.23: the QTL sibling model, a covariance that depends on each pair’s pihat, on the custom likelihood card reproduces the Mplus output', async () => {
  evidence('ex5.23', 'Custom likelihood', ['stats']);
  const [r] = await runCards<CustomMlResult>('ex5.23');
  expect(r.converged).toBe(true);
  expect(r.warnings).toEqual([]);
  const want = MPLUS['ex5.23'];
  same('free parameters', r.fit.npar, want.fit.npar!);
  near('log-likelihood', r.fit.logLik, want.fit.logl!, 0.001);
  near('AIC', r.fit.aic, want.fit.aic!, 0.002);
  near('BIC', r.fit.bic, want.fit.bic!, 0.002);
  const part = (n: string) => r.parts.find((q) => q.name === n)!;
  for (const p of want.estimates) {
    if (p.lhs !== p.rhs && p.op === '~~') { expect(part('Covariance y1, y2').est).toBeNull(); continue; }  // (varies with pihat: Mplus prints 999)
    const q = p.op === '~1' ? part(`Mean ${p.lhs}`) : p.lhs.startsWith('y') ? part(`Variance ${p.lhs}`) : r.parameters.find((x) => x.name === p.lhs)!;
    near(`${p.lhs} ${p.op} ${p.rhs}`, q.est!, p.est, 0.001);
    near(`SE of ${p.lhs} ${p.op} ${p.rhs}`, q.se!, p.se, 0.001);
  }
}, 600_000);
