// The basic-statistics cards: options survive a project file, bad values are
// replaced, and each card says what it still needs before it can run.
// (Their results against base R: src/rengine/tests.webr.test.ts.)

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { ANALYSIS_TYPES } from './registry';
import {
  anovaAnalysis,
  BAYESREL_ITERATIONS,
  contingencyAnalysis,
  correlationAnalysis,
  freqTestAnalysis,
  manovaAnalysis,
  relInput,
  reliabilityAnalysis,
  rmAnovaAnalysis,
  ttestAnalysis,
} from './tests';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReliabilityResult } from '../rengine/tests';
import type { AnalysisCtx } from './types';

const data = {
  names: ['y', 'x', 'g', 'h'],
  cols: [
    new Float64Array([1, 2, 3, 4]),
    new Float64Array([2, 3, 4, 6]),
    new Float64Array([1, 1, 2, 2]),
    new Float64Array([1, 2, 1, 2]),
  ],
  categories: { g: ['a', 'b'] },
};
const ctx = {
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
} as unknown as AnalysisCtx;

describe('basic-statistics cards', () => {
  it('are in the Add menu under Basic statistics, before regression', () => {
    const ids = ANALYSIS_TYPES.map((t) => t.id);
    for (const id of [
      'ttest',
      'anova',
      'rmanova',
      'manova',
      'correlation',
      'contingency',
      'freqtest',
      'reliability',
    ]) {
      expect(ids, id).toContain(id);
      expect(ANALYSIS_TYPES.find((t) => t.id === id)!.group).toBe('Basic statistics');
      expect(ids.indexOf(id)).toBeLessThan(ids.indexOf('regression'));
    }
  });
  it('parse their options from a file, replacing invalid values', () => {
    const t = ttestAnalysis.parseOptions({
      type: 'paired',
      pairs: [['y', 'x'], 'junk'],
      alternative: 'sideways',
      testValue: 'NaN',
      student: false,
      rank: true,
    })!;
    expect(t).toMatchObject({
      type: 'paired',
      pairs: [['y', 'x']],
      alternative: 'two.sided',
      testValue: 0,
      student: false,
      rank: true,
      welch: false,
    });
    expect(
      anovaAnalysis.parseOptions({ dependent: 'y', factors: ['g'], ssType: 'II' }),
    ).toMatchObject({ ssType: 'III', interactions: true });
    expect(rmAnovaAnalysis.parseOptions({ levels: ['y', 'x'], factorName: '' })).toMatchObject({
      factorName: 'condition',
    });
    expect(
      correlationAnalysis.parseOptions({ vars: ['y', 'x'], method: 'distance' }),
    ).toMatchObject({ method: 'pearson', deletion: 'pairwise' });
    expect(
      freqTestAnalysis.parseOptions({
        type: 'multinomial',
        variable: 'g',
        proportions: [1, -1, 'x', 2],
        testValue: 2,
      }),
    ).toMatchObject({ proportions: [1, 2], testValue: 0.5 });
    expect(reliabilityAnalysis.parseOptions({ type: 'cronbach', vars: ['y', 'x'] })).toEqual({
      type: 'scale',
      vars: ['y', 'x'],
    });
    for (const a of [
      ttestAnalysis,
      anovaAnalysis,
      rmAnovaAnalysis,
      manovaAnalysis,
      correlationAnalysis,
      contingencyAnalysis,
      freqTestAnalysis,
      reliabilityAnalysis,
    ]) {
      expect(a.parseOptions(null), a.id).toBeNull();
      expect(a.parseOptions(a.defaults(ctx)), a.id).toEqual(a.defaults(ctx));
    }
  });
  it('say what they still need, and run when complete', () => {
    const tt = ttestAnalysis.defaults(ctx);
    expect(ttestAnalysis.blocked(tt, ctx)).toMatch(/at least one variable/);
    expect(ttestAnalysis.blocked({ ...tt, vars: ['y'] }, ctx)).toMatch(/grouping variable/);
    expect(ttestAnalysis.blocked({ ...tt, vars: ['y'], group: 'g' }, ctx)).toBeNull();
    expect(ttestAnalysis.blocked({ ...tt, type: 'paired', pairs: [['y', 'y']] }, ctx)).toMatch(
      /two different/,
    );
    expect(
      ttestAnalysis.blocked(
        { ...tt, vars: ['y'], group: 'g', student: false, welch: false, rank: false },
        ctx,
      ),
    ).toMatch(/at least one test/);
    expect(anovaAnalysis.blocked({ ...anovaAnalysis.defaults(ctx), dependent: 'y' }, ctx)).toMatch(
      /factor/,
    );
    expect(
      anovaAnalysis.blocked(
        { ...anovaAnalysis.defaults(ctx), dependent: 'y', factors: ['g'], covariates: ['x'] },
        ctx,
      ),
    ).toBeNull();
    expect(
      rmAnovaAnalysis.blocked({ levels: ['y', 'x'], factorName: '1bad', between: '' }, ctx),
    ).toMatch(/start with a letter/);
    expect(
      rmAnovaAnalysis.blocked({ levels: ['y', 'x'], factorName: 'time', between: 'g' }, ctx),
    ).toBeNull();
    expect(
      manovaAnalysis.blocked({ dependents: ['y'], factors: ['g'], interactions: true }, ctx),
    ).toMatch(/two dependent/);
    expect(
      correlationAnalysis.blocked(
        { ...correlationAnalysis.defaults(ctx), vars: ['y', 'gone'] },
        ctx,
      ),
    ).toMatch(/gone/);
    expect(
      contingencyAnalysis.blocked({ rows: 'g', columns: 'g', counts: '', effectSizes: false }, ctx),
    ).toMatch(/two different/);
    expect(
      freqTestAnalysis.blocked({ ...freqTestAnalysis.defaults(ctx), variable: 'g' }, ctx),
    ).toBeNull();
    expect(reliabilityAnalysis.blocked({ type: 'kappa', vars: ['y', 'x', 'h'] }, ctx)).toMatch(
      /exactly two/,
    );
    expect(reliabilityAnalysis.blocked({ type: 'scale', vars: ['y'] }, ctx)).toMatch(
      /at least two/,
    );
    expect(reliabilityAnalysis.blocked({ type: 'icc', vars: ['y', 'x', 'h'] }, ctx)).toBeNull();
  });
  it('change their fingerprint with the options that change the result', () => {
    const o = { ...correlationAnalysis.defaults(ctx), vars: ['y', 'x'] };
    expect(correlationAnalysis.fingerprint(o, ctx)).not.toBe(
      correlationAnalysis.fingerprint({ ...o, method: 'kendall' }, ctx),
    );
    expect(correlationAnalysis.fingerprint(o, ctx)).not.toBe(
      correlationAnalysis.fingerprint(o, {
        ...ctx,
        settings: { ...DEFAULT_SETTINGS, confidence: 0.9 },
      }),
    );
  });
});

describe('Bayesian scale reliability (Bayesrel)', () => {
  const t = reliabilityAnalysis;
  const o = { type: 'scale' as const, vars: ['y', 'x', 'h'], bayes: true as const };

  it('keeps the options from a project file only when valid', () => {
    expect(t.parseOptions({ ...o, bayesGlb: true, iterations: 2000 })).toEqual({
      ...o,
      bayesGlb: true,
      iterations: 2000,
    });
    expect(t.parseOptions({ ...o, iterations: 5 })!.iterations).toBe(100);
    expect(t.parseOptions({ ...o, iterations: '2000' })!.iterations).toBe(BAYESREL_ITERATIONS);
    const plain = t.parseOptions({ type: 'scale', vars: ['y', 'x'], bayes: 'yes', bayesGlb: 1 })!;
    expect(['bayes', 'bayesGlb', 'iterations'].filter((k) => k in plain)).toEqual([]);
  });

  it('sends the seed of the settings and the iterations with the scale analysis only', () => {
    expect(relInput(o, { settings: { ...DEFAULT_SETTINGS, seed: 7 } })).toMatchObject({
      bayes: true,
      iterations: 1000,
      seed: 7,
    });
    expect('bayesGlb' in relInput(o, ctx)).toBe(false);
    expect(relInput({ ...o, bayesGlb: true }, ctx)).toMatchObject({ bayesGlb: true });
    const icc = relInput({ ...o, type: 'icc' }, ctx);
    expect(['bayes', 'seed', 'iterations'].filter((k) => k in icc)).toEqual([]);
  });

  it('needs three items, and a new seed or more iterations make the result stale', () => {
    expect(t.blocked({ ...o, vars: ['y', 'x'] }, ctx)).toMatch(/at least three items/);
    expect(t.blocked(o, ctx)).toBeNull();
    const f = t.fingerprint(o, ctx);
    expect(t.fingerprint(o, { ...ctx, settings: { ...DEFAULT_SETTINGS, seed: 99 } })).not.toBe(f);
    expect(t.fingerprint({ ...o, iterations: 2000 }, ctx)).not.toBe(f);
    expect(t.fingerprint({ ...o, bayesGlb: true }, ctx)).not.toBe(f);
    // Without the Bayesian estimates the seed does not matter.
    const plain = { type: 'scale' as const, vars: ['y', 'x', 'h'] };
    expect(t.fingerprint(plain, { ...ctx, settings: { ...DEFAULT_SETTINGS, seed: 99 } })).toBe(
      t.fingerprint(plain, ctx),
    );
  });

  it('shows the posterior means, credible intervals and convergence with the source', () => {
    const result = {
      type: 'scale',
      vars: ['y', 'x', 'h'],
      n: 78,
      confidence: 0.95,
      alpha: 0.8,
      items: [],
      bayes: {
        estimates: [
          { estimate: 'alpha', mean: 0.786, low: 0.714, high: 0.857, rhat: 1.0001, ess: 2800 },
          { estimate: 'omega', mean: 0.774, low: 0.696, high: 0.852, rhat: 1.05, ess: 300 },
        ],
        interval: 0.95,
        iterations: 1000,
        burnin: 50,
        chains: 3,
        seed: 1,
        version: '0.8.0',
      },
      warnings: [],
      engine: { package: 'psych', version: '2.6.9' },
    } as unknown as ReliabilityResult;
    const html = renderToStaticMarkup(<t.View result={result} options={o} current />);
    expect(html).toContain('Bayesian reliability (posterior)');
    expect(html).toContain('95% credible interval');
    expect(html).toContain('McDonald’s ω (one factor)');
    expect(html).toContain('Bayesrel 0.8.0 (strel): 3 chains of 1,000 iterations');
    expect(html).toContain('Multivariate Behavioral Research, 57(4)');
    expect(html).toMatch(/class="num bad"[^>]*>1\.050/);
  });
});

describe('effect sizes and equivalence tests of the basic cards', () => {
  it('are off in projects from before them, on for new cards, and keep their fingerprint when off', () => {
    const old = ttestAnalysis.parseOptions({ type: 'independent', vars: ['y'], group: 'g' })!;
    expect(old.effectSizes).toBe(false);
    expect(old.tost).toBe(false);
    expect(ttestAnalysis.defaults(ctx).effectSizes).toBe(true);
    expect(anovaAnalysis.parseOptions({ dependent: 'y', factors: ['g'] })!.effectSizes).toBe(false);
    expect(anovaAnalysis.defaults(ctx).effectSizes).toBe(true);
    expect(contingencyAnalysis.parseOptions({ rows: 'g', columns: 'h' })!.effectSizes).toBe(false);
    expect(contingencyAnalysis.defaults(ctx).effectSizes).toBe(true);
    const cor = correlationAnalysis.parseOptions({ vars: ['y', 'x'] })!;
    expect(cor.tost).toBeUndefined();
    // (an option that is off adds nothing to the fingerprint: old cards stay current)
    const t = { ...old, tostLow: -9 };
    expect(ttestAnalysis.fingerprint(t, ctx)).toBe(ttestAnalysis.fingerprint(old, ctx));
    expect(ttestAnalysis.fingerprint({ ...old, effectSizes: true }, ctx)).not.toBe(
      ttestAnalysis.fingerprint(old, ctx),
    );
  });
  it('validate equivalence bounds from a file and say when they are unusable', () => {
    const o = ttestAnalysis.parseOptions({
      type: 'one',
      vars: ['y'],
      tost: true,
      tostLow: 'x',
      tostHigh: Infinity,
      tostUnits: 'cohen',
    })!;
    expect([o.tost, o.tostLow, o.tostHigh, o.tostUnits]).toEqual([true, -0.5, 0.5, 'smd']);
    expect(ttestAnalysis.blocked({ ...o, tostLow: 1, tostHigh: 1 }, ctx)).toMatch(
      /lower equivalence bound/,
    );
    expect(ttestAnalysis.blocked(o, ctx)).toBeNull();
    const c = correlationAnalysis.parseOptions({ vars: ['y', 'x'], tost: true, tostBound: 7 })!;
    expect(c.tostBound).toBe(0.99);
    expect(correlationAnalysis.summary(c)).toMatch(/TOST/);
    expect(correlationAnalysis.summary({ ...c, method: 'polychoric' })).not.toMatch(/TOST/);
  });
  it('show the effect sizes with their intervals, open ends of one-sided ones as infinity', () => {
    const row = {
      label: 'y',
      variables: ['y'],
      student: { stat: 2, df: 10, p: 0.07, ciLow: -0.1, ciHigh: 1 },
      welch: null,
      rank: null,
      d: 0.5,
      levene: null,
      shapiro: [null],
      descriptives: [{ n: 11, mean: 1, sd: 1, se: 0.3, median: 1 }],
      effects: [
        { id: 'd', est: 0.5, ciLow: 0.1, ciHigh: null },
        { id: 'g', est: 0.48, ciLow: 0.09, ciHigh: null },
      ],
      tost: {
        lower: { t: 3, df: 10, p: 0.01 },
        upper: { t: -2.5, df: 10, p: 0.02 },
        p: 0.02,
        low: -1,
        high: 1,
        lowSmd: -1,
        highSmd: 1,
        raw: { label: 'Raw', est: 0.2, ciLow: -0.3, ciHigh: 0.7 },
        smd: { label: 'Hedges’s g', est: 0.19, ciLow: -0.3, ciHigh: 0.6 },
        level: 0.9,
      },
    };
    const html = renderToStaticMarkup(
      <ttestAnalysis.View
        result={{
          type: 'one',
          alternative: 'greater',
          testValue: 0,
          confidence: 0.95,
          groups: null,
          rows: [row],
          warnings: [],
          engine: { package: 'stats', version: '4.6.2' },
        }}
        options={ttestAnalysis.defaults(ctx)}
        current
      />,
    );
    expect(html).toContain('Effect sizes');
    expect(html).toContain('[0.100, ∞]');
    expect(html).toContain('One-sided intervals (greater)');
    expect(html).toContain('Equivalence test (TOST)');
    expect(html).toContain('equivalent');
  });
  it('show ANOVA effect sizes by term and Kruskal–Wallis ε²', () => {
    const e = { est: 0.2, ciLow: 0.05, ciHigh: 0.4 };
    const html = renderToStaticMarkup(
      <anovaAnalysis.View
        result={{
          dependent: 'y',
          factors: ['g'],
          covariates: [],
          ssType: 'III',
          formula: 'y ~ g',
          table: [
            {
              term: 'g',
              ss: 1,
              df: 1,
              ms: 1,
              f: 4,
              p: 0.1,
              eta2: 0.2,
              partialEta2: 0.2,
              omega2: 0.1,
            },
          ],
          residual: { ss: 4, df: 2, ms: 2 },
          n: 4,
          levene: { stat: 1, df1: 1, df2: 2, p: 0.4 },
          shapiro: null,
          welch: null,
          kruskal: { stat: 2, df: 1, p: 0.15 },
          tukey: null,
          cells: [],
          effects: [{ term: 'g', eta2: e, partialEta2: e, omega2: e, partialOmega2: e }],
          epsilon2: { id: 'epsilon2', est: 0.3, ciLow: 0.1, ciHigh: 0.6 },
          warnings: [],
          engine: { package: 'stats', version: '4.6.2' },
          confidence: 0.95,
        }}
        options={anovaAnalysis.defaults(ctx)}
        current
      />,
    );
    expect(html).toContain('Partial ω²');
    expect(html).toContain('0.200 [0.050, 0.400]');
    expect(html).toContain('Rank ε²');
    expect(html).toContain('type III sums of squares η² and ω² divide');
  });
});
