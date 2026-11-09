import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import type { QuadResult } from '../rengine/quadml';
import { quadAnalysis as quad } from './quadml';
import { buildQuad, quadColumns } from './quadmlSyntax';
import type { AnalysisCtx } from './types';

const n = 60;
const seq = (f: (i: number) => number) => Float64Array.from({ length: n }, (_, i) => f(i));
const names = ['u1', 'u2', 'u3', 'u4', 'c1', 'c2', 'c3', 'y1', 'y2', 'y3', 'y4', 'x', 't', 'tc', 'm'];
const data = {
  names,
  cols: [
    seq((i) => i % 2), seq((i) => (i >> 1) % 2), seq((i) => (i % 3 === 0 ? 1 : 0)), seq((i) => (i % 5 < 2 ? 1 : 0)),
    seq((i) => i % 4), seq((i) => (i % 6 === 0 ? 0 : i % 3)), seq((i) => (i * 7) % 5),
    seq((i) => Math.max(0, (i % 7) - 2 + (i % 3) * 0.5)), seq((i) => Math.max(0, (i % 5) - 1.5 + (i % 4) * 0.3)), seq((i) => Math.max(0, (i % 9) * 0.4 - 1)), seq((i) => Math.max(0, (i % 6) * 0.7 - 1.2)),
    seq((i) => (i % 5) / 2 - 1), seq((i) => 1 + (i % 11) * 1.7), seq((i) => (i % 4 === 0 ? 1 : 0)), seq((i) => (i % 8 === 0 ? NaN : (i % 7) * 0.3)),
  ],
};
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p', ...over });
const spec = (syntax: string) => buildQuad(syntax, data);
const free = (s: string) => spec(s).spec.theta.length;

describe('integration card: options', () => {
  it('reads options from files; anything else is dropped (saved cards keep their syntax)', () => {
    expect(quad.parseOptions({ syntax: 'MODEL: f BY u1-u4;', starts: 3 })).toEqual({ syntax: 'MODEL: f BY u1-u4;' });
    expect(quad.parseOptions({ syntax: 5 })).toEqual({ syntax: '' });
    expect(quad.parseOptions(null)).toBeNull();
    expect(quad.defaults(ctx())).toEqual({ syntax: '' });
  });

  it('says why it cannot run', () => {
    expect(quad.blocked({ syntax: '' }, ctx())).toBe('Write the model (Mplus syntax).');
    expect(quad.blocked({ syntax: 'CATEGORICAL = u1-u4; MODEL: f BY u1-u4;' }, ctx({ data: null }))).toBe('Import raw data first.');
    expect(quad.blocked({ syntax: 'f BY u1-u4;' }, ctx())).toContain('MODEL:');
    expect(quad.blocked({ syntax: 'CATEGORICAL = u1-u4; MODEL: f BY u1-zz;' }, ctx())).toContain('u1-zz');
    expect(quad.blocked({ syntax: 'CATEGORICAL = u1-u4; MODEL: f BY u1-u4 zz;' }, ctx())).toContain('zz is not a column');
    expect(quad.blocked({ syntax: 'TYPE = MIXTURE; CATEGORICAL = u1-u4; MODEL: f BY u1-u4;' }, ctx())).toContain('TYPE = MIXTURE');
    expect(quad.blocked({ syntax: 'CATEGORICAL = u1-u4; MODEL: f BY u1-u4; u1 WITH u2;' }, ctx())).toContain('conditionally independent');
    expect(quad.blocked({ syntax: 'CATEGORICAL = u1-u4; MODEL: f BY u1-u4; y1 ON u1;' }, ctx())).toContain('regressions on censored, count, categorical');
    expect(quad.blocked({ syntax: 'CENSORED = y1 (x); MODEL: f BY y1-y3;' }, ctx())).toContain('censoring from above');
    expect(quad.blocked({ syntax: 'DATA TWOPART: NAMES = y1-y4; VARIABLE: CATEGORICAL = u1-u4; MODEL: f BY u1-u4;' }, ctx())).toContain('computed columns');
    expect(quad.blocked({ syntax: 'CATEGORICAL = u1-u4; INTEGRATION = 101; MODEL: f BY u1-u4;' }, ctx())).toContain('between 1 and 100');
    expect(quad.blocked({ syntax: 'CATEGORICAL = u1-u4; MODEL: f1 BY u1-u2; f2 BY u3-u4; f3 BY c1-c2; f4 BY c3 y1; f5 BY y2 y3; COUNT = c1-c3;' }, ctx())).toBeTruthy();
    expect(quad.blocked({ syntax: 'CATEGORICAL = u1-u4; MODEL: f BY u1-u4; MODEL CONSTRAINT: NEW (a);' }, ctx())).toContain('MODEL CONSTRAINT');
    expect(quad.blocked({ syntax: 'CATEGORICAL = u1-u4; MODEL: f BY u1-u4;' }, ctx())).toBeNull();
  });

  it('is stale when the syntax changes; null when it cannot be read', () => {
    const o = { syntax: 'CATEGORICAL = u1-u4; MODEL: f BY u1-u4;' };
    expect(quad.fingerprint(o, ctx())).not.toBe(quad.fingerprint({ syntax: `${o.syntax} f ON x;` }, ctx()));
    expect(quad.fingerprint({ syntax: 'MODEL: f BY nothere;' }, ctx())).toBeNull();
  });
});

describe('Mplus syntax with Mplus’s defaults: the free parameters Mplus counts', () => {
  it('CFA with censored and count indicators (ex. 5.4): 16', () => {
    const p = spec('CENSORED ARE y1-y3 (a); COUNT ARE c1-c3; MODEL: f1 BY y1-y3; f2 BY c1-c3;');
    expect(p.spec.theta).toHaveLength(16);
    expect(p.dims).toBe(2);
    expect(p.spec.outcomes.map((o) => [o.column, o.type, o.side])).toEqual([['c1', 'count', undefined], ['c2', 'count', undefined], ['c3', 'count', undefined], ['y1', 'censored', 'above'], ['y2', 'censored', 'above'], ['y3', 'censored', 'above']]);
    expect(p.spec.integration).toEqual({ type: 'rect', points: 15, adaptive: true, range: 5, seed: 0 });
    // (the first loading fixed at 1; the factors correlated)
    expect(p.spec.report.find((r) => r.lhs === 'f1' && r.rhs === 'y1')).toMatchObject({ op: '=~', fixed: true });
    expect(p.spec.report.find((r) => r.op === '~~' && r.lhs === 'f2' && r.rhs === 'f1')).toMatchObject({ fixed: false });
  });
  it('censored growth (6.2: 9), censored-inflated growth (6.3: 14), two-part growth (6.16: 13)', () => {
    expect(free('CENSORED ARE y1-y4 (b); MODEL: i s | y1@0 y2@1 y3@2 y4@3;')).toBe(9);
    const p = spec('CENSORED ARE y1-y4 (bi); INTEGRATION = 7; MODEL: i s | y1@0 y2@1 y3@2 y4@3; ii si | y1#1@0 y2#1@1 y3#1@2 y4#1@3; si@0;');
    expect(p.spec.theta).toHaveLength(14);
    expect(p.dims).toBe(3);
    expect(p.spec.integration.points).toBe(7);
    // (the inflation intercepts equal over time, the inflation intercept factor's mean 0)
    expect(new Set(p.spec.outcomes.map((o) => JSON.stringify(p.spec.slots[o.infl!.icpt].t))).size).toBe(1);
    expect(free('CATEGORICAL = u1-u4; MODEL: iu su | u1@0 u2@1 u3@2 u4@3; iy sy | y1@0 y2@1 y3@2 y4@3; su@0; iu WITH sy@0;')).toBe(13);
  });
  it('survival with a factor (6.22: 32), a missing mediator (3.17: 6), XWITH (5.7: 20), selection model (11.3: 18), 3PL with priors', () => {
    const s = spec('SURVIVAL = t (20*1); TIMECENSORED = tc; CATEGORICAL = u1-u4; ANALYSIS: BASEHAZARD = ON; MODEL: f BY u1-u4; [t#1-t#21]; t ON x f; f ON x;');
    expect(s.spec.theta).toHaveLength(32);
    expect(s.spec.outcomes.find((o) => o.type === 'surv')).toMatchObject({ column: 't', censor: 'tc', breaks: Array.from({ length: 21 }, (_, i) => i) });
    const m = spec('CATEGORICAL IS u1; INTEGRATION = MONTECARLO; MODEL: m ON x; u1 ON m x;');
    expect(m.spec.theta).toHaveLength(6);
    expect(m.spec.integration).toMatchObject({ type: 'mc', points: 250 });
    expect(m.dims).toBe(1);
    expect(free('MODEL: f BY y1-y4; fxf | f XWITH f; y1-y4 ON fxf;')).toBe(16);
    expect(spec('MODEL: f BY y1-y4; fxf | f XWITH f; y1-y4 ON fxf;').spec.outcomes.every((o) => o.type === 'normal' && o.prods.length === 1)).toBe(true);
    expect(free('CATEGORICAL = u1-u2; MODEL: i s | y1@0 y2@1 y3@2; u1 ON y1 (1)\ny2 (2);\nu2 ON y2 (1)\ny3 (2);')).toBe(4 + 4 + 2 + 2);
    const irt = spec('CATEGORICAL = u1-u4 (3pl); MODEL: f BY u1-u4*; f@1; [u1$2-u4$2] (a1-a4); MODEL PRIORS: a1-a4 ~ N(1.386, 1);');
    expect(irt.spec.theta).toHaveLength(12);
    expect(irt.spec.priors).toHaveLength(4);
    expect(irt.spec.outcomes[0]).toMatchObject({ asym: '3pl' });
  });
  it('reads MISSING codes, ignores TITLE, DATA and OUTPUT, and refuses what it does not fit', () => {
    const p = spec('TITLE: a model\nDATA: FILE = x.dat;\nVARIABLE: NAMES = u1-u4; CATEGORICAL = u1-u4; MISSING = ALL (999);\nMODEL: f BY u1-u4;\nOUTPUT: TECH1 TECH8;');
    expect(p.spec.missing).toEqual([{ column: 'u1', values: [999] }, { column: 'u2', values: [999] }, { column: 'u3', values: [999] }, { column: 'u4', values: [999] }]);
    expect(() => spec('CATEGORICAL = u1-u4; MODEL: f BY u1-u4; [u1$2];')).toThrow(/not categorical with that many categories/);
    expect(() => spec('CATEGORICAL = u1-u4; MODEL: f BY u1-u4; MODEL PRIORS: zz ~ N(0, 1);')).toThrow(/not a label/);
  });
  it('lists the columns a syntax names', () => {
    expect(quadColumns('CATEGORICAL = u1-u4; MODEL: f BY u1-u4; f ON x; [t#1-t#3]; t ON f;')).toEqual(['u1', 'u2', 'u3', 'u4', 'x', 't']);
  });
});

describe('integration card: results', () => {
  const r: QuadResult = {
    n: 500, logLik: -4424.258, npar: 3, aic: 8854.5, bic: 8867.1, converged: true, theta: [], dims: 2, se: 'mlr',
    integration: { type: 'rect', points: 15, adaptive: true },
    params: [
      { lhs: 'f', op: '=~', rhs: 'u1', est: 1, se: 0, fixed: true }, { lhs: 'u1', op: '|', rhs: 't1', est: 0.4, se: 0.1, fixed: false },
      { lhs: 'f', op: '~~', rhs: 'f', est: 0.7, se: 0.05, fixed: false }, { lhs: 't#1', op: 'hazard', rhs: '', est: 0.05, se: 0.007, fixed: false },
    ],
    warnings: [], engine: { package: 'R', version: '4.5' },
  };
  it('shows the fit, each kind of parameter, and the rule', () => {
    const html = renderToStaticMarkup(<quad.View result={r} options={{ syntax: "" }} current />);
    for (const s of ['Log-likelihood', '-4424.258', 'Loadings (BY)', 'Thresholds', 'u1$1', 'Base hazards', 'Robust SE', 'rectangular (Mplus’s STANDARD)', '15 points per dimension', 'adaptive']) expect(html).toContain(s);
    expect(html).not.toContain('Dispersion');
  });
});
