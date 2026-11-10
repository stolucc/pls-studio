// The sensitivity cards (SEMsens on the CB-SEM model, mediation::medsens on a simple mediation): options survive a
// project file, the paths and phantom targets a run uses, what each card still needs, and the views. (Their results
// against the packages in desktop R: src/examples/cards/sensitivity.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import type { MedsensResult, SemsensResult } from '../rengine/sensitivity';
import { medsensAnalysis, medsensInput, medsensText, MedsensView } from './medsens';
import { ANALYSIS_TYPES } from './registry';
import { modelPaths, semsensAnalysis, semsensArgs, semsensTargets, SemsensView } from './semsens';
import type { AnalysisCtx } from './types';

const k = (id: string, indicators: string[], covariate = false) => ({ id, name: id, type: 'factor', mode: 'A', indicators, x: 0, y: 0, side: 'left', ...(covariate ? { covariate } : {}) });
const cbModel = { constructs: [k('x', ['x1', 'x2', 'x3']), k('y', ['y1', 'y2', 'y3']), k('m', ['m'])], paths: [{ id: 'a', from: 'x', to: 'm' }, { id: 'b', from: 'm', to: 'y' }, { id: 'c', from: 'x', to: 'y' }], moderations: [] } as unknown as ModelState;
const cols = ['x1', 'x2', 'x3', 'y1', 'y2', 'y3', 'm', 'c1'];
const data = { names: cols, cols: cols.map((_, j) => Float64Array.from({ length: 50 }, (_, i) => Math.sin(i * (j + 1.3)) + (i % (j + 3)))) };
const cbCtx = { data, info: null, settings: { ...DEFAULT_SETTINGS, method: 'cbsem', engine: 'r', estimator: 'ML', seed: 3 }, pls: null, projectName: 'p', model: cbModel } as unknown as AnalysisCtx;
const medModel = { constructs: [k('x1', ['x1']), k('m', ['m']), k('y1', ['y1']), k('c1', ['c1'], true)], paths: [{ id: 'a', from: 'x1', to: 'm' }, { id: 'b', from: 'm', to: 'y1' }, { id: 'c', from: 'x1', to: 'y1' }], moderations: [] } as unknown as ModelState;
const medCtx = { ...cbCtx, settings: { ...DEFAULT_SETTINGS, method: 'process' }, model: medModel } as unknown as AnalysisCtx;
const ENGINE = { package: 'x', version: '1' };

describe('SEMsens card', () => {
  it('is in the Add menu under CB-SEM model and parses its options strictly', () => {
    expect(ANALYSIS_TYPES.find((t) => t.id === 'semsens')?.group).toBe('CB-SEM model');
    const d = semsensAnalysis.defaults(cbCtx);
    expect(semsensAnalysis.parseOptions(d)).toEqual(d);
    expect(semsensAnalysis.parseOptions(null)).toBeNull();
    expect(semsensAnalysis.parseOptions({ paths: [['x', 'm'], ['x'], 3], phantoms: ['x', 'x', 7], optFun: 9, k: '30', ants: 500, maxIter: 50, bound: 2, alpha: 0.05 }))
      .toEqual({ paths: [['x', 'm']], phantoms: ['x'], optFun: 4, k: 20, ants: 100, maxIter: 50, bound: 1, alpha: 0.05 });
  });
  it('uses every path and the constructs on them unless chosen; drops choices no longer in the model', () => {
    expect(modelPaths(cbModel)).toEqual([['x', 'm'], ['m', 'y'], ['x', 'y']]);
    const d = semsensAnalysis.defaults(cbCtx);
    expect(semsensTargets(d, cbModel)).toEqual({ paths: [['x', 'm'], ['m', 'y'], ['x', 'y']], phantoms: ['x', 'm', 'y'] });
    expect(semsensTargets({ ...d, paths: [['x', 'y'], ['y', 'x']], phantoms: ['gone'] }, cbModel)).toEqual({ paths: [['x', 'y']], phantoms: ['x', 'y'] });
    expect(semsensArgs(d, cbCtx)).toMatchObject({ seed: 3, optFun: 4 });
  });
  it('says what it still needs', () => {
    const d = semsensAnalysis.defaults(cbCtx);
    expect(semsensAnalysis.blocked(d, cbCtx)).toBeNull();
    expect(semsensAnalysis.blocked(d, { ...cbCtx, settings: { ...cbCtx.settings, method: 'pls' } })).toMatch(/CB-SEM/);
    expect(semsensAnalysis.blocked({ ...d, phantoms: ['x'] }, cbCtx)).toMatch(/2 to 9/);
    expect(semsensAnalysis.blocked({ ...d, maxIter: 5, k: 20 }, cbCtx)).toMatch(/archive size/);
    expect(semsensAnalysis.blocked(d, { ...cbCtx, settings: { ...cbCtx.settings, missing: 'mi' } })).toMatch(/multiple imputation/);
  });
  it('shows the ranges, the breakpoints and the chart', () => {
    const r: SemsensResult = {
      n: 100, optFun: 3, k: 5, ants: 10, maxIter: 10, bound: 1, alpha: 0.05, seed: 1, evaluations: 3, tried: 4, maxObjective: 0.16,
      phantoms: ['x', 'm', 'y'], interest: [{ from: 'x', to: 'y' }],
      summary: [{ from: 'x', to: 'y', values: [0.32, 0, 0.05, -0.45, 0.42] }], phantom: [{ construct: 'x', values: [0, -0.5, 0.5] }, { construct: 'm', values: [0, -0.5, 0.5] }, { construct: 'y', values: [0, -0.5, 0.5] }],
      atMin: [{ from: 'x', to: 'y', values: [-0.8, 0.3, -0.9] }], atMax: [{ from: 'x', to: 'y', values: [-0.6, -0.3, 0.2] }], flip: [{ from: 'x', to: 'y', values: [0, 0.1746, -0.55, 0.64, -0.34] }],
      draws: { path: [{ from: 'x', to: 'y', est: [0.3, -0.4, 0.1], p: [0, 0.01, 0.2] }], phantom: [[0.1, -0.8, 0.5], [0.2, 0.3, 0.6], [0.1, -0.9, -0.3]] }, warnings: [], engine: { ...ENGINE, lavaan: '0.7' },
    };
    const html = renderToStaticMarkup(<SemsensView r={r} />);
    expect(html).toContain('Where significance flips');
    expect(html).toContain('0.175');
    expect(html).toContain('<svg');
    expect(html).toContain('Phantom → x × phantom → y');
  });
});

describe('Mediation sensitivity card', () => {
  it('parses its options strictly', () => {
    expect(medsensAnalysis.parseOptions({ rhoBy: 0.3, eps: 'x' })).toEqual({ rhoBy: 0.01, eps: 1e-8 });
    expect(medsensAnalysis.parseOptions({ rhoBy: 0.1, eps: 0.01 })).toEqual({ rhoBy: 0.1, eps: 0.01 });
  });
  it('takes the simple mediation of a conditional process model, with its covariates', () => {
    const o = medsensAnalysis.defaults(medCtx);
    expect(medsensInput(o, medCtx)).toMatchObject({ x: 'x1', m: 'm', y: 'y1', covariates: ['c1'], rhoBy: 0.01 });
    expect(medsensAnalysis.blocked(o, medCtx)).toBeNull();
    expect(medsensAnalysis.blocked(o, cbCtx)).toMatch(/conditional process/);
    const two = { ...medModel, constructs: [...medModel.constructs, k('m2', ['x2'])], paths: [...medModel.paths, { id: 'd', from: 'x1', to: 'm2' }, { id: 'e', from: 'm2', to: 'y1' }] } as unknown as ModelState;
    expect(medsensAnalysis.blocked(o, { ...medCtx, model: two })).toMatch(/one mediator/);
    expect(medsensAnalysis.fingerprint(o, medCtx)).not.toBe(medsensAnalysis.fingerprint({ ...o, rhoBy: 0.1 }, medCtx));
  });
  it('reads the breakpoint and draws the curves', () => {
    const rho = [-0.5, 0, 0.5];
    const r: MedsensResult = {
      n: 899, rhoBy: 0.5, eps: 0.01, confidence: 0.95, x: 'treat', m: 'job_seek', y: 'depress2', covariates: ['age'], a: 0.06, b: -0.24, r2m: 0.01, r2y: 0.12,
      rho, acme: { est: [0.01, -0.016, -0.05], lo: [-0.01, -0.04, -0.09], hi: [0.03, 0.004, -0.01] }, ade: { est: [-0.07, -0.04, -0.01], lo: [-0.17, -0.12, -0.1], hi: [0.02, 0.04, 0.09] },
      r2starProd: [0.25, 0, 0.25], r2tildeProd: [0.22, 0, 0.22], acmeZero: { rho: -0.3, r2star: 0.09, r2tilde: 0.078 }, adeZero: { rho: null, r2star: null, r2tilde: null },
      printed: [], warnings: [], engine: ENGINE,
    };
    expect(medsensText(r)).toMatch(/is zero at ρ = −?-?0\.30.*9\.0%.*R²\*_M R²\*_Y = 0\.090/);
    const html = renderToStaticMarkup(<MedsensView r={r} />);
    expect(html).toContain('Where the effects are zero');
    expect(html).toContain('none in (−1, 1)');
    expect((html.match(/aria-label="[^"]* by rho"/g) ?? []).length).toBe(2);
  });
});
