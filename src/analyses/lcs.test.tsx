// The Latent change score card: options survive a project file, the card says what it still needs, the input it
// sends, the parameters in LCS terms and the view. (Its results against lcsm run natively:
// src/examples/cards/lcs.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { lcsRequest, type LcsInput, type LcsResult } from '../rengine/longitudinal';
import { lcsAnalysis, lcsInput, lcsName, LcsResultView, lcsRows } from './lcs';
import { ANALYSIS_TYPES } from './registry';
import type { AnalysisCtx } from './types';

const cols = ['anx_1', 'anx_2', 'anx_3', 'dep_1', 'dep_2', 'dep_3', 'other'];
const data = { names: cols, cols: cols.map((_, k) => new Float64Array([1, 2, 3, 4].map((v) => v + k))) };
const ctx = { data, info: null, settings: { ...DEFAULT_SETTINGS, estimator: 'MLR', missing: 'fiml' }, pls: null, projectName: 'p' } as unknown as AnalysisCtx;
const est = (label: string, v: number) => ({ label, lhs: '', op: '', rhs: '', est: v, se: 0.1, z: v / 0.1, p: 0.01, std: v / 2 });

describe('latent change score card', () => {
  it('is in the Add menu under Longitudinal', () => {
    expect(ANALYSIS_TYPES.find((t) => t.id === 'lcs')?.group).toBe('Longitudinal');
  });
  it('parses its options from a file, replacing invalid values', () => {
    const d = lcsAnalysis.defaults(ctx);
    expect(lcsAnalysis.parseOptions(d)).toEqual(d);
    expect(lcsAnalysis.parseOptions(null)).toBeNull();
    expect(lcsAnalysis.parseOptions({ x: ['a', 3, 'b', 'c'], y: 'nope', modelX: { constant: 'yes', proportional: true }, coupling: { deltaXY: 1, xiYX: true } }))
      .toEqual({ x: ['a', 'b', 'c'], y: [], modelX: { constant: false, proportional: true, autoregressive: false }, modelY: { constant: true, proportional: true, autoregressive: false }, coupling: { deltaXY: false, deltaYX: false, xiXY: false, xiYX: true } });
  });
  it('says what it still needs, and sends the Model settings’ estimator (coupling only with a second variable)', () => {
    const o = { ...lcsAnalysis.defaults(ctx), x: ['anx_1', 'anx_2', 'anx_3'] };
    expect(lcsAnalysis.blocked(o, ctx)).toBeNull();
    expect(lcsAnalysis.blocked({ ...o, x: ['anx_1', 'anx_2'] }, ctx)).toMatch(/three or more/);
    expect(lcsAnalysis.blocked({ ...o, y: ['dep_1', 'dep_2'] }, ctx)).toMatch(/same number/);
    expect(lcsAnalysis.blocked({ ...o, x: ['anx_1', 'anx_2', 'gone'] }, ctx)).toMatch(/gone/);
    const i = lcsInput(o, ctx);
    expect(i).toMatchObject({ estimator: 'MLR', missing: 'fiml', coupling: { deltaXY: false, deltaYX: false, xiXY: false, xiYX: false } });
    expect(lcsInput({ ...o, y: ['dep_1', 'dep_2', 'dep_3'] }, ctx).coupling).toEqual(o.coupling);
    const req = lcsRequest(data, { ...i, y: ['dep_1', 'dep_2', 'dep_3'] });
    expect(req.data.names).toEqual(['anx_1', 'anx_2', 'anx_3', 'dep_1', 'dep_2', 'dep_3']);
    // (the coupling and the second variable's components change the fingerprint only in a bivariate model)
    const f = lcsAnalysis.fingerprint(o, ctx);
    expect(lcsAnalysis.fingerprint({ ...o, coupling: { ...o.coupling, xiXY: true } }, ctx)).toBe(f);
    expect(lcsAnalysis.fingerprint({ ...o, modelX: { ...o.modelX, autoregressive: true } }, ctx)).not.toBe(f);
    expect(lcsAnalysis.summary(o)).toBe('3 occasions · αβ');
    expect(lcsAnalysis.summary({ ...o, y: ['dep_1', 'dep_2', 'dep_3'] })).toBe('bivariate · 3 occasions · αβ / αβ · δXY, δYX');
  });
  it('names the variables from their columns, and reports the parameters in LCS terms', () => {
    expect(lcsName(['anx_1', 'anx_2'], 'X')).toBe('anx');
    expect(lcsName(['T1'], 'X')).toBe('X');
    expect(lcsName(['wave2'], 'X')).toBe('X');
    expect(lcsName(['score t1'], 'X')).toBe('score');
    expect(lcsName([], 'Y')).toBe('Y');
    const r: LcsResult & { input: LcsInput } = {
      n: 200, occasions: 3, bivariate: true, x: ['anx_1', 'anx_2', 'anx_3'], y: ['dep_1', 'dep_2', 'dep_3'], fit: { chisq: 3.2, df: 4, cfi: 1, rmsea: 0, srmr: 0.01 },
      estimates: [est('gamma_lx1', 2), est('alpha_g2', 0.5), est('beta_x', -0.2), est('alpha_j2', 0.1), est('delta_lag_xy', 0.3), est('sigma_ly1lx1', 0.4), est('sigma2_ux', 0.6)],
      impliedMeans: { x: [2, 2.1, 2.2], y: [1, 1.1, 1.15] }, observedMeans: { x: [2, 2.1, 2.25], y: [1, 1.05, 1.2] }, warnings: [], engine: { package: 'lavaan', version: '0.7.3' },
      input: { x: [], y: [], modelX: { constant: true, proportional: true, autoregressive: false }, modelY: { constant: true, proportional: false, autoregressive: false }, coupling: { deltaXY: true, deltaYX: false, xiXY: false, xiYX: false }, estimator: 'MLR', missing: 'fiml' },
    };
    const t = lcsRows(r);
    expect(t.map((x) => x.title)).toEqual(['Change components', 'Coupling between the variables', 'Covariances between the variables']);
    expect(t[0].rows.map(([w, e]) => `${w}=${e.est}`)).toEqual(['anx: initial true score, mean=2', 'anx: constant change, mean (α)=0.5', 'anx: proportional change (β), change on the previous true score=-0.2', 'anx: residual variance (each occasion)=0.6', 'dep: constant change, mean (α)=0.1']);
    expect(t[1].rows[0][0]).toBe('dep (true score, t−1) → change in anx (δ)');
    const html = renderToStaticMarkup(<LcsResultView r={r} />);
    expect(html).toContain('Bivariate latent change score model, 3 occasions, N = 200: anx and dep');
    expect(html).toContain('Robust SE');
    expect(html).toContain('alpha_g2');
    expect(html).toContain('Mean trajectories');
    expect(lcsRows({ ...r, bivariate: false, estimates: [est('gamma_lx1', 2)] }).map((x) => x.title)).toEqual(['Change components']);
  });
});
