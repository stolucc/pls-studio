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
import type { ContingencyResult, FreqTestResult, ReliabilityResult } from '../rengine/tests';
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
    expect(contingencyAnalysis.blocked({ rows: 'g', columns: 'g', counts: '' }, ctx)).toMatch(
      /two different/,
    );
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

describe('agreement of several raters (irr)', () => {
  const t = reliabilityAnalysis;
  const o = { type: 'kripp' as const, vars: ['y', 'x', 'g'] };

  it('keeps Krippendorff’s options from a project file only when valid and not the default', () => {
    expect(t.parseOptions({ ...o, krippLevel: 'interval', bootstrap: 500 })).toEqual({
      ...o,
      krippLevel: 'interval',
      bootstrap: 500,
    });
    expect(t.parseOptions({ ...o, krippLevel: 'nominal' })).toEqual(o);
    expect(t.parseOptions({ ...o, krippLevel: 'cardinal' })).toEqual(o);
    expect(t.parseOptions({ ...o, bootstrap: 1e9 })!.bootstrap).toBe(20000);
    expect(t.parseOptions({ type: 'fleiss', vars: ['y', 'x'] })!.type).toBe('fleiss');
    expect(t.parseOptions({ type: 'kendallw', vars: ['y', 'x'] })!.type).toBe('kendallw');
  });

  it('sends the level, the bootstrap samples and the seed with Krippendorff’s alpha only', () => {
    const settings = { ...DEFAULT_SETTINGS, seed: 7 };
    expect(relInput({ ...o, krippLevel: 'ordinal' }, { settings })).toMatchObject({
      krippLevel: 'ordinal',
      bootstrap: 1000,
      seed: 7,
    });
    const fleiss = relInput({ ...o, type: 'fleiss', bootstrap: 200 }, { settings });
    expect(['krippLevel', 'bootstrap', 'seed'].filter((k) => k in fleiss)).toEqual([]);
  });

  it('refuses 1 to 99 bootstrap samples; the seed matters only with a bootstrap', () => {
    expect(t.blocked({ ...o, bootstrap: 50 }, ctx)).toMatch(/at least 100/);
    expect(t.blocked({ ...o, bootstrap: 0 }, ctx)).toBeNull();
    const seeded = { ...ctx, settings: { ...DEFAULT_SETTINGS, seed: 99 } };
    expect(t.fingerprint(o, seeded)).not.toBe(t.fingerprint(o, ctx));
    const none = { ...o, bootstrap: 0 };
    expect(t.fingerprint(none, seeded)).toBe(t.fingerprint(none, ctx));
    expect(t.fingerprint({ ...o, krippLevel: 'ratio' }, ctx)).not.toBe(t.fingerprint(o, ctx));
  });

  it('shows Fleiss’, Krippendorff’s and Kendall’s tables', () => {
    const base = { vars: ['y', 'x'], n: 30, raters: 2, confidence: 0.95, warnings: [] };
    const engine = { package: 'irr', version: '0.85' };
    const view = (r: object) =>
      renderToStaticMarkup(
        <t.View
          result={{ ...base, engine, ...r } as unknown as ReliabilityResult}
          options={o}
          current
        />,
      );
    const fleiss = view({
      type: 'fleiss',
      fleiss: { kappa: 0.43, z: 17.6, p: 0, exact: 0.442 },
      fleissCategories: [{ category: 'Neurosis', kappa: 0.471, z: 9.99, p: 0 }],
    });
    expect(fleiss).toContain('Conger’s exact κ');
    expect(fleiss).toContain('Neurosis');
    const kripp = view({
      type: 'kripp',
      kripp: {
        alpha: 0.815,
        level: 'ordinal',
        pairable: 40,
        bootstrap: 1000,
        seed: 1,
        ciLow: 0.48,
        ciHigh: 1,
        below667: 0.16,
        below800: 0.45,
      },
    });
    expect(kripp).toContain('Krippendorff’s alpha (ordinal)');
    expect(kripp).toContain('1,000 bootstrap samples of the subjects, seed 1');
    expect(kripp).toContain('[0.480, 1.000]');
    const kendall = view({
      type: 'kendallw',
      kendall: [
        { corrected: false, w: 0.5, chisq: 28.6, df: 19, p: 0.07 },
        { corrected: true, w: 0.54, chisq: 30.8, df: 19, p: 0.04 },
      ],
    });
    expect(kendall).toContain('W, corrected for ties');
  });
});

describe('Gwet’s AC1 / AC2 (irrCAC)', () => {
  const t = reliabilityAnalysis;
  const o = { type: 'gwet' as const, vars: ['y', 'x', 'g'] };

  it('keeps the weights only when valid and not unweighted, and sends them with Gwet only', () => {
    expect(t.parseOptions({ ...o, gwetWeights: 'quadratic' })).toEqual({
      ...o,
      gwetWeights: 'quadratic',
    });
    expect(t.parseOptions({ ...o, gwetWeights: 'unweighted' })).toEqual(o);
    expect(t.parseOptions({ ...o, gwetWeights: 'cubic' })).toEqual(o);
    expect(relInput({ ...o, gwetWeights: 'linear' }, ctx)).toMatchObject({ gwetWeights: 'linear' });
    const kripp = relInput({ ...o, type: 'kripp', gwetWeights: 'linear' }, ctx);
    expect('gwetWeights' in kripp).toBe(false);
    expect(t.fingerprint({ ...o, gwetWeights: 'linear' }, ctx)).not.toBe(t.fingerprint(o, ctx));
  });

  it('shows the coefficient, its standard error and the agreement', () => {
    const result = {
      type: 'gwet',
      vars: ['y', 'x'],
      n: 12,
      raters: 4,
      confidence: 0.95,
      gwet: {
        name: 'AC2',
        weights: 'quadratic',
        value: 0.914,
        pa: 0.975,
        pe: 0.714,
        se: 0.10396,
        ciLow: 0.685,
        ciHigh: 1,
        p: 1e-6,
        ratings: 41,
      },
      warnings: [],
      engine: { package: 'irrCAC', version: '1.4' },
    } as unknown as ReliabilityResult;
    const html = renderToStaticMarkup(<t.View result={result} options={o} current />);
    expect(html).toContain('Gwet’s AC2 (quadratic): 4 raters, 12 subjects');
    expect(html).toContain('Chance agreement');
    expect(html).toContain('p (one-sided)');
  });
});

describe('paired contingency tables (McNemar, Bowker)', () => {
  const t = contingencyAnalysis;
  const o = { rows: 'g', columns: 'h', counts: '' };

  it('keeps `paired` only when true, and it makes the result stale', () => {
    expect(t.parseOptions({ ...o, paired: true })).toEqual({ ...o, paired: true });
    expect(t.parseOptions({ ...o, paired: 'yes' })).toEqual(o);
    expect(t.fingerprint({ ...o, paired: true }, ctx)).not.toBe(t.fingerprint(o, ctx));
  });

  it('shows McNemar’s tests for 2 × 2 and Bowker’s for larger tables', () => {
    const base = {
      rows: 'g',
      columns: 'h',
      rowLevels: ['a', 'b'],
      colLevels: ['a', 'b'],
      counts: [
        [794, 150],
        [86, 570],
      ],
      expected: [
        [500, 400],
        [400, 300],
      ],
      n: 1600,
      chisq: { stat: 1, df: 1, p: 0.3 },
      yates: null,
      likelihoodRatio: { stat: 1, df: 1, p: 0.3 },
      fisher: null,
      cramerV: 0.1,
      phi: null,
      oddsRatio: null,
      confidence: 0.95,
      warnings: [],
      engine: { package: 'stats', version: '4.6.2' },
    };
    const paired = {
      levels: ['a', 'b'],
      counts: base.counts,
      mcnemar: { stat: 17.36, df: 1, p: 3e-5 },
      mcnemarCorrected: { stat: 16.82, df: 1, p: 4e-5 },
      exact: { p: 3.7e-5, b: 150, c: 86 },
      bowker: null,
    };
    const view = (p: object) =>
      renderToStaticMarkup(
        <t.View
          result={{ ...base, paired: p } as unknown as ContingencyResult}
          options={o}
          current
        />,
      );
    const two = view(paired);
    expect(two).toContain('McNemar χ², continuity correction');
    expect(two).toContain('the 150 subjects who moved one way against the 86');
    const three = view({
      ...paired,
      mcnemar: null,
      mcnemarCorrected: null,
      exact: null,
      bowker: { stat: 3, df: 2, p: 0.22 },
    });
    expect(three).toContain('Bowker’s test of symmetry');
    expect(three).not.toContain('McNemar');
  });
});

describe('Cochran’s Q', () => {
  const t = freqTestAnalysis;
  const o = { ...t.defaults(ctx), type: 'cochran' as const, vars: ['y', 'x', 'h'] };

  it('keeps the measures and the adjustment from a project file, and needs two measures', () => {
    expect(t.parseOptions({ ...o, adjust: 'BH' })).toMatchObject({ vars: o.vars, adjust: 'BH' });
    expect('adjust' in t.parseOptions({ ...o, adjust: 'sidak' })!).toBe(false);
    expect(t.blocked({ ...o, vars: ['y'] }, ctx)).toMatch(/at least two binary measures/);
    expect(t.blocked(o, ctx)).toBeNull();
    expect(t.fingerprint({ ...o, adjust: 'bonferroni' }, ctx)).not.toBe(t.fingerprint(o, ctx));
    expect(t.cardTitle!(o)).toBe('Cochran’s Q: y, x, h');
  });

  it('shows the shares, Q and the pairs with the adjustment named', () => {
    const result = {
      type: 'cochran',
      variable: '',
      levels: [],
      counts: [],
      n: 15,
      alternative: 'two.sided',
      confidence: 0.95,
      binomial: null,
      testValue: null,
      multinomial: null,
      vars: ['y', 'x'],
      success: 'yes',
      proportions: [0.8, 0.4],
      cochran: { stat: 8.6, df: 1, p: 0.01 },
      posthoc: [
        {
          comparison: 'y - x',
          b: 6,
          c: 0,
          chisq: 4.17,
          p: 0.04,
          pAdjusted: 0.04,
          pExact: 0.03,
          pExactAdjusted: 0.03,
        },
      ],
      adjust: 'BH',
      warnings: [],
      engine: { package: 'stats', version: '4.6.2' },
    } as unknown as FreqTestResult;
    const html = renderToStaticMarkup(<t.View result={result} options={o} current />);
    expect(html).toContain('Share of “yes”');
    expect(html).toContain('Cochran’s Q test');
    expect(html).toContain('Benjamini–Hochberg');
  });
});
