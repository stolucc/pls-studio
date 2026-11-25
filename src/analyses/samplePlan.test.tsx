import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JOINT_PARAM, type McParam, type McSummaryRow } from '../engine/montecarlo';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { ANALYSIS_TYPES } from './registry';
import { mcPlanAnalysis as t } from './samplePlan';
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
// X and W predict M, M predicts Y; W moderates X → M and M → Y.
const model: ModelState = {
  constructs: [
    K('X', ['x1', 'x2', 'x3']),
    K('W', ['w1', 'w2', 'w3']),
    K('M', ['m1', 'm2', 'm3']),
    K('Y', ['y1', 'y2', 'y3']),
  ],
  paths: [
    { id: 'p1', from: 'X', to: 'M' },
    { id: 'p2', from: 'W', to: 'M' },
    { id: 'p3', from: 'M', to: 'Y' },
  ],
  moderations: [
    { id: 'm1', moderator: 'W', path: 'p1' },
    { id: 'm2', moderator: 'W', path: 'p3' },
  ],
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
const planEntry = t.entries!.find((e) => e.title === 'Plan sample size')!;
const planOf = (c = ctx()) => planEntry.options(t.defaults(c), c);

describe('Plan sample size', () => {
  it('is an entry of the Monte Carlo card in the Add menu; the plain entry is unchanged', () => {
    expect(ANALYSIS_TYPES.find((a) => a.id === 'mc')).toBe(t);
    const plain = t.entries!.find((e) => e.title === 'Monte Carlo simulation')!;
    expect(plain.options(t.defaults(ctx()), ctx()).plan).toBeUndefined();
    const d = planOf();
    expect(d.plan).toBeTruthy();
    expect(t.cardTitle!(d)).toBe('Plan sample size');
    expect(t.summary(d)).toContain('4 hypotheses');
  });

  it('walks through the steps and says which moderation it cannot simulate', () => {
    const html = renderToStaticMarkup(
      <t.Options options={planOf()} set={() => {}} ctx={ctx()} disabled={false} />,
    );
    for (const step of [
      '1 · Model',
      '2 · Measurement',
      '3 · Expected effects',
      '4 · Hypotheses',
      '5 · Analysis and power',
    ])
      expect(html).toContain(step);
    expect(html).toContain('Not simulated: W moderating M → Y');
    expect(html).toContain('X × W → M');
    // (latent interactions need the R engine; the default engine is shown the way out)
    if (DEFAULT_SETTINGS.engine !== 'r') expect(html).toContain('choose the R engine');
  });

  it('says which constructs still need indicators', () => {
    const r = ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'r' } });
    const d = planOf(r);
    const bare = {
      ...d,
      population: {
        ...d.population,
        constructs: d.population.constructs.map((k) =>
          k.name === 'Y' ? { ...k, indicators: [], loadings: [] } : k,
        ),
      },
    };
    // (the card follows the model: indicators added there count at once)
    expect(t.blocked(bare, r)).toBeNull();
    const noItems = {
      ...model,
      constructs: model.constructs.map((k) => (k.id === 'Y' ? { ...k, indicators: [] } : k)),
    };
    const r2 = ctx({ model: noItems, settings: { ...DEFAULT_SETTINGS, engine: 'r' } });
    expect(t.blocked(planOf(r2), r2)).toMatch(
      /^Y has no indicators: right-click it → Add indicator \(Model tab\)/,
    );
    // A card made before the indicators existed runs once they are added on the Model tab.
    expect(t.blocked(planOf(r2), r)).toBeNull();
  });

  it('needs a hypothesis with a non-zero effect', () => {
    const d = planOf(ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'r' } }));
    const r = ctx({ settings: { ...DEFAULT_SETTINGS, engine: 'r' } });
    expect(t.blocked(d, r)).toBeNull();
    expect(t.blocked({ ...d, plan: { ...d.plan!, focal: [] } }, r)).toContain('step 4');
    const zero = {
      ...d,
      population: { ...d.population, paths: d.population.paths.map((p) => ({ ...p, value: 0 })) },
      plan: { ...d.plan!, focal: ['path:X:M'] },
    };
    expect(t.blocked(zero, r)).toContain('step 4');
  });

  it('answers with the N needed, per hypothesis and jointly, and a methods paragraph', () => {
    const d = { ...planOf(), plan: { ...planOf().plan!, focal: ['path:X:M', 'path:M:Y'] } };
    const est = d.estimators[0].id;
    const param = (key: string, value: number): McParam => {
      const [, from, to] = key.split(':');
      return { key, kind: 'path', from, to, value };
    };
    const row = (p: McParam, n: number, rejection: number): McSummaryRow => ({
      estimator: est,
      n,
      param: p,
      reps: 500,
      failed: 0,
      improper: 0,
      mean: p.value,
      bias: 0,
      relBias: 0,
      sd: 0.1,
      rmse: 0.1,
      coverage: 0.95,
      width: 0.3,
      rejection,
    });
    const xm = param('path:X:M', 0.3),
      my = param('path:M:Y', 0.3);
    const rows = [
      row(xm, 100, 0.7),
      row(xm, 200, 0.95),
      row(my, 100, 0.6),
      row(my, 200, 0.9),
      row(JOINT_PARAM, 100, 0.4),
      row(JOINT_PARAM, 200, 0.85),
    ];
    const html = renderToStaticMarkup(<t.View result={rows} options={d} current />);
    expect(html).toContain('plan-answer-n">N = 189<');
    expect(html).toContain('all 2 hypotheses significant in the same sample');
    expect(html).toContain('Power by sample size');
    expect(html).toContain('All hypotheses jointly');
    expect(html).toContain('Muthén &amp; Muthén, 2002');
    expect(html).toContain('All simulation results');
  });
});
