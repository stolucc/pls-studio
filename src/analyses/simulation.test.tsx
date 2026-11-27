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

  it('offers the CB-SEM measurement checks with a CB-SEM estimator; their χ²(1) refits take longer in R', async () => {
    const { mcSeconds } = await import('./simulation');
    const d = t.defaults(ctx());
    const form = (o: typeof d) =>
      renderToStaticMarkup(<t.Options options={o} set={() => {}} ctx={ctx()} disabled={false} />);
    const pls = { ...d, estimators: d.estimators.filter((e) => e.method !== 'cb') };
    expect(form(pls)).not.toContain('Measurement checks for CB-SEM');
    const cb = {
      ...d,
      estimators: [{ id: 'CB-ML', method: 'cb' as const, estimator: 'ML' as const }],
    };
    expect(form(cb)).toContain('Measurement checks for CB-SEM');
    expect(mcSeconds({ ...cb, cbChecks: true }, 'desktop', 1)).toBeCloseTo(
      2 * mcSeconds(cb, 'desktop', 1),
      9,
    );
    expect(mcSeconds({ ...cb, cbChecks: true }, 'builtin', 1)).toBe(mcSeconds(cb, 'builtin', 1));
  });

  it('offers to estimate a composite population as common factors (Sarstedt et al. 2016)', () => {
    const d = t.defaults(ctx());
    const form = (o: typeof d) =>
      renderToStaticMarkup(<t.Options options={o} set={() => {}} ctx={ctx()} disabled={false} />);
    expect(form(d)).not.toContain('Estimate every construct as a common factor');
    const composites = d.population.constructs.map((c) => ({
      ...c,
      type: 'composite' as const,
      weights: [1, 1, 1],
      withinCor: 0.5,
    }));
    const mixed = { ...d, population: { ...d.population, constructs: composites } };
    expect(form(mixed)).toContain('Estimate every construct as a common factor');
  });

  it('runs GSCA in R only (cSEM), and offers no switch to the built-in engine for it', async () => {
    const { needsR } = await import('./simulation');
    const d = t.defaults(ctx());
    const gsca = {
      ...d,
      estimators: [
        { id: 'GSCA', method: 'pls' as const, consistent: false, approach: 'GSCA' as const },
      ],
    };
    expect(needsR(d)).toBe(false);
    expect(needsR(gsca)).toBe(true);
    const builtin = { ...DEFAULT_SETTINGS, engine: 'builtin' as const };
    expect(t.blocked(gsca, ctx({ settings: builtin }))).toBe(
      'GSCA is estimated by cSEM: choose the R engine.',
    );
    expect(t.blocked(gsca, ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'r' } }))).toBeNull();
  });

  it('runs latent interactions in R only, with PLS (product indicators) and sum scores, and edits them', async () => {
    const { needsR } = await import('./simulation');
    const d = t.defaults(ctx());
    const interactions = [{ a: 'A', b: 'A', to: 'B', value: 0.3 }];
    const withProduct = {
      ...d,
      population: { ...d.population, interactions },
      estimators: [{ id: 'PLS', method: 'pls' as const, consistent: false }],
    };
    expect(needsR(withProduct)).toBe(true);
    const r = ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'r' } });
    expect(t.blocked(withProduct, r)).toBeNull();
    expect(
      t.blocked(withProduct, ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'builtin' } })),
    ).toBe('Latent interactions are estimated by cSEM: choose the R engine.');
    const withPlsc = {
      ...withProduct,
      estimators: [
        ...withProduct.estimators,
        { id: 'PLSc', method: 'pls' as const, consistent: true },
      ],
    };
    expect(t.blocked(withPlsc, r)).toContain('remove PLSc');
    const form = renderToStaticMarkup(
      <t.Options options={withProduct} set={() => {}} ctx={ctx()} disabled={false} />,
    );
    expect(form).toContain('Latent interactions');
    expect(form).toContain('aria-label="Remove interaction 1"');
    expect(form).toContain('Add interaction');
  });

  it('compares two groups in R only, by PLS with bootstrap SEs and CB-SEM, and edits the second group', async () => {
    const { needsR } = await import('./simulation');
    const d = t.defaults(ctx());
    const two = {
      ...d,
      groups: { paths: [{ from: 'A', to: 'B', value: 0.6 }] },
      estimators: [
        { id: 'PLS', method: 'pls' as const, consistent: false },
        { id: 'CB-ML', method: 'cb' as const, estimator: 'ML' as const },
      ],
      bootSamples: 200,
    };
    expect(needsR(two)).toBe(true);
    const r = ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'r' } });
    expect(t.blocked(two, r)).toBeNull();
    expect(t.blocked(two, ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'builtin' } }))).toBe(
      'Two groups are compared by cSEM and lavaan: choose the R engine.',
    );
    expect(t.blocked({ ...two, bootSamples: 0 }, r)).toContain('bootstrap standard errors');
    const regression = {
      ...two,
      estimators: [{ id: 'Sum scores', method: 'regression' as const, dr: false }],
    };
    expect(t.blocked(regression, r)).toContain('remove the regression estimators');
    const form = (o: typeof d) =>
      renderToStaticMarkup(<t.Options options={o} set={() => {}} ctx={ctx()} disabled={false} />);
    expect(form(d)).toContain('Compare two groups');
    expect(form(two)).toContain('first group');
  });

  it('lets a construct correlation reach 1 (one factor split in two)', () => {
    const d = t.defaults(ctx({ model: { ...model, paths: [] } }));
    const form = renderToStaticMarkup(
      <t.Options options={d} set={() => {}} ctx={ctx()} disabled={false} />,
    );
    const field = form.slice(form.indexOf('A ↔ B (correlation)'));
    expect(field).toMatch(/^[^<]*<\/span>[^]*?<input[^>]*max="1"/);
  });

  it('runs PLS on a measurement model only (two correlated constructs), not on a single construct', () => {
    const d = t.defaults(ctx());
    const pop = d.population;
    const pathFree = { ...d, population: { ...pop, paths: [] } };
    expect(t.blocked(pathFree, ctx())).toBeNull();
    const single = {
      ...pathFree,
      population: { ...pop, paths: [], constructs: pop.constructs.slice(0, 1) },
    };
    expect(t.blocked(single, ctx())).toMatch(/at least two constructs/);
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

  it('shows the bootstrap SE over the SD of the estimates when the results have it', () => {
    const d = t.defaults(ctx());
    const path = { key: 'path:A:B', kind: 'path' as const, from: 'A', to: 'B', value: 0.3 };
    const row: McSummaryRow = {
      estimator: d.estimators[0].id,
      n: 100,
      param: path,
      reps: 50,
      failed: 0,
      improper: 0,
      mean: 0.3,
      bias: 0,
      relBias: 0,
      sd: 0.1,
      rmse: 0.1,
      coverage: 0.97,
      width: 0.45,
      rejection: 0.6,
    };
    const without = renderToStaticMarkup(<t.View result={[row]} options={d} current />);
    expect(without).not.toContain('Boot SE / SD');
    const out = renderToStaticMarkup(
      <t.View result={[{ ...row, seRatio: 1.153 }]} options={d} current />,
    );
    expect(out).toContain('Boot SE / SD');
    expect(out).toContain('1.153');
    expect(out).toContain('its tests conservative');
  });

  it('flags thin bootstraps: the share with few admissible draws and the median kept', () => {
    const d = t.defaults(ctx());
    const path = { key: 'path:A:B', kind: 'path' as const, from: 'A', to: 'B', value: 0.3 };
    const row: McSummaryRow = {
      estimator: d.estimators[0].id,
      n: 50,
      param: path,
      reps: 500,
      failed: 0,
      improper: 0,
      mean: 0.3,
      bias: 0,
      relBias: 0,
      sd: 0.1,
      rmse: 0.1,
      coverage: 0.84,
      width: 0.45,
      rejection: 0.6,
    };
    // every bootstrap full: no column
    const full = renderToStaticMarkup(
      <t.View result={[{ ...row, thinBoot: 0, keptMedian: 1000 }]} options={d} current />,
    );
    expect(full).not.toContain('Thin bootstrap');
    const out = renderToStaticMarkup(
      <t.View result={[{ ...row, thinBoot: 0.47, keptMedian: 46 }]} options={d} current />,
    );
    expect(out).toContain('Thin bootstrap');
    expect(out).toContain('47% (46)');
    expect(out).toContain('fewer than 100 admissible draws');
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

  it('keys both charts inside their SVG: every estimator, the reference line and the true value', () => {
    const d = t.defaults(ctx());
    const path = { key: 'path:A:B', kind: 'path' as const, from: 'A', to: 'B', value: 0 };
    const counts = Array.from({ length: 40 }, (_, b) => (b === 10 ? 40 : 0));
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
    const svgs = out.match(/<svg[\s\S]*?<\/svg>/g)!;
    const power = svgs.find((x) => x.includes('by sample size'))!;
    const dist = svgs.find((x) => x.includes('Distribution of the estimates at N'))!;
    for (const svg of [power, dist]) {
      expect(svg).toContain('aria-label="Legend"');
      expect(svg).toContain('class="plot-panel"');
      for (const e of ids) expect(svg).toContain(`>${e}</text>`);
    }
    // (a null effect: its rejection rate is the Type I error, against the nominal α, on a tight axis)
    expect(power).toContain(`>Nominal α = ${d.alpha}</text>`);
    expect(power).toContain('>Type I error rate</text>');
    expect(power).not.toContain('>100%</text>');
    expect(dist).toContain('>True value</text>');
    // (round ticks and a line type per estimator, as published simulation figures)
    expect(dist).toMatch(/>−?0\.[0-9]+<\/text>/);
    expect(dist).toContain('stroke-dasharray="7 4"');
    // (no key outside the charts, which an exported figure would lose)
    expect(out).not.toContain('class="legend"');
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

  it('PLS bootstrap: the form offers sign change and interval; the results show rejection by test', () => {
    const d = {
      ...t.defaults(ctx()),
      inference: { signChange: 'individual' as const, interval: 'bca' as const },
    };
    const form = renderToStaticMarkup(
      <t.Options options={d} set={() => {}} ctx={ctx()} disabled={false} />,
    );
    expect(form).toContain('Sign-change correction');
    expect(form).toContain('Construct level');
    expect(form).toContain('BCa');
    const noBoot = renderToStaticMarkup(
      <t.Options options={{ ...d, bootSamples: 0 }} set={() => {}} ctx={ctx()} disabled={false} />,
    );
    expect(noBoot).not.toContain('Sign-change correction');
    // inadmissible PLSc draws: asked only with a PLSc estimator; kept, the notes say so
    const noPlsc = {
      ...d,
      estimators: d.estimators.filter((e) => !('consistent' in e && e.consistent)),
    };
    expect(
      renderToStaticMarkup(
        <t.Options options={noPlsc} set={() => {}} ctx={ctx()} disabled={false} />,
      ),
    ).not.toContain('Inadmissible PLSc draws');
    const plsc = {
      ...d,
      estimators: [{ id: 'PLSc', method: 'pls' as const, consistent: true }],
      inference: { ...d.inference, inadmissible: 'keep' as const },
    };
    const withPlsc = renderToStaticMarkup(
      <t.Options options={plsc} set={() => {}} ctx={ctx()} disabled={false} />,
    );
    expect(withPlsc).toContain('Inadmissible PLSc draws');
    expect(withPlsc).toContain('Keep (as matrixpls)');
    // kept: the note on what keeping means, the |ρA| rule included; dropped: no note
    expect(withPlsc).toContain('uses |ρA|, as cSEM and matrixpls do');
    const dropped = renderToStaticMarkup(
      <t.Options
        options={{ ...plsc, inference: { ...plsc.inference, inadmissible: undefined } }}
        set={() => {}}
        ctx={ctx()}
        disabled={false}
      />,
    );
    expect(dropped).toContain('Inadmissible PLSc draws');
    expect(dropped).not.toContain('|ρA|');

    const path = { key: 'path:A:B', kind: 'path' as const, from: 'A', to: 'B', value: 0 };
    const row: McSummaryRow = {
      estimator: d.estimators[0].id,
      n: 100,
      param: path,
      reps: 500,
      failed: 0,
      improper: 0,
      mean: 0,
      bias: 0,
      relBias: null,
      sd: 0.2,
      rmse: 0.2,
      coverage: 0.95,
      width: 0.7,
      rejection: 0.05,
      tests: { t: 0.073, normal: 0.061, basic: 0.444, percentile: 0.06 },
    };
    const out = renderToStaticMarkup(<t.View result={[row]} options={d} current />);
    expect(out).toContain('Type I error by test');
    expect(out).toContain('Basic CI');
    expect(out).toContain('0.444');
    expect(out).toContain('bootstrap BCa, individual sign-change correction');
  });

  it('a composite reliability row names the ideal and the unit-weight reliability', () => {
    const d = t.defaults(ctx());
    const param = {
      key: 'reliability:A',
      kind: 'reliability' as const,
      from: 'A',
      to: 'A',
      value: 0.85,
      unit: 0.78,
    };
    const row: McSummaryRow = {
      estimator: d.estimators[0].id,
      n: 100,
      param,
      reps: 50,
      failed: 0,
      improper: 0,
      mean: 0.8,
      bias: -0.05,
      relBias: -0.059,
      sd: 0.03,
      rmse: 0.058,
      coverage: null,
      width: null,
      rejection: null,
    };
    const out = renderToStaticMarkup(<t.View result={[row]} options={d} current />);
    expect(out).toContain('A: reliability of the composite');
    expect(out).toContain('A: composite reliability (ideal 0.850)');
    expect(out).toContain('unit weights (sum scores) give 0.780');
  });

  it('a PLS measurement check row: its rule, cutoff and the share failing it', () => {
    const d = t.defaults(ctx());
    const param = {
      key: 'validity:htmt:A:B',
      kind: 'validity' as const,
      from: 'A',
      to: 'B',
      value: 0.62,
      rule: 'htmt' as const,
    };
    const row: McSummaryRow = {
      estimator: d.estimators[0].id,
      n: 100,
      param,
      reps: 50,
      failed: 0,
      improper: 0,
      mean: 0.63,
      bias: 0.01,
      relBias: 0.016,
      sd: 0.05,
      rmse: 0.05,
      coverage: null,
      width: null,
      rejection: 0.02,
    };
    const out = renderToStaticMarkup(<t.View result={[row]} options={d} current />);
    expect(out).toContain('A – B: HTMT (.85), fails if &gt; 0.85');
    expect(out).toContain('Fails cutoff');
    expect(out).toContain('Rönkkö &amp; Evermann (2013)');
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

  it('the three-form design: the share is the design’s, the form lists each construct’s blocks', () => {
    const base = t.defaults(ctx());
    const d = {
      ...base,
      missing: {
        rate: 0.05,
        mechanism: 'three-form' as const,
        pls: 'mean' as const,
        cb: 'fiml' as const,
      },
    };
    const out = renderToStaticMarkup(
      <t.Options options={d} set={() => {}} ctx={ctx()} disabled={false} />,
    );
    expect(out).toContain('Three-form design (planned missing)');
    expect(out).toContain('set by the three-form design');
    expect(out).toContain('three-form-note');
    const c = base.population.constructs[0];
    expect(out).toContain(`${c.name}: X ${c.indicators[0]}`);
    // (the stored rate is only the switch: the shown share is the design's)
    expect(out).not.toContain('value="5"');
    expect(t.blocked(d, ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'r' } }))).toBeNull();
  });

  it('WLSMV needs the R engine and has no FIML for ordinal data; the form offers ordinal indicators', () => {
    const base = t.defaults(ctx());
    const d = {
      ...base,
      estimators: [{ id: 'CB-WLSMV', method: 'cb' as const, estimator: 'WLSMV' as const }],
      ordinal: { categories: 5, thresholds: 'symmetric' as const },
    };
    const r = ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'r' } });
    expect(t.blocked(d, ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'builtin' } }))).toMatch(
      /WLSMV is estimated by lavaan/,
    );
    expect(t.blocked(d, r)).toBeNull();
    const fiml = {
      ...d,
      missing: { rate: 0.1, mechanism: 'MCAR' as const, pls: 'mean' as const, cb: 'fiml' as const },
    };
    expect(t.blocked(fiml, r)).toMatch(/no FIML for ordinal/);
    const out = renderToStaticMarkup(
      <t.Options options={d} set={() => {}} ctx={ctx()} disabled={false} />,
    );
    expect(out).toContain('Indicator scale');
    expect(out).toContain('Asymmetric (most cases high)');
    expect(out).toContain('CB-WLSMV');
    for (const id of ['PLS mode A', 'PLS mode B', 'PLS centroid', 'Sum scores', 'DR'])
      expect(out, id).toContain(`>${id}<`);
  });
});
