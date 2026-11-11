// The marginal means section (analyses/emm.tsx): options survive a project file, bad values are
// dropped, the section says what it still needs, the cards carry it, and its tables and profile
// plot render. (Its numbers against emmeans, afex, rstatix and lmerTest: rengine/emm.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { emmRequest, parseEmm, type EmmOptions } from '../rengine/emm';
import { anovaRequest } from '../rengine/tests';
import { lmmRequest } from '../rengine/mixed';
import {
  columnLevels,
  emmBlocked,
  emmDefaults,
  EmmFields,
  emmPart,
  emmTerms,
  EmmView,
  parseEmmOptions,
  parseWeightText,
  withEmm,
} from './emm';
import { lmmAnalysis } from './lmm';
import { anovaAnalysis, rmAnovaAnalysis } from './tests';
import type { AnalysisCtx } from './types';

const data = {
  names: ['y', 'a', 'b', 'c'],
  cols: [
    new Float64Array([1, 2, 3, 4, 5, 6]),
    new Float64Array([1, 1, 2, 2, 3, 3]),
    new Float64Array([1, 2, 1, 2, 1, 2]),
    new Float64Array([1, 1, 1, 2, 2, 2]),
  ],
};
const ctx = {
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'x',
} as unknown as AnalysisCtx;
const EMM: EmmOptions = {
  terms: [['a']],
  posthoc: [['a']],
  adjust: ['tukey', 'holm'],
  gamesHowell: true,
  simple: { factor: 'a', by: 'b' },
  contrasts: [{ factor: 'a', type: 'custom', reference: 'first', weights: [[1, -1, 0]] }],
  plot: { x: 'a', lines: 'b' },
  df: 'satterthwaite',
};

describe('the marginal means options', () => {
  it('lists every term of the factors up to three-way interactions', () => {
    expect(emmTerms(['a', 'b', 'c'])).toEqual([
      ['a'],
      ['b'],
      ['c'],
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
      ['a', 'b', 'c'],
    ]);
  });

  it('survive a project file, and bad values are dropped or replaced', () => {
    expect(parseEmmOptions(JSON.parse(JSON.stringify(EMM)))).toEqual(EMM);
    expect(parseEmmOptions(null)).toBeNull();
    expect(parseEmmOptions('x')).toBeNull();
    const bad = parseEmmOptions({
      terms: [['a', 'a'], [], 'a', ['a', 'b', 'c', 'd'], ['b']],
      adjust: ['tukey', 'evil', 'tukey'],
      contrasts: [{ factor: 'a', type: 'nope', weights: [[1, 'x', -1]] }, { type: 'poly' }],
      simple: { factor: 'a' },
      plot: { lines: 'b' },
      df: 'magic',
    })!;
    expect(bad.terms).toEqual([['b']]);
    expect(bad.adjust).toEqual(['tukey']);
    expect(bad.contrasts).toEqual([
      { factor: 'a', type: 'deviation', reference: 'first', weights: [[1, -1]] },
    ]);
    expect(bad.simple).toBeNull();
    expect(bad.plot).toBeNull();
    expect(bad.df).toBe('kenward-roger');
    expect(parseEmmOptions({ adjust: [] })!.adjust).toEqual(['tukey']);
  });

  it('say what they still need', () => {
    const levels = (f: string) => columnLevels(data, f);
    expect(emmBlocked(EMM, ['a', 'b'], levels)).toBeNull();
    expect(emmBlocked(EMM, [], levels)).toMatch(/at least one factor/);
    expect(emmBlocked({ ...EMM, terms: [['z']] }, ['a', 'b'], levels)).toMatch(/not in the model/);
    const nothing = { ...emmDefaults(['a']), terms: [] };
    expect(emmBlocked(nothing, ['a'], levels)).toMatch(/Choose what/);
    expect(emmBlocked({ ...EMM, posthoc: [['a', 'b']] }, ['a', 'b'], levels)).toMatch(
      /Games–Howell/,
    );
    expect(emmBlocked({ ...EMM, simple: { factor: 'a', by: 'a' } }, ['a', 'b'])).toMatch(
      /two different/,
    );
    expect(emmBlocked({ ...EMM, plot: { x: 'b', lines: 'b' } }, ['a', 'b'])).toMatch(/different/);
    const custom = (weights: number[][]) => ({
      ...EMM,
      contrasts: [{ factor: 'a', type: 'custom' as const, reference: 'first' as const, weights }],
    });
    expect(emmBlocked(custom([]), ['a', 'b'], levels)).toMatch(/Give the custom weights/);
    expect(emmBlocked(custom([[1, -1]]), ['a', 'b'], levels)).toMatch(/needs 3 numbers/);
    expect(emmBlocked(custom([[1, 1, 0]]), ['a', 'b'], levels)).toMatch(/sum to zero/);
    expect(emmBlocked(custom([[0, 0, 0]]), ['a', 'b'], levels)).toMatch(/sum to zero/);
  });

  it('read custom weights as rows of numbers', () => {
    expect(parseWeightText('1 -1 0; 0.5, 0.5, -1\n2 x -2')).toEqual([
      [1, -1, 0],
      [0.5, 0.5, -1],
      [2, -2],
    ]);
    expect(parseWeightText(' ; ')).toEqual([]);
  });

  it('send only what R reads; a card drops the key when switched off', () => {
    const req = emmRequest({ ...EMM, contrasts: [{ ...EMM.contrasts[0], type: 'helmert' }] });
    expect(req).not.toHaveProperty('df');
    expect((req.contrasts as object[])[0]).not.toHaveProperty('weights');
    expect(emmRequest(EMM, true).df).toBe('satterthwaite');
    const off = withEmm({ dependent: 'y', emm: EMM }, null);
    expect(off).toEqual({ dependent: 'y' });
    expect(emmPart({ emm: 3 })).toEqual({});
  });
});

describe('the cards carry the section', () => {
  it('ANOVA: parsed, blocked, fingerprinted and sent', () => {
    const o = anovaAnalysis.parseOptions({
      dependent: 'y',
      factors: ['a', 'b'],
      covariates: [],
      emm: EMM,
    })!;
    expect(o.emm).toEqual(EMM);
    expect(anovaAnalysis.blocked!(o, ctx)).toBeNull();
    const bad = { ...o, emm: { ...EMM, terms: [['c']] } };
    expect(anovaAnalysis.blocked!(bad, ctx)).toMatch(/not in the model/);
    expect(anovaAnalysis.fingerprint(o, ctx)).not.toBe(
      anovaAnalysis.fingerprint(withEmm(o, null), ctx),
    );
    const req = anovaRequest(data, { ...o, confidence: 0.9 }) as Record<string, unknown>;
    expect(req.emm).toBeTruthy();
    const plain = anovaRequest(data, { ...withEmm(o, null), confidence: 0.9 });
    expect(plain).not.toHaveProperty('emm');
  });

  it('repeated measures: within and between factors', () => {
    const o = rmAnovaAnalysis.parseOptions({
      levels: ['y', 'a', 'b'],
      factorName: 'time',
      between: 'c',
      emm: {
        ...EMM,
        gamesHowell: false,
        terms: [['time', 'c']],
        posthoc: [['time']],
        simple: { factor: 'time', by: 'c' },
        plot: { x: 'time', lines: 'c' },
      },
    })!;
    expect(o.emm!.terms).toEqual([['time', 'c']]);
    // (the custom weights of `a`: a is not a factor of this design)
    expect(rmAnovaAnalysis.blocked!(o, ctx)).toMatch(/not in the model/);
    const ok = { ...o, emm: { ...o.emm!, contrasts: [] } };
    expect(rmAnovaAnalysis.blocked!(ok, ctx)).toBeNull();
  });

  it('multilevel regression: categorical predictors in the basic model only', () => {
    const o = lmmAnalysis.parseOptions({
      outcome: 'y',
      predictors: ['a', 'b'],
      factors: ['a', 'zz'],
      cluster: 'c',
      slopes: [],
      emm: { ...EMM, gamesHowell: false, simple: null, plot: null },
    })!;
    expect(o.factors).toEqual(['a']);
    expect(lmmAnalysis.blocked!(o, ctx)).toBeNull();
    const ext = { ...o, interactions: [['a', 'b']] };
    expect(lmmAnalysis.blocked!(ext, ctx)).toMatch(/one cluster level/);
    expect(lmmAnalysis.blocked!({ ...o, slopes: ['a'] }, ctx)).toMatch(/numeric predictors/);
    const req = lmmRequest(data, { ...o, center: 'none', estimation: 'REML' });
    expect(req.emm).toBeTruthy();
    // (no categorical predictors: the request of an older card, unchanged)
    const old = lmmAnalysis.parseOptions({ outcome: 'y', predictors: ['a'], cluster: 'c' })!;
    expect(lmmRequest(data, old)).not.toHaveProperty('categories');
    expect(
      lmmAnalysis.parseOptions({ outcome: 'y', predictors: ['a'], emm: EMM }),
    ).not.toHaveProperty('emm');
  });
});

describe('the section renders', () => {
  const result = parseEmm({
    confidence: 0.95,
    df: 'kenward-roger',
    means: [
      {
        term: 'a',
        rows: [
          { levels: 'x', emmean: 1, se: 0.1, df: 'Inf', lower: 0.8, upper: 1.2 },
          { levels: 'y', emmean: 2, se: 0.1, df: 10, lower: 1.8, upper: 2.2 },
        ],
      },
    ],
    posthoc: [
      {
        term: 'a',
        adjust: ['tukey', 'holm'],
        rows: {
          contrast: 'x - y',
          estimate: -1,
          se: 0.14,
          df: 10,
          t: -7,
          lower: -1.3,
          upper: -0.7,
          pAdjusted: { tukey: 0.001, holm: 0.002 },
        },
      },
    ],
    gamesHowell: [],
    simple: {
      factor: 'a',
      by: 'b',
      rows: { level: 'b1', df1: 1, df2: 10, f: 49, p: 0.0001 },
    },
    contrasts: [],
    plot: {
      x: 'a',
      lines: 'b',
      rows: [
        { x: 'x', line: 'b1', emmean: 1, lower: 0.8, upper: 1.2 },
        { x: 'y', line: 'b1', emmean: 2, lower: 1.8, upper: 2.2 },
        { x: 'x', line: 'b2', emmean: 1.5, lower: 1.2, upper: 1.8 },
        { x: 'y', line: 'b2', emmean: 1.4, lower: 1.1, upper: 1.7 },
      ],
    },
    version: '2.0.4',
  })!;

  it('parses R’s JSON: scalars as lists, an infinite df as null', () => {
    expect(result.means[0].term).toEqual(['a']);
    expect(result.means[0].rows[0].levels).toEqual(['x']);
    expect(result.means[0].rows[0].df).toBeNull();
    expect(result.posthoc[0].rows).toHaveLength(1);
    expect(result.simple!.rows).toHaveLength(1);
    expect(parseEmm(null)).toBeNull();
  });

  it('tables, adjustments and the profile plot with a line per level', () => {
    const html = renderToStaticMarkup(<EmmView e={result} dependent="y" />);
    expect(html).toContain('Estimated marginal means: a');
    expect(html).toContain('p (Holm)');
    expect(html).toContain('Simple effects of a at each level of b');
    expect(html).toContain('Kenward–Roger');
    expect(html).toContain('∞');
    expect(html).toContain('Profile plot');
    expect((html.match(/<polyline/g) ?? []).length).toBe(2);
  });

  it('the form: off, then every part when on', () => {
    const off = renderToStaticMarkup(<EmmFields value={null} factors={['a']} set={() => {}} />);
    expect(off).toContain('Estimated marginal means');
    expect(off).not.toContain('Profile plot');
    const on = renderToStaticMarkup(
      <EmmFields value={EMM} factors={['a', 'b']} games mixed set={() => {}} />,
    );
    for (const text of ['Games–Howell', 'Scheffé', 'Simple effects of', 'Planned contrasts of a'])
      expect(on).toContain(text);
    expect(on).toContain('Degrees of freedom');
    expect(on).toContain('Profile plot');
  });
});
