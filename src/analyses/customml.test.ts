import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { DEFAULT_SETTINGS } from '../model/project';
import { bmvregAnalysis as bt, customMlAnalysis as t } from './customml';
import { readLevels, twoLevelEfaAnalysis as et } from './twolevelefa';
import { customMlColumns, customMlNames } from '../rengine/customml';
import type { AnalysisCtx } from './types';

const col = (n: number) => Float64Array.from({ length: 20 }, (_, i) => (i * (n + 1)) % 5);
const data = { names: ['y1', 'y2', 'pihat', 'u', 'g', 'my col'], cols: [0, 1, 2, 3, 4, 5].map(col) };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p', ...over });
const qtl = { type: 'normal' as const, outcomes: ['y1', 'y2'], parameters: [{ name: 'mu', start: 0 }, { name: 'a', start: 1 }, { name: 'q', start: 1 }], logits: [], means: ['mu', 'mu'],
  variances: ['a^2 + q^2', 'a^2 + q^2'], covariances: ['0.5*a^2 + pihat*q^2'], defined: [{ name: 'h', expr: 'a^2/(a^2 + q^2)' }], se: 'model' as const };

describe('custom likelihood card', () => {
  it('reads options from files and keeps a valid preset unchanged', () => {
    expect(t.parseOptions(null)).toBeNull();
    expect(t.parseOptions(qtl)).toEqual(qtl);
    const p = t.parseOptions({ type: 'evil', outcomes: ['y1', 'y1', 3], parameters: [{ name: 'a', start: 'x' }, 'no'], se: 'HC9' })!;
    expect(p).toMatchObject({ type: 'normal', outcomes: ['y1'], parameters: [{ name: 'a', start: 0 }], se: 'model' });
    // (Mplus's information under constraints is kept; a file saved before it reads as it was)
    expect(t.parseOptions({ ...qtl, se: 'mplus' })!.se).toBe('mplus');
    expect(t.parseOptions({ ...qtl, se: 'robust' })!.se).toBe('robust');
  });

  it('checks expressions: functions exp, log and sqrt; parameters and data columns only', () => {
    expect(customMlNames('log((exp(p1) - 1)/2 - 1)')).toEqual(['p1']);
    expect(customMlNames('0.5*a^2 + pihat*q^2').sort()).toEqual(['a', 'pihat', 'q']);
    expect(() => customMlNames('system("ls")')).toThrow();
    expect(() => customMlNames('a; b')).toThrow();
    expect(customMlColumns(qtl, data.names)).toEqual(['y1', 'y2', 'pihat']);
  });

  it('says why it cannot run', () => {
    expect(t.blocked(qtl, ctx())).toBeNull();
    expect(t.blocked({ ...qtl, outcomes: [] }, ctx())).toBe('Choose the outcome(s).');
    expect(t.blocked({ ...qtl, outcomes: ['zz'] }, ctx())).toBe('Not in the data: zz.');
    expect(t.blocked(qtl, ctx({ data: null }))).toContain('needs raw data');
    expect(t.blocked({ ...qtl, parameters: [] }, ctx())).toContain('at least one parameter');
    expect(t.blocked({ ...qtl, parameters: [{ name: 'a', start: 0 }, { name: 'a', start: 1 }] }, ctx())).toContain('own name');
    expect(t.blocked({ ...qtl, parameters: [{ name: 'function', start: 0 }] }, ctx())).toContain('reserved');
    expect(t.blocked({ ...qtl, means: ['mu', 'mu + zz'] }, ctx())).toContain('zz is neither a parameter nor a data column');
    expect(t.blocked({ ...qtl, means: ['mu', 'Sys.time()'] }, ctx())).toMatch(/^The mean of y2: /);
    expect(t.blocked({ ...qtl, means: ['mu', ''] }, ctx())).toContain('a mean and a variance');
    expect(t.blocked({ ...qtl, defined: [{ name: 'pihat', expr: 'a' }] }, ctx())).toContain('name of its own');
    expect(t.blocked({ ...qtl, defined: [{ name: 'h', expr: 'a + pihat' }] }, ctx())).toContain('is not a parameter');
    expect(t.blocked({ ...qtl, type: 'nominal', outcomes: ['u'], logits: [] }, ctx())).toContain('logit of each category');
    expect(t.blocked({ ...qtl, type: 'nominal', outcomes: ['y1', 'y2'] }, ctx())).toBe('A nominal model has one outcome.');
    expect(t.blocked({ ...qtl, type: 'probit', outcomes: ['y1', 'y2', 'u'] }, ctx())).toContain('one or two binary outcomes');
  });

  it('fingerprints the outcomes and the columns its expressions use', () => {
    const f = t.fingerprint(qtl, ctx());
    expect(f).toBeTruthy();
    expect(t.fingerprint(qtl, ctx({ data: { ...data, cols: data.cols.map((c, k) => (k === 3 ? Float64Array.from(c, () => 9) : c)) } }))).toBe(f);
    expect(t.fingerprint(qtl, ctx({ data: { ...data, cols: data.cols.map((c, k) => (k === 2 ? Float64Array.from(c, () => 9) : c)) } }))).not.toBe(f);
  });

  it('shows its results: parameters, the model’s parts (none for a part that varies by case) and defined parameters', () => {
    const r = { type: 'normal' as const, outcomes: ['y1', 'y2'], n: 20, converged: true, se: 'model' as const, categories: null, warnings: [], engine: { package: 'R', version: '4' },
      parameters: [{ name: 'mu', est: 0.1, se: 0.02, start: 0 }], parts: [{ name: 'Mean y1', kind: 'part' as const, est: 0.1, se: 0.02, expr: 'mu' }, { name: 'Covariance y1, y2', kind: 'part' as const, est: null, se: null, expr: 'pihat*q^2' }],
      defined: [{ name: 'h', kind: 'defined' as const, est: 0.5, se: 0.1, expr: 'a^2/(a^2 + q^2)' }], fit: { logLik: -10.5, npar: 3, aic: 27, bic: 30 } };
    const html = renderToStaticMarkup(createElement(t.View, { result: r, options: qtl, current: true }));
    expect(html).toContain('The model’s parts');
    expect(html).toContain('Defined parameters');
    expect(html).toContain('pihat*q^2');
  });
});

describe('Bayesian multivariate regression card', () => {
  const o = { outcomes: ['y1', 'y2'], predictors: ['u'], draws: 50000, seed: 1 };
  it('reads options and says why it cannot run', () => {
    expect(bt.parseOptions({ outcomes: ['y1'], predictors: [], draws: 5, seed: -3 })).toEqual({ outcomes: ['y1'], predictors: [], draws: 1000, seed: 1 });
    expect(bt.blocked(o, ctx())).toBeNull();
    expect(bt.blocked({ ...o, outcomes: [] }, ctx())).toBe('Choose the outcomes.');
    expect(bt.blocked({ ...o, predictors: ['y1'] }, ctx())).toContain('both an outcome and a predictor');
    expect(bt.blocked({ ...o, predictors: ['zz'] }, ctx())).toBe('Not in the data: zz.');
  });
});

describe('two-level EFA card', () => {
  const o = { items: ['y1', 'y2', 'pihat', 'u', 'my col'], cluster: 'g', within: [1, 2] as (number | 'U')[], between: [1, 'U'] as (number | 'U')[] };
  it('reads the numbers of factors (U: unrestricted)', () => {
    expect(readLevels('1 2 U u 9 x 2')).toEqual([1, 2, 'U']);
    expect(et.parseOptions({ items: ['a'], cluster: 'g', within: [1, '2', 'U', 'evil'], between: 'no' })).toEqual({ items: ['a'], cluster: 'g', within: [1, 2, 'U'], between: [] });
    expect(et.parseOptions(o)).toEqual(o);
  });
  it('says why it cannot run', () => {
    expect(et.blocked(o, ctx())).toBeNull();
    expect(et.blocked({ ...o, cluster: '' }, ctx())).toBe('Choose the cluster column.');
    expect(et.blocked({ ...o, items: ['y1', 'y2'] }, ctx())).toBe('Choose at least three items.');
    expect(et.blocked({ ...o, within: ['U'], between: ['U'] }, ctx())).toContain('saturated');
    expect(et.blocked({ ...o, within: [3] }, ctx())).toBe('3 factors are too many for 5 items.');
    expect(et.blocked({ ...o, items: [...o.items.slice(0, 4), 'g'] }, ctx())).toBe('The cluster column cannot be an item.');
  });
});
