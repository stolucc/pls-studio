// Count indicators drawn on the canvas, estimated by the integration engine (model/countModel.ts → the Integration
// ML card on the diagram): Mplus ex. 6.6 (a linear growth model for Poisson counts) drawn as two factors with fixed
// loadings reproduces the Mplus output; and the engine's zero-inflated counts, with their inflation regressed on
// covariates (u#1 ON x), reproduce pscl::zeroinfl natively (scripts/validation/zeroinfl.R). Run with WEBR_TESTS=1.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { quadAnalysis as quad } from '../analyses/quadml';
import type { AnalysisCtx } from '../analyses/types';
import type { Dataset } from '../engine/types';
import { load, MPLUS, samePrinted, type Mine } from '../examples/mplus/testkit';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { near } from '../validation/record';
import { rCall } from './bridge';
import type { QuadResult } from './quadml';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const U = ['u11', 'u12', 'u13', 'u14'];
const C = (id: string, indicators: string[], fixedLoadings: Record<string, number>) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators, x: 0, y: 0, side: 'left' as const, fixedLoadings });
/** Mplus ex. 6.6 on the canvas: i (loadings 1) and s (0, 1, 2, 3) on the Poisson counts, free means, intercepts held at 0, i with s. */
const growth: ModelState = {
  constructs: [C('i', U, { u11: 1, u12: 1, u13: 1, u14: 1 }), C('s', U, { u11: 0, u12: 1, u13: 2, u14: 3 })],
  paths: [], moderations: [], correlations: [{ id: 'k', kind: 'construct', a: 'i', b: 's' }],
  constant: { x: 0, y: 0 }, means: [{ id: 'm1', target: 'i' }, { id: 'm2', target: 's' }],
  parameters: U.map((u) => ({ id: `p${u}`, kind: 'intercept' as const, target: u, indicator: true, fixed: 0 })),
  count: Object.fromEntries(U.map((u) => [u, 'poisson' as const])),
};
const ctx = (data: Dataset, model: ModelState): AnalysisCtx => ({ data, info: null, settings: { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'MLR', missing: 'fiml' }, pls: null, projectName: 'p', model });

it('Mplus ex. 6.6 drawn on the canvas with count indicators: the integration card on the diagram reproduces the Mplus output', async () => {
  const data = load('ex6.6');
  const o = { syntax: '', source: 'model' as const };
  const c = ctx(data, growth);
  expect(quad.blocked(o, c)).toBeNull();
  const r = await quad.run(o, c, () => {}) as QuadResult & { fromModel?: boolean };
  const want = MPLUS['ex6.6'];
  expect(r.converged).toBe(true);
  expect(r.fromModel).toBe(true);
  expect(r.npar).toBe(want.fit.npar);
  near('log-likelihood', r.logLik, want.fit.logl!, 0.002);
  near('AIC', r.aic, want.fit.aic!, 0.004);
  near('BIC', r.bic, want.fit.bic!, 0.004);
  const mine: Mine[] = r.params.map((p) => ({ lhs: p.lhs, op: p.op, rhs: p.rhs, est: p.est, se: p.se }));
  samePrinted(mine, want.estimates, 'ex6.6 on the canvas', { tol: 0.001, seTol: 0.001 });
  expect(r.se).toBe('mlr');
  expect(r.warnings).toEqual([]);
}, 900_000);

type PsclRef = { coefficients: { term: string; est: number; se: number }[]; logLik: number; npar: number; theta?: number };
const pscl = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'regression', 'pscl.json'), 'utf8')) as Record<string, PsclRef>;

it.each([['zinb2', 'nbi'], ['zip2', 'i']])('the engine’s zero-inflated counts (COUNT = art (%s), art#1 ON …) reproduce pscl::zeroinfl', async (key, code) => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'pscl', name: 'bioChemists', na: [] }, 'pscl');
  const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  const x = 'fem mar kid5 phd ment';
  const syntax = `COUNT = art (${code});\nANALYSIS: ESTIMATOR = ML;\nMODEL:\nart ON ${x};\nart#1 ON ${x};`;
  const c: AnalysisCtx = { data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p' };
  expect(quad.blocked({ syntax }, c)).toBeNull();
  const r = await quad.run({ syntax }, c, () => {}) as QuadResult;
  const want = pscl[key];
  expect(r.converged).toBe(true);
  expect(r.dims).toBe(0);
  expect(r.npar).toBe(want.npar);
  near('log-likelihood', r.logLik, want.logLik, 1e-6);
  const ref = (t: string) => want.coefficients.find((k) => k.term === t)!;
  // (fem and mar are coded 1, 2 here, 0/1 dummies in pscl: the same slopes; the intercepts differ by their sum)
  // (estimates and SEs within 1e-5: pscl stops at its default reltol, about 3e-6 from the maximum; the log-likelihood within 1e-6)
  const terms: [string, string][] = [['fem', 'femWomen'], ['mar', 'marMarried'], ['kid5', 'kid5'], ['phd', 'phd'], ['ment', 'ment']];
  for (const [part, lhs] of [['count', 'art'], ['zero', 'art#1']] as const) {
    for (const [mine, theirs] of terms) {
      const p = r.params.find((q) => q.op === '~' && q.lhs === lhs && q.rhs === mine)!;
      expect(p, `${lhs} ON ${mine}`).toBeTruthy();
      near(`${lhs} ON ${mine}`, p.est, ref(`${part}_${theirs}`).est, 1e-5);
      near(`SE of ${lhs} ON ${mine}`, p.se!, ref(`${part}_${theirs}`).se, 1e-5);
    }
    const icpt = r.params.find((q) => q.op === '~1' && q.lhs === lhs)!;
    near(`${lhs} intercept`, icpt.est, ref(`${part}_(Intercept)`).est - ref(`${part}_femWomen`).est - ref(`${part}_marMarried`).est, 1e-5);
  }
  if (want.theta !== undefined) near('θ = 1 / dispersion', 1 / r.params.find((q) => q.op === 'dispersion')!.est, want.theta, 1e-5);
  expect(r.warnings).toEqual([]);
}, 900_000);
