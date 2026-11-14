// @vitest-environment happy-dom
// The guided measurement invariance card: freed parameters with their justifications survive a project file and
// malformed ones are dropped (parseProject → parseCards → parseOptions), the request it sends (justifications stay
// in the project), what it still needs, and the view. (Its results against desktop R:
// src/rengine/guidedInvariance.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseProject, type ModelState } from '../model/project';
import type { GuidedInvarianceResult, GuidedStep } from '../rengine/invariance';
import { guidedInvarianceRequest } from '../rengine/invariance';
import {
  cleanWhy,
  guidedInput,
  guidedInvarianceAnalysis,
  parseFreed,
  parseFreedList,
  type GuidedInvarianceOptions,
} from './guidedInvariance';
import { parseCards } from './persist';
import { ANALYSIS_TYPES } from './registry';
import type { AnalysisCtx } from './types';

const cols = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'g'];
const data = {
  names: cols,
  cols: cols.map((_, k) =>
    Float64Array.from({ length: 12 }, (_, i) => ((i * (k + 2)) % 4) + (cols[k] === 'g' ? 0 : 1)),
  ),
};
const factor = (name: string, indicators: string[]) => ({
  id: name,
  name,
  type: 'factor',
  mode: 'A',
  indicators,
  x: 0,
  y: 0,
  side: 'left',
});
const model = (ordered: string[] = []) =>
  ({
    constructs: [factor('A', ['a1', 'a2', 'a3']), factor('B', ['b1', 'b2', 'b3'])],
    paths: [],
    moderations: [],
    ordered,
    multigroup: { column: 'g', invariance: 'configural' },
  }) as unknown as ModelState;
const ctx = (ordered: string[] = [], over: Partial<AnalysisCtx['settings']> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings: { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'MLR', missing: 'fiml', ...over },
  pls: null,
  projectName: 'p',
  model: model(ordered),
});
const WHY = 'The item is worded differently in the translation.';

describe('freed parameters from a project file', () => {
  it('keeps well-formed entries per kind', () => {
    expect(
      parseFreed({ step: 'metric', kind: 'loading', item: 'a2', factor: 'A', why: WHY }),
    ).toEqual({ step: 'metric', kind: 'loading', item: 'a2', factor: 'A', why: WHY });
    expect(
      parseFreed({ step: 'thresholds', kind: 'threshold', item: 'a2', threshold: 2, why: WHY }),
    ).toMatchObject({ threshold: 2 });
    expect(parseFreed({ step: 'scalar', kind: 'intercept', item: 'a2', why: WHY })).not.toBeNull();
    expect(parseFreed({ step: 'strict', kind: 'residual', item: 'a2', why: WHY })).not.toBeNull();
  });
  it('drops anything off: wrong step or kind, missing factor, stray fields, bad thresholds, short reasons', () => {
    const ok = { step: 'scalar', kind: 'intercept', item: 'a2', why: WHY };
    const bad = [
      null,
      'a2',
      { ...ok, step: 'configural' },
      { ...ok, step: 'nonsense' },
      { ...ok, kind: 'loading' },
      { ...ok, item: '' },
      { ...ok, item: 3 },
      { ...ok, item: 'x'.repeat(300) },
      { ...ok, factor: 'A' },
      { ...ok, threshold: 1 },
      { ...ok, why: 'short' },
      { ...ok, why: 'x'.repeat(1001) },
      { ...ok, why: 42 },
      { step: 'metric', kind: 'loading', item: 'a2', why: WHY },
      { step: 'thresholds', kind: 'threshold', item: 'a2', why: WHY },
      { step: 'thresholds', kind: 'threshold', item: 'a2', threshold: 0, why: WHY },
      { step: 'thresholds', kind: 'threshold', item: 'a2', threshold: 1.5, why: WHY },
      { step: 'thresholds', kind: 'threshold', item: 'a2', threshold: 100, why: WHY },
    ];
    for (const b of bad) expect(parseFreed(b), JSON.stringify(b)).toBeNull();
  });
  it('cleans the justification: control characters and runs of whitespace become one space', () => {
    expect(cleanWhy('  Wording\n\tdiffers\u0007 between versions  ')).toBe(
      'Wording differs between versions',
    );
    expect(cleanWhy('\n\n\n\n\n\n\n\n\n\n\n')).toBeNull();
  });
  it('drops duplicates of the same parameter and caps the list', () => {
    const e = { step: 'scalar', kind: 'intercept', item: 'a2', why: WHY };
    expect(parseFreedList([e, { ...e, why: `${WHY} Again.` }])).toHaveLength(1);
    expect(parseFreedList('nope')).toEqual([]);
    const many = Array.from({ length: 150 }, (_, i) => ({ ...e, item: `i${i}` }));
    expect(parseFreedList(many)).toHaveLength(100);
  });
  it('survives a project file through parseProject and parseCards; bad options fall back', () => {
    const options: GuidedInvarianceOptions = {
      constructs: ['A'],
      group: 'g',
      parameterization: 'theta',
      strict: true,
      free: [{ step: 'metric', kind: 'loading', item: 'a2', factor: 'A', why: WHY }],
    };
    const file = {
      format: 'pls-studio',
      version: 1,
      model: { constructs: [], paths: [] },
      settings: {},
      analyses: [
        { id: 'card-1', kind: 'analysis', type: 'guidedinvariance', options },
        {
          id: 'card-2',
          kind: 'analysis',
          type: 'guidedinvariance',
          options: {
            ...options,
            parameterization: 'gamma',
            strict: 'yes',
            free: [{ step: 'metric', kind: 'loading', item: 'a2', why: WHY }, { evil: '<script>' }],
          },
        },
      ],
    };
    const p = parseProject(JSON.stringify(file));
    const cards = parseCards(p.analyses);
    expect(cards).toHaveLength(2);
    const [a, b] = cards.map((k) =>
      k.kind === 'analysis' ? k.options : null,
    ) as GuidedInvarianceOptions[];
    expect(a).toEqual(options);
    expect(b).toMatchObject({ parameterization: 'delta', strict: false, free: [] });
  });
});

describe('request', () => {
  it('continuous items: the project’s MLR and FIML; justifications are not sent', () => {
    const o: GuidedInvarianceOptions = {
      ...guidedInvarianceAnalysis.defaults(ctx()),
      free: [
        { step: 'scalar', kind: 'intercept', item: 'a2', why: WHY },
        { step: 'thresholds', kind: 'threshold', item: 'a3', threshold: 1, why: WHY },
        { step: 'scalar', kind: 'intercept', item: 'zz', why: WHY },
      ],
    };
    expect(o.group).toBe('g');
    const i = guidedInput(o, ctx());
    expect(i).toMatchObject({
      estimator: 'MLR',
      missing: 'fiml',
      ordered: [],
      parameterization: 'delta',
    });
    expect(i.free).toEqual([{ step: 'scalar', kind: 'intercept', item: 'a2' }]);
    const req = guidedInvarianceRequest(data, i);
    expect(JSON.stringify(req)).not.toContain(WHY);
    expect(req.data.names).toEqual(cols);
  });
  it('ordinal items: WLSMV, casewise unless pairwise, the chosen parameterization', () => {
    const o = { ...guidedInvarianceAnalysis.defaults(ctx()), parameterization: 'theta' as const };
    const i = guidedInput(o, ctx(['a1', 'b2']));
    expect(i).toMatchObject({
      estimator: 'WLSMV',
      missing: 'casewise',
      ordered: ['a1', 'b2'],
      parameterization: 'theta',
    });
    expect(guidedInput(o, ctx(['a1'], { missing: 'pairwise' })).missing).toBe('pairwise');
  });
});

describe('blocked', () => {
  const t = guidedInvarianceAnalysis;
  it('asks for a group, refuses a group that is an indicator, and strict ordinal under delta', () => {
    const o = t.defaults(ctx());
    expect(t.blocked(o, ctx())).toBeNull();
    expect(t.blocked({ ...o, group: '' }, ctx())).toMatch(/grouping column/);
    expect(t.blocked({ ...o, group: 'a1' }, ctx())).toMatch(/indicator/);
    expect(t.blocked({ ...o, strict: true }, ctx(['a1']))).toMatch(/theta/);
    expect(t.blocked({ ...o, strict: true, parameterization: 'theta' }, ctx(['a1']))).toBeNull();
    expect(t.blocked({ ...o, strict: true }, ctx())).toBeNull();
  });
  it('is registered once', () => {
    expect(ANALYSIS_TYPES.filter((x) => x.id === 'guidedinvariance')).toHaveLength(1);
  });
});

const fitted = (over: Partial<GuidedStep>): GuidedStep => ({
  step: 'metric',
  converged: true,
  freed: [],
  candidates: [],
  chisq: 60,
  df: 50,
  cfi: 0.99,
  rmsea: 0.02,
  srmr: 0.04,
  cfiKind: 'scaled',
  rmseaKind: 'scaled',
  cfiChange: -0.001,
  rmseaChange: 0.001,
  srmrChange: 0.001,
  chisqDiff: 4,
  dfDiff: 6,
  p: 0.6,
  method: 'satorra.2000',
  syntax: '## LOADINGS:\nA =~ c(NA, NA)*a1',
  ...over,
});
const result = (scalar: Partial<GuidedStep>): GuidedInvarianceResult => ({
  ordinal: true,
  binary: [],
  parameterization: 'delta',
  estimator: 'WLSMV',
  groups: ['north', 'south'],
  n: [6, 6],
  factors: [
    { name: 'A', indicators: ['a1', 'a2', 'a3'] },
    { name: 'B', indicators: ['b1', 'b2', 'b3'] },
  ],
  steps: [
    fitted({ step: 'configural', chisqDiff: undefined, p: undefined, cfiChange: undefined }),
    fitted({ step: 'thresholds' }),
    fitted({ step: 'metric' }),
    fitted({ step: 'scalar', ...scalar }),
  ],
  means: [
    {
      factor: 'A',
      group: 'south',
      est: -0.43,
      se: 0.19,
      z: -2.3,
      p: 0.02,
      lo: -0.8,
      hi: -0.07,
      variance: 1.4,
      varianceSe: 0.37,
    },
  ],
  wald: [{ factor: 'A', x2: 5.4, df: 1, p: 0.02 }],
  dmacs: [],
  warnings: [],
  engine: { package: 'semTools', version: '0.5.10', lavaan: '0.7.3' },
});

describe('view', () => {
  const o: GuidedInvarianceOptions = {
    constructs: [],
    group: 'g',
    parameterization: 'delta',
    strict: false,
    free: [{ step: 'scalar', kind: 'intercept', item: 'a2', why: WHY }],
  };
  const View = guidedInvarianceAnalysis.View;
  it('shows the verdicts, versions, the freed parameter with its justification and the latent means', () => {
    const html = renderToStaticMarkup(<View result={result({})} options={o} current />);
    expect(html).toContain('semTools 0.5.10');
    expect(html).toContain('lavaan 0.7.3');
    expect(html).toContain('Wu &amp; Estabrook (2016)');
    expect(html).toContain('Satorra 2000');
    expect(html).toContain('Sass, Schmitt &amp; Marsh 2014');
    expect(html).toContain(WHY);
    expect(html).toContain('Latent mean differences');
    expect(html).toContain('dMACS (Nye &amp; Drasgow 2011) is defined for continuous items');
    expect(html).toContain('no robust CFI');
  });
  it('a failing scalar step shows its score tests, a button to free the largest, and no means', () => {
    const r = result({
      p: 0.001,
      cfiChange: -0.02,
      candidates: [{ kind: 'intercept', item: 'b3', x2: 12, df: 1, p: 0.0005, test: 'mi' }],
    });
    const html = renderToStaticMarkup(<View result={r} options={o} current />);
    expect(html).toContain('Does not hold');
    expect(html).toContain('Score tests of the scalar');
    expect(html).toContain('Free the intercept of b3');
    expect(html).toContain('modification index');
    expect(html).not.toContain('Latent mean differences');
  });
});
