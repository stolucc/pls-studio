// The Piecewise SEM card without R: the canvas as equations (rengine/psem.ts psemStructure), options from files,
// why it cannot run, staleness, and what the view shows.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { psemStructure, type PsemResult } from '../rengine/psem';
import { psemAnalysis as psem } from './psem';
import type { AnalysisCtx } from './types';

const variable = (id: string, indicators = [id]) => ({
  id,
  name: id,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators,
  x: 0,
  y: 0,
  side: 'left' as const,
});
const path = (from: string, to: string) => ({ id: `${from}-${to}`, from, to });
const model = (over: Partial<ModelState> = {}): ModelState => ({
  constructs: ['age', 'firesev', 'cover', 'rich', 'hetero'].map((v) => variable(v)),
  paths: [
    path('age', 'firesev'),
    path('firesev', 'cover'),
    path('cover', 'rich'),
    path('firesev', 'rich'),
  ],
  moderations: [],
  ...over,
});
const col = (...v: number[]) => Float64Array.from(v);
const names = ['age', 'firesev', 'cover', 'rich', 'hetero', 'site'];
const data = { names, cols: names.map((_, k) => col(k, k + 1, k + 3)) };
const ctx = (m: ModelState = model()): AnalysisCtx => ({
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
  model: m,
});

describe('the canvas as a piecewise SEM', () => {
  it('turns paths into one equation per endogenous variable, keeps unconnected variables and correlated errors', () => {
    const m = model({
      correlations: [
        { id: 'c1', kind: 'construct', a: 'cover', b: 'rich' },
        { id: 'c2', kind: 'construct', a: 'rich', b: 'cover' },
        { id: 'c3', kind: 'construct', a: 'age', b: 'hetero' },
        { id: 'c4', kind: 'construct', a: 'firesev', b: 'cover', zero: true },
      ],
    });
    expect(psemStructure(m)).toEqual({
      equations: [
        { y: 'firesev', x: ['age'] },
        { y: 'cover', x: ['firesev'] },
        { y: 'rich', x: ['cover', 'firesev'] },
      ],
      isolated: ['hetero'],
      correlations: [['cover', 'rich']],
    });
  });

  it('refuses what is not an observed-variable DAG', () => {
    expect(psemStructure(undefined)).toContain('Draw a path model');
    expect(
      psemStructure(model({ constructs: [variable('age'), variable('f', ['a', 'b'])] })),
    ).toContain('“f” is not a single observed variable');
    expect(psemStructure(model({ paths: [] }))).toContain('Draw paths');
    expect(
      psemStructure(
        model({ paths: [path('age', 'firesev'), path('firesev', 'cover'), path('cover', 'age')] }),
      ),
    ).toContain('acyclic');
    expect(
      psemStructure(
        model({ moderations: [{ id: 'm', from: 'age', moderator: 'cover', to: 'rich' } as never] }),
      ),
    ).toContain('interactions');
  });
});

describe('the Piecewise SEM card', () => {
  it('validates saved options strictly', () => {
    expect(
      psem.parseOptions({
        families: { rich: 'poisson', cover: 'gamma', age: 'gaussian' },
        standardize: 'x',
        group: 7,
      }),
    ).toEqual({ families: { rich: 'poisson' }, standardize: 'latent.linear' });
    expect(psem.parseOptions({ families: [], standardize: 'Menard.OE', group: 'site' })).toEqual({
      families: {},
      standardize: 'Menard.OE',
      group: 'site',
    });
    expect(psem.parseOptions(null)).toBeNull();
  });

  it('says why it cannot run', () => {
    const o = psem.defaults(ctx());
    expect(psem.blocked(o, ctx())).toBeNull();
    expect(psem.blocked({ ...o, group: 'age' }, ctx())).toBe(
      'The grouping column cannot be a variable of the model.',
    );
    expect(psem.blocked({ ...o, group: 'nope' }, ctx())).toBe('Not in the data: nope.');
    expect(psem.blocked(o, ctx(model({ paths: [] })))).toContain('Draw paths');
  });

  it('is stale when the diagram, a family, the group or the standardisation changes, not for an unused family', () => {
    const o = psem.defaults(ctx());
    const fp = psem.fingerprint(o, ctx());
    expect(psem.fingerprint({ ...o, families: { rich: 'poisson' } }, ctx())).not.toBe(fp);
    expect(psem.fingerprint({ ...o, families: { age: 'poisson' } }, ctx())).toBe(fp);
    expect(psem.fingerprint({ ...o, group: 'site' }, ctx())).not.toBe(fp);
    expect(psem.fingerprint({ ...o, standardize: 'Menard.OE' }, ctx())).not.toBe(fp);
    expect(psem.fingerprint(o, ctx(model({ paths: model().paths.slice(0, 3) })))).not.toBe(fp);
    expect(psem.summary({ ...o, families: { rich: 'poisson' }, group: 'site' })).toBe(
      'normal and poisson · random intercept for site',
    );
  });

  it('shows the d-separation tests, Fisher’s C, coefficients, correlated errors and R²', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server');
    const coef = { df: 88, stat: 4.7, p: 0.0001, se: 0.01 };
    const r: PsemResult = {
      n: 90,
      fisherC: 17.1355,
      df: 6,
      p: 0.0088,
      aic: 1103.49,
      aicc: 1104.33,
      k: 9,
      standardizeType: 'latent.linear',
      warnings: [],
      engine: { package: 'piecewiseSEM', version: '2.3.1' },
      claims: [{ y: 'rich', x: 'age', given: ['cover'], df: 87, stat: -2.01, p: 0.047 }],
      coefs: [
        {
          response: 'firesev',
          predictor: 'age',
          correlation: false,
          est: 0.0597,
          std: 0.4539,
          ...coef,
        },
        {
          response: 'cover',
          predictor: 'rich',
          correlation: true,
          est: -0.21,
          std: -0.21,
          ...coef,
        },
      ],
      r2: [
        {
          response: 'firesev',
          family: 'gaussian',
          link: 'identity',
          method: 'none',
          r2: 0.206,
          marginal: null,
          conditional: null,
        },
      ],
    };
    const html = renderToStaticMarkup(
      <psem.View result={r} options={psem.defaults(ctx())} current />,
    );
    expect(html).toContain('rich ⫫ age | cover');
    expect(html).toContain('17.136');
    expect(html).toContain('Correlated errors');
    expect(html).toContain('R²');
    expect(html).not.toContain('Marginal R²');
  });
});
