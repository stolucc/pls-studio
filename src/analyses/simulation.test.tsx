import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { McSummaryRow } from '../engine/montecarlo';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { defaultDesign, populationFromModel } from '../model/simulation';
import { withLegacySimulation } from './persist';
import { mcAnalysis as t } from './simulation';
import type { AnalysisCtx } from './types';

const K = (id: string, inds: string[]) => ({
  id,
  name: id,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: inds,
  x: 0,
  y: 0,
  side: 'left' as const,
});
const model: ModelState = {
  constructs: [K('A', ['a1', 'a2', 'a3']), K('B', ['b1', 'b2', 'b3'])],
  paths: [{ id: 'p', from: 'A', to: 'B' }],
  moderations: [],
};
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data: null,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
  model,
  ...over,
});

describe('Monte Carlo card', () => {
  it('starts from a population built on the model, and needs no data', () => {
    const d = t.defaults(ctx());
    expect(d).toEqual(defaultDesign(populationFromModel(model, null, null)));
    expect(t.blocked(d, ctx())).toBeNull();
    expect(t.fingerprint(d, ctx())).toBeTruthy();
  });

  it('says why it cannot run', () => {
    const empty = t.defaults(ctx({ model: { constructs: [], paths: [], moderations: [] } }));
    expect(t.blocked(empty, ctx())).toContain('Build a model first');
    expect(t.blocked({ ...t.defaults(ctx()), estimators: [] }, ctx())).toBe(
      'Choose at least one estimator.',
    );
    expect(
      t.blocked(t.defaults(ctx()), ctx({ settings: { ...DEFAULT_SETTINGS, method: 'process' } })),
    ).toContain('PLS-SEM and CB-SEM');
  });

  it('is stale only when the design or the engine changes, not the data', () => {
    const d = t.defaults(ctx());
    expect(t.fingerprint(d, ctx({ data: { names: ['x'], cols: [Float64Array.from([1])] } }))).toBe(
      t.fingerprint(d, ctx()),
    );
    expect(
      t.fingerprint(d, ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'builtin' } })),
    ).not.toBe(t.fingerprint(d, ctx()));
  });

  it('takes over the simulation design of an older project once', () => {
    const d = t.defaults(ctx());
    const cards = withLegacySimulation([], d);
    expect(cards).toEqual([
      { id: 'card-legacy-simulation', kind: 'analysis', type: 'mc', options: d },
    ]);
    expect(withLegacySimulation(cards, d)).toBe(cards);
    expect(withLegacySimulation([], null)).toEqual([]);
    expect(t.parseOptions(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it('shows the mean CI width and the share of inadmissible solutions', () => {
    const d = t.defaults(ctx());
    const path = { key: 'path:A:B', kind: 'path' as const, from: 'A', to: 'B', value: 0.3 };
    const row: McSummaryRow = {
      estimator: d.estimators[0].id,
      n: 200,
      param: path,
      reps: 50,
      failed: 0,
      improper: 5,
      mean: 0.3,
      bias: 0,
      relBias: 0,
      sd: 0.07,
      rmse: 0.07,
      coverage: 0.95,
      width: 0.275,
      rejection: 0.9,
    };
    const out = renderToStaticMarkup(<t.View result={[row]} options={d} current />);
    expect(out).toContain('CI width');
    expect(out).toContain('0.275');
    expect(out).toContain('Inadmissible');
    expect(out).toContain('10.0%');
  });

  it('draws the distribution of the estimates with the true value and a hover per bin', () => {
    const d = t.defaults(ctx());
    const path = { key: 'path:A:B', kind: 'path' as const, from: 'A', to: 'B', value: 0 };
    const counts = Array.from({ length: 40 }, (_, b) => (b === 10 || b === 30 ? 20 : 0));
    const row = (estimator: string, n: number): McSummaryRow => ({
      estimator,
      n,
      param: path,
      reps: 40,
      failed: 0,
      improper: 0,
      mean: 0,
      bias: 0,
      relBias: null,
      sd: 0.1,
      rmse: 0.1,
      coverage: null,
      width: null,
      rejection: 0.2,
      hist: { lo: -0.4, hi: 0.4, counts, below: 0, above: 0 },
    });
    const ids = d.estimators.map((e) => e.id);
    const out = renderToStaticMarkup(
      <t.View result={ids.flatMap((e) => [row(e, 100), row(e, 200)])} options={d} current />,
    );
    expect(out).toContain('Distribution of the estimates');
    expect(out).toContain('Distribution of the estimates at N = 100');
    expect(out).toContain(`${ids[0]}: 50.0%`); // bin 10 holds half the replications
    expect(out.match(/class="mc-hit"/g)).toHaveLength(40);
    expect(out).toContain('class="ref-line"');
  });

  it('the form offers misspecification: paths to leave out, cross-loadings, error correlations', () => {
    const d = t.defaults(ctx());
    const wrong = {
      ...d,
      population: {
        ...d.population,
        crossLoadings: [{ indicator: 'a1', construct: 'B', value: 0.3 }],
        errorCors: [{ a: 'a1', b: 'b2', value: 0.2 }],
      },
    };
    const out = renderToStaticMarkup(
      <t.Options options={wrong} set={() => {}} ctx={ctx()} disabled={false} />,
    );
    expect(out).toContain('Misspecification');
    expect(out).toContain('Paths left out');
    expect(out).toContain('A → B');
    expect(out).toContain('aria-label="Cross-loading 1: indicator"');
    expect(out).toContain('aria-label="Remove error correlation 1"');
    expect(out).toContain('Add cross-loading');
  });

  it('FIML needs the R engine; the form shows the missing-value fields', () => {
    const d = {
      ...t.defaults(ctx()),
      missing: { rate: 0.1, mechanism: 'MCAR' as const, pls: 'mean' as const, cb: 'fiml' as const },
    };
    const builtin = ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'builtin' } });
    expect(t.blocked(d, builtin)).toMatch(/FIML is estimated by lavaan/);
    expect(t.blocked(d, ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'r' } }))).toBeNull();
    expect(t.blocked({ ...d, missing: { ...d.missing, cb: 'casewise' } }, builtin)).toBeNull();
    const out = renderToStaticMarkup(
      <t.Options options={d} set={() => {}} ctx={ctx()} disabled={false} />,
    );
    expect(out).toContain('Missing values');
    expect(out).toContain('MAR (on the first indicator)');
    expect(out).toContain('FIML (R engine)');
  });
});
