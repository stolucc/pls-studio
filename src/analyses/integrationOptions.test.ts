// The GLMM and IRT cards' option of Mplus's integration rule (rengine/glmmMplus.ts, rengine/irtMplus.ts): saved cards
// without it are read as before, the model written in Mplus's syntax, what is refused, and the results mapped back.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { glmmFromQuad, glmmMplusBlocked, glmmMplusSyntax } from '../rengine/glmmMplus';
import { irtFromQuad, irtMplusBlocked, irtMplusSyntax } from '../rengine/irtMplus';
import type { QuadResult } from '../rengine/quadml';
import { glmmAnalysis } from './glmm';
import { irtAnalysis, irtFit } from './items';
import { buildQuad } from './quadmlSyntax';
import type { AnalysisCtx } from './types';

const n = 30;
const seq = (f: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => f(i));
const data = { names: ['u11', 'u12', 'u13', 'u14', 'x', 'bad name'], cols: [seq((i) => i % 3), seq((i) => (i * 2) % 5), seq((i) => i % 2), seq((i) => (i % 4 === 0 ? 0 : i % 6)), seq((i) => (i % 5) / 2), seq((i) => i % 2)] };
const ctx: AnalysisCtx = { data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p' };
const GLMM = { layout: 'wide' as const, outcome: '', cluster: '', occasions: ['u11', 'u12', 'u13', 'u14'], times: [0, 1, 2, 3], predictors: [], categorical: [], slopes: [], family: 'zip' as const, ziPredictors: ['time'], ziRandom: true, quadrature: 7, robust: true };

describe('GLMM card: Mplus’s integration rule', () => {
  it('reads saved cards without the option as before, and keeps it when set', () => {
    const old = glmmAnalysis.parseOptions({ ...GLMM })!;
    expect(old.integration).toBeUndefined();
    expect(glmmAnalysis.fingerprint(old, ctx)).toBe(glmmAnalysis.fingerprint({ ...old }, ctx));
    expect(glmmAnalysis.parseOptions({ ...GLMM, integration: 'mplus' })!.integration).toBe('mplus');
    expect(glmmAnalysis.parseOptions({ ...GLMM, integration: 'other' })!.integration).toBeUndefined();
    expect(glmmAnalysis.fingerprint({ ...old, integration: 'mplus' }, ctx)).not.toBe(glmmAnalysis.fingerprint(old, ctx));
  });
  it('writes Mplus’s growth model (6.7) and fits what Mplus fits', () => {
    const syn = glmmMplusSyntax(GLMM);
    expect(syn).toContain('COUNT = u11 u12 u13 u14 (i);');
    expect(syn).toContain('INTEGRATION = 7;');
    expect(syn).toContain('i s | u11@0 u12@1 u13@2 u14@3;');
    expect(syn).toContain('ii si | u11#1@0 u12#1@1 u13#1@2 u14#1@3;');
    expect(syn).toContain('s@0;');
    expect(syn).not.toContain('ii@0');
    // 7 free parameters as in Mplus (i, s, si means; u#1; i and ii variances and covariance)
    expect(buildQuad(syn, data).spec.theta).toHaveLength(7);
    expect(buildQuad(glmmMplusSyntax({ ...GLMM, family: 'poisson', slopes: ['time'], quadrature: 15 }), data).spec.theta).toHaveLength(5);
  });
  it('says what it does not fit', () => {
    expect(glmmMplusBlocked({ ...GLMM, layout: 'long' })).toContain('wide data');
    expect(glmmMplusBlocked({ ...GLMM, family: 'binomial' })).toContain('Poisson');
    expect(glmmMplusBlocked({ ...GLMM, occasions: ['bad name', 'u12'] })).toContain('column names');
    expect(glmmMplusBlocked(GLMM)).toBeNull();
    expect(glmmAnalysis.blocked({ ...GLMM, layout: 'long', outcome: 'u11', cluster: 'x', integration: 'mplus' }, ctx)).toContain('wide data');
    expect(glmmAnalysis.blocked({ ...GLMM, integration: 'mplus' }, ctx)).toBeNull();
  });
  it('shows the growth factors as the GLMM’s random effects', () => {
    const p = (lhs: string, op: string, rhs: string, est: number, fixed = false) => ({ lhs, op, rhs, est, se: fixed ? 0 : 0.1, fixed });
    const r = { n: 500, logLik: -2778.14, npar: 7, aic: 5570.28, bic: 5599.78, converged: true, theta: [], dims: 2, se: 'mlr', integration: { type: 'rect', points: 7, adaptive: true },
      params: [p('i', '~1', '', 0.346), p('s', '~1', '', -0.048), p('si', '~1', '', -0.484), p('u11#1', '~1', '', -0.162), p('i', '~~', 'i', 0.386), p('ii', '~~', 'ii', 1.189), p('ii', '~~', 'i', -0.203), p('s', '~~', 's', 0, true)],
      warnings: [], engine: { package: 'R', version: '4.5' } } as QuadResult;
    const g = glmmFromQuad(GLMM, r, 2000);
    expect(g.fixed.map((f) => [f.term, f.est])).toEqual([['Intercept', 0.346], ['time', -0.048]]);
    expect(g.zero!.map((f) => [f.term, f.est])).toEqual([['Intercept', -0.162], ['time', -0.484]]);
    expect(g.random).toEqual([expect.objectContaining({ a: 'Intercept', zeroA: false, est: 0.386 }), expect.objectContaining({ a: 'Intercept', zeroA: true, est: 1.189 }), expect.objectContaining({ a: 'Intercept', b: 'Intercept', zeroB: true, est: -0.203 })]);
    expect(g).toMatchObject({ n: 2000, clusters: 500, integration: 'mplus', logLik: -2778.14 });
  });
});

describe('IRT card: Mplus’s integration rule', () => {
  const items = ['u11', 'u12', 'u13'];
  it('reads saved cards without the option as before', () => {
    const o = irtAnalysis.parseOptions({ items, model: 'fourpl', priorG: [-1.386, 1], priorU: [2, 1], robust: true })!;
    expect(o.integration).toBeUndefined();
    expect(irtAnalysis.parseOptions({ ...o, integration: 'mplus' })!.integration).toBe('mplus');
  });
  it('writes the 4PL with Mplus’s priors (on u$2 = −logit(g) and u$3 = −logit(u))', () => {
    const syn = irtMplusSyntax(items, 'fourpl', irtFit({ items, model: 'fourpl', priorG: [-1.386, 1], priorU: [2, 1], robust: true }, 1));
    expect(syn).toContain('CATEGORICAL = u11 u12 u13 (4pl);');
    expect(syn).toContain('f BY u11* u12 u13;');
    // (20 items: loadings, thresholds and guessing thresholds, 60 as in Mplus)
    const twenty = Array.from({ length: 20 }, (_, i) => `u${i + 1}`);
    const d20 = { names: twenty, cols: twenty.map((_, j) => Float64Array.from({ length: 40 }, (_, i) => ((i + j) % 3 === 0 ? 1 : 0))) };
    expect(buildQuad(irtMplusSyntax(twenty, 'threepl', { priorG: [-1.386, 1] }), d20).spec.theta).toHaveLength(60);
    expect(syn).toContain('[u13$3] (qu3);');
    expect(syn).toContain('qg1 ~ N(1.386, 1);');
    expect(syn).toContain('qu3 ~ N(-2, 1);');
    expect(syn).toContain('ESTIMATOR = MLR;');
    expect(irtMplusSyntax(items, 'threepl', { guessItems: ['u12'] })).toContain('CATEGORICAL = u11 u13;\nCATEGORICAL = u12 (3pl);');
  });
  it('says what it does not fit', () => {
    expect(irtMplusBlocked(items, 'grm', {})).toContain('2PL, 3PL and 4PL');
    expect(irtMplusBlocked(['bad name', 'u11'], 'twopl', {})).toContain('column names');
    expect(irtAnalysis.blocked({ items, model: 'mixture', integration: 'mplus' }, ctx)).toContain('2PL, 3PL and 4PL');
  });
  it('maps the result to the card’s parameterisations', () => {
    const p = (lhs: string, op: string, rhs: string, est: number) => ({ lhs, op, rhs, est, se: 0.1, fixed: false });
    const r = { n: 1000, logLik: -110, logPrior: -10, npar: 3, aic: 0, bic: 0, converged: true, theta: [], dims: 1, se: 'mlr', integration: { type: 'rect', points: 15, adaptive: true },
      params: [p('f', '=~', 'u11', 2), p('u11', '|', 't1', 1), p('u11', '|', 't2', Math.log(4))], warnings: [], engine: { package: 'R', version: '4.5' } } as QuadResult;
    const out = irtFromQuad(['u11'], 'threepl', r);
    expect(out.logLik).toBe(-100);
    expect(out.logPrior).toBe(-10);
    expect(out.params[0].values).toEqual({ Dscrmn: 2, Dffclt: 0.5, Gussng: 0.2 });
    expect(out.coefficients!.map((c) => c.parameter)).toEqual(['loading', 'threshold 1', 'threshold 2 (lower asymptote)']);
    expect(out.information[0]).toHaveLength(81);
  });
});
