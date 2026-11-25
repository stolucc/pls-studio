import { describe, expect, it } from 'vitest';
import {
  JOINT_PARAM,
  mcTasks,
  runMcTask,
  summariseMc,
  type McDesign,
  type McSummaryRow,
} from '../engine/montecarlo';
import type { PopulationSpec } from '../engine/population';
import type { ModelState } from './project';
import {
  coarseSizes,
  crossing,
  crossingText,
  interactionsFromModel,
  planDesign,
  planMethodsText,
  planParameters,
  planReports,
  refineSizes,
  syncPlan,
} from './samplePlan';
import { parseDesign } from './simulation';

const k = (id: string, indicators: string[]) =>
  ({ id, name: id, type: 'factor', mode: 'A', indicators, x: 0, y: 0, side: 'left' }) as never;

// X and W predict M, M predicts Y; W moderates X → M (first stage) and M → Y (second stage).
const model: ModelState = {
  constructs: [
    k('X', ['x1', 'x2', 'x3']),
    k('W', ['w1', 'w2', 'w3']),
    k('M', ['m1', 'm2', 'm3']),
    k('Y', ['y1', 'y2', 'y3']),
  ],
  paths: [
    { id: 'p1', from: 'X', to: 'M' },
    { id: 'p2', from: 'W', to: 'M' },
    { id: 'p3', from: 'M', to: 'Y' },
  ] as never,
  moderations: [
    { id: 'm1', moderator: 'W', path: 'p1' },
    { id: 'm2', moderator: 'W', path: 'p3' },
  ],
};

describe('crossing', () => {
  it('interpolates between the last N below the target and the next', () => {
    const c = crossing(
      [
        { n: 100, power: 0.5 },
        { n: 200, power: 0.7 },
        { n: 400, power: 0.9 },
      ],
      0.8,
    );
    expect(c).toEqual({ status: 'found', n: 300, lower: 200, upper: 400 });
  });

  it('is conservative under noise: a dip below the target after a crossing moves it up', () => {
    const c = crossing(
      [
        { n: 100, power: 0.82 },
        { n: 200, power: 0.79 },
        { n: 400, power: 0.95 },
      ],
      0.8,
    );
    expect(c?.status).toBe('found');
    expect(c && c.status === 'found' && c.lower).toBe(200);
  });

  it('reports a target reached at the smallest N, or never reached', () => {
    expect(crossing([{ n: 50, power: 0.9 }], 0.8)).toEqual({ status: 'atMin', n: 50 });
    const never = crossing(
      [
        { n: 50, power: 0.2 },
        { n: 800, power: 0.6 },
      ],
      0.8,
    );
    expect(never).toEqual({ status: 'notReached', maxN: 800, power: 0.6 });
    expect(crossingText(never, 0.8)).toMatch(/^above 800/);
    expect(crossing([], 0.8)).toBeNull();
  });
});

describe('the sample sizes searched', () => {
  it('doubles from the smallest to the largest N', () => {
    expect(coarseSizes(50, 1000)).toEqual([50, 100, 200, 400, 800, 1000]);
    expect(coarseSizes(100, 150)).toEqual([100, 150]);
  });

  it('refines inside each bracket, skipping sizes already run', () => {
    const s = refineSizes([{ status: 'found', n: 300, lower: 200, upper: 400 }], [200, 400]);
    expect(s).toEqual([250, 300, 350]);
    expect(refineSizes([{ status: 'atMin', n: 50 }, null], [50])).toEqual([]);
  });
});

describe('moderations from the model', () => {
  it('simulates first-stage moderation and reports second-stage moderation', () => {
    const { interactions, skipped } = interactionsFromModel(model);
    expect(interactions).toEqual([{ a: 'X', b: 'W', to: 'M', value: 0.1 }]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].label).toBe('W moderating M → Y');
    expect(skipped[0].reason).toMatch(/M is endogenous/);
  });

  it('starts a plan with the interaction, one estimator and every non-zero path as a hypothesis', () => {
    const d = planDesign(model, null, null, 'pls');
    expect(d.population.interactions).toHaveLength(1);
    // (latent interactions: PLS with product indicators, not PLSc or CB-SEM)
    expect(d.estimators.map((e) => e.id)).toEqual(['PLS']);
    expect(planDesign(model, null, null, 'cbsem').estimators[0].id).toBe('PLS');
    const plain = { ...model, moderations: [] };
    expect(planDesign(plain, null, null, 'pls').estimators[0].id).toBe('PLSc');
    expect(d.plan?.focal).toEqual(
      expect.arrayContaining(['path:X:M', 'path:W:M', 'path:M:Y', 'path:X × W:M']),
    );
    expect(planDesign(plain, null, null, 'cbsem').estimators[0].id).toBe('CB-ML');
  });

  it('keeps the plan through a project file', () => {
    const d = planDesign(model, null, null, 'pls');
    const back = parseDesign(JSON.parse(JSON.stringify(d)));
    expect(back?.plan).toEqual(d.plan);
    expect(parseDesign({ ...d, plan: { focal: 'x' } })?.plan).toBeUndefined();
  });
});

describe('joint power', () => {
  const pop: PopulationSpec = {
    constructs: [
      { name: 'X', type: 'factor', indicators: ['x1', 'x2', 'x3'], loadings: [0.8, 0.75, 0.7] },
      { name: 'M', type: 'factor', indicators: ['m1', 'm2', 'm3'], loadings: [0.8, 0.7, 0.75] },
      { name: 'Y', type: 'factor', indicators: ['y1', 'y2', 'y3'], loadings: [0.75, 0.8, 0.7] },
    ],
    paths: [
      { from: 'X', to: 'M', value: 0.3 },
      { from: 'M', to: 'Y', value: 0.2 },
    ],
    exoCor: [],
  };
  const design: McDesign = {
    population: pop,
    estimators: [{ id: 'ML', method: 'cb', estimator: 'ML' }],
    sampleSizes: [60, 400],
    replications: 80,
    seed: 3,
    alpha: 0.05,
    bootSamples: 0,
    mcDraws: 200,
    plan: { focal: ['path:X:M', 'path:M:Y'], target: 0.8, search: 'fixed', minN: 60, maxN: 400 },
  };
  const rows = summariseMc(
    design,
    mcTasks(design, 2).map((t) => runMcTask(t)),
  );
  const at = (key: string, n: number) =>
    rows.find((r) => r.param.key === key && r.n === n) as McSummaryRow;

  it('is at most the power of the weakest hypothesis, and rises with N', () => {
    for (const n of [60, 400]) {
      const joint = at(JOINT_PARAM.key, n).rejection!;
      expect(joint).toBeLessThanOrEqual(at('path:M:Y', n).rejection! + 1e-12);
      expect(joint).toBeLessThanOrEqual(at('path:X:M', n).rejection! + 1e-12);
    }
    expect(at(JOINT_PARAM.key, 60).rejection!).toBeLessThan(0.6);
    expect(at(JOINT_PARAM.key, 400).rejection!).toBeGreaterThan(0.8);
  });

  it('is absent without a plan', () => {
    const plain = summariseMc(
      { ...design, plan: undefined, sampleSizes: [60], replications: 4 },
      mcTasks({ ...design, plan: undefined, sampleSizes: [60], replications: 4 }, 1).map((t) =>
        runMcTask(t),
      ),
    );
    expect(plain.some((r) => r.param.kind === 'joint')).toBe(false);
  });

  it('reports the N needed and writes a methods paragraph', () => {
    const [report] = planReports(rows, design);
    expect(report.hypotheses).toHaveLength(2);
    expect(report.joint?.points.map((p) => p.n)).toEqual([60, 400]);
    expect(report.recommended?.status).toBe('found');
    const text = planMethodsText(design, report);
    expect(text).toContain('Muthén & Muthén, 2002');
    expect(text).toContain('all 2 hypothesised effects to be significant in the same sample');
    expect(text).toContain('estimated by ML');
  });
});

describe('a plan following the model', () => {
  it('is the same design while the model is unchanged', () => {
    const d = planDesign(model, null, null, 'pls');
    expect(syncPlan(d, model, null, null, 'pls')).toBe(d);
  });

  it('takes new indicators, paths and moderations, keeping the values set', () => {
    const bare: ModelState = {
      ...model,
      constructs: model.constructs.map((c) => ({ ...c, indicators: [] as string[] })),
      moderations: [],
    };
    let d = planDesign(bare, null, null, 'pls');
    // The researcher sets X → M to .5 and drops M → Y from the hypotheses.
    d = {
      ...d,
      population: {
        ...d.population,
        paths: d.population.paths.map((p) => (p.from === 'X' ? { ...p, value: 0.5 } : p)),
      },
      plan: { ...d.plan!, focal: d.plan!.focal.filter((k) => k !== 'path:M:Y') },
    };
    // Then adds the indicators, a path X → Y and the moderations on the Model tab.
    const later: ModelState = {
      ...model,
      paths: [...model.paths, { id: 'p4', from: 'X', to: 'Y' }] as never,
    };
    const s = syncPlan(d, later, null, null, 'pls');
    expect(s).not.toBe(d);
    expect(s.population.constructs.find((c) => c.name === 'X')?.indicators).toEqual([
      'x1',
      'x2',
      'x3',
    ]);
    expect(s.population.paths.find((p) => p.from === 'X' && p.to === 'M')?.value).toBe(0.5);
    expect(s.population.interactions).toEqual([{ a: 'X', b: 'W', to: 'M', value: 0.1 }]);
    expect(s.plan!.focal).toContain('path:X:Y');
    expect(s.plan!.focal).toContain('path:X × W:M');
    expect(s.plan!.focal).not.toContain('path:M:Y');
    // (and it settles: nothing more to follow)
    expect(syncPlan(s, later, null, null, 'pls')).toBe(s);
  });

  it('gives a new indicator its construct’s loading', () => {
    let d = planDesign(model, null, null, 'pls');
    d = {
      ...d,
      population: {
        ...d.population,
        constructs: d.population.constructs.map((c) =>
          c.name === 'X' ? { ...c, loadings: [0.6, 0.6, 0.6] } : c,
        ),
      },
    };
    const more: ModelState = {
      ...model,
      constructs: model.constructs.map((c) =>
        c.id === 'X' ? { ...c, indicators: [...c.indicators, 'x4'] } : c,
      ),
    };
    const s = syncPlan(d, more, null, null, 'pls');
    expect(s.population.constructs.find((c) => c.name === 'X')?.loadings).toEqual([
      0.6, 0.6, 0.6, 0.6,
    ]);
  });
});

describe('a moderator without its drawn main effect', () => {
  // W moderates X → M, but only X → M is drawn: W → M is implied, as the estimation model has it.
  const m: ModelState = {
    constructs: [
      k('X', ['x1', 'x2', 'x3']),
      k('W', ['w1', 'w2', 'w3']),
      k('M', ['m1', 'm2', 'm3']),
    ],
    paths: [{ id: 'p1', from: 'X', to: 'M' }] as never,
    moderations: [{ id: 'm1', moderator: 'W', path: 'p1' }],
  };

  it('gets the main effect in the population, not as a hypothesis', () => {
    const d = planDesign(m, null, null, 'pls');
    expect(d.population.paths).toContainEqual({ from: 'W', to: 'M', value: 0.3 });
    expect(planParameters(d)).not.toBeNull();
    expect(d.plan!.focal).toEqual(expect.arrayContaining(['path:X:M', 'path:X × W:M']));
    expect(d.plan!.focal).not.toContain('path:W:M');
  });
});
