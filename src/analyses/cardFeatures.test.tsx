// Features added to the basic-statistics and Bayesian cards so that their documented examples can be run: several
// within-subject factors (rmanova, brmanova), kappa of an agreement table with weights, exact p-values for Spearman and
// Kendall, the logistic prior of the Bayesian binomial test, and covariate interactions in the Bayesian ANCOVA.
// Options from files (earlier ones unchanged, fingerprints included), what each card still needs, and the views.
// (Their results: src/examples/cards/basic.webr.test.ts and bayes.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import type {
  BAnovaResult,
  BBinomialResult,
  CorrelationResult,
  ReliabilityResult,
  RmAnovaResult,
} from '../rengine/tests';
import { bayesAnovaAnalysis, bayesBinomialAnalysis, bayesRmAnovaAnalysis } from './bayes';
import { columnsFingerprint } from './common';
import {
  correlationAnalysis,
  parseWeightMatrix,
  reliabilityAnalysis,
  rmAnovaAnalysis,
} from './tests';
import type { AnalysisCtx } from './types';
import {
  cellLabels,
  designColumns,
  parseWithinDesign,
  withinDesignBlocked,
  WithinDesignForm,
} from './withinDesign';

const cols = ['a1b1', 'a1b2', 'a2b1', 'a2b2', 'g', 'r1', 'r2', 'n'];
const data = {
  names: cols,
  cols: cols.map((_, k) => new Float64Array([1, 2, 3, 4].map((v) => v + k))),
  categories: { g: ['x', 'y'] },
};
const ctx = {
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
} as unknown as AnalysisCtx;
const ENGINE = { package: 'stats', version: '4.6.2' };
const TWO = {
  factors: [
    { name: 'A', levels: ['a1', 'a2'] },
    { name: 'B', levels: ['b1', 'b2'] },
  ],
  cells: ['a1b1', 'a1b2', 'a2b1', 'a2b2'],
};

describe('several within-subject factors', () => {
  it('list the cells with the first factor varying slowest', () => {
    expect(
      cellLabels([
        { name: 'phase', levels: ['pre', 'post', 'fup'] },
        { name: 'hour', levels: ['1', '2'] },
      ]).map((k) => k.join('.')),
    ).toEqual(['pre.1', 'pre.2', 'post.1', 'post.2', 'fup.1', 'fup.2']);
  });
  it('leave one-factor options as they were: the same options and the same fingerprint', () => {
    const old = { levels: ['a1b1', 'a1b2'], factorName: 'time', between: 'g' };
    for (const card of [rmAnovaAnalysis, bayesRmAnovaAnalysis]) {
      const o = card.parseOptions(old) as unknown as Record<string, unknown>;
      expect(o.factors, card.id).toBeUndefined();
      expect(o.cells, card.id).toBeUndefined();
      expect(o, card.id).toMatchObject(old);
    }
    expect(rmAnovaAnalysis.parseOptions(old)).toEqual(old);
    expect(rmAnovaAnalysis.fingerprint(old, ctx)).toBe(
      columnsFingerprint(ctx, ['a1b1', 'a1b2', 'g'], ['time', 'g']),
    );
    const b = bayesRmAnovaAnalysis.parseOptions({
      ...old,
      priorFixed: 0.5,
      priorRandom: 1,
      iterations: 10000,
    })!;
    expect(bayesRmAnovaAnalysis.fingerprint(b, ctx)).toBe(
      columnsFingerprint(
        ctx,
        ['a1b1', 'a1b2', 'g'],
        ['time', 'g', 0.5, 1, 10000, DEFAULT_SETTINGS.seed],
      ),
    );
    // (a single factor in `factors` is the one-factor design)
    expect(
      rmAnovaAnalysis.parseOptions({
        ...old,
        factors: [{ name: 'A', levels: ['1', '2'] }],
        cells: ['a1b1'],
      }),
    ).toEqual(old);
  });
  it('parse factors and cells from a file: the cells padded to the design, at most four factors', () => {
    const o = rmAnovaAnalysis.parseOptions({
      levels: [],
      factorName: 'A',
      between: '',
      ...TWO,
      cells: ['a1b1', 7],
    })!;
    expect(o.factors).toEqual(TWO.factors);
    expect(o.cells).toEqual(['a1b1', '', '', '']);
    const five = parseWithinDesign({
      factors: Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, levels: ['1', '2'] })),
      cells: [],
    });
    expect(five.factors).toHaveLength(4);
    expect(five.cells).toHaveLength(16);
    expect(designColumns({ levels: ['x'], factorName: 'A', between: 'g', ...TWO })).toEqual([
      ...TWO.cells,
      'g',
    ]);
  });
  it('say what the design still needs', () => {
    const o = { levels: [], factorName: 'A', between: '', ...TWO };
    expect(rmAnovaAnalysis.blocked(o, ctx)).toBeNull();
    expect(rmAnovaAnalysis.blocked({ ...o, between: 'g' }, ctx)).toBeNull();
    expect(rmAnovaAnalysis.blocked({ ...o, cells: ['a1b1', '', 'a2b1', 'a2b2'] }, ctx)).toMatch(
      /every cell/,
    );
    expect(rmAnovaAnalysis.blocked({ ...o, cells: ['a1b1', 'a1b1', 'a2b1', 'a2b2'] }, ctx)).toMatch(
      /own column/,
    );
    expect(
      rmAnovaAnalysis.blocked(
        { ...o, factors: [TWO.factors[0], { name: 'A', levels: ['b1', 'b2'] }] },
        ctx,
      ),
    ).toMatch(/different names/);
    expect(
      rmAnovaAnalysis.blocked(
        { ...o, factors: [TWO.factors[0], { name: 'subject', levels: ['b1', 'b2'] }] },
        ctx,
      ),
    ).toMatch(/not be subject/);
    expect(
      rmAnovaAnalysis.blocked(
        { ...o, factors: [TWO.factors[0], { name: 'B', levels: ['b1', ''] }] },
        ctx,
      ),
    ).toMatch(/its own name/);
    expect(
      rmAnovaAnalysis.blocked(
        {
          ...o,
          factors: [TWO.factors[0], { name: 'B', levels: ['b1', 'b2', 'b3'] }],
          cells: [...TWO.cells, '', ''],
        },
        ctx,
      ),
    ).toMatch(/every cell/);
    expect(rmAnovaAnalysis.blocked({ ...o, between: 'a1b1' }, ctx)).toMatch(/between factor/);
    expect(rmAnovaAnalysis.blocked({ ...o, cells: ['a1b1', 'a1b2', 'a2b1', 'gone'] }, ctx)).toMatch(
      /gone/,
    );
    expect(withinDesignBlocked({ levels: ['x'], factorName: 'A', between: '' })).toMatch(
      /two columns/,
    );
    expect(
      bayesRmAnovaAnalysis.blocked({ ...bayesRmAnovaAnalysis.defaults(ctx), ...o }, ctx),
    ).toBeNull();
    expect(
      bayesRmAnovaAnalysis.blocked(
        { ...bayesRmAnovaAnalysis.defaults(ctx), ...o, cells: ['a1b1'] },
        ctx,
      ),
    ).toMatch(/every cell/);
  });
  it('rerun when a factor, level or cell changes', () => {
    const o = { levels: [], factorName: 'A', between: '', ...TWO };
    const f = rmAnovaAnalysis.fingerprint(o, ctx);
    expect(
      rmAnovaAnalysis.fingerprint({ ...o, cells: ['a1b2', 'a1b1', 'a2b1', 'a2b2'] }, ctx),
    ).not.toBe(f);
    expect(
      rmAnovaAnalysis.fingerprint(
        { ...o, factors: [TWO.factors[0], { name: 'B', levels: ['x', 'y'] }] },
        ctx,
      ),
    ).not.toBe(f);
    expect(rmAnovaAnalysis.summary!(o)).toBe('A × B: 4 cells');
    expect(rmAnovaAnalysis.cardTitle!(o)).toBe('Repeated-measures ANOVA: A × B');
  });
  it('show the factors, their levels and a column per cell in the form', () => {
    const html = renderToStaticMarkup(
      <WithinDesignForm
        id="t"
        o={{ levels: [], factorName: 'A', between: '', ...TWO }}
        set={() => {}}
        numeric={cols}
      />,
    );
    expect(html).toContain('A = a1, B = b2');
    expect(html).toContain('value="a1, a2"');
    expect(
      renderToStaticMarkup(
        <WithinDesignForm
          id="t"
          o={{ levels: [], factorName: 'A', between: '' }}
          set={() => {}}
          numeric={cols}
        />,
      ),
    ).toContain('Add a within-subject factor');
  });
  it('show each effect’s stratum, sphericity and corrections', () => {
    const r: RmAnovaResult = {
      factorName: 'A × B',
      levels: TWO.cells,
      between: '',
      n: 4,
      factors: TWO.factors,
      within: [
        { term: 'A', stratum: 'A', ss: 1, df: 1, ms: 1, f: 2, p: 0.2 },
        { term: 'Residuals', stratum: 'A', ss: 3, df: 3, ms: 1 },
        { term: 'A × B', stratum: 'A × B', ss: 1, df: 1, ms: 1, f: 2, p: 0.2 },
        { term: 'Residuals', stratum: 'A × B', ss: 3, df: 3, ms: 1 },
      ],
      betweenTable: [{ term: 'Residuals', stratum: 'subject', ss: 5, df: 3, ms: 1.7 }],
      sphericity: null,
      sphericityTable: [],
      corrected: [{ term: 'A', p: 0.2, pGG: 0.2, pHF: 0.2 }],
      friedman: null,
      posthoc: [],
      cells: [],
      warnings: [],
      engine: ENGINE,
    };
    const html = renderToStaticMarkup(
      <rmAnovaAnalysis.View
        result={r}
        options={{ levels: [], factorName: 'A', between: '', ...TWO }}
        current
      />,
    );
    expect(html).toContain('Residuals (A × B)');
    expect(html).toContain('A (2 levels) × B (2 levels): 4 cells');
    expect(html).toContain('sphericity holds');
    const three = renderToStaticMarkup(
      <rmAnovaAnalysis.View
        result={{
          ...r,
          sphericityTable: [{ term: 'A', df: 2, w: 0.85, p: 0.38, gg: 0.87, hf: 0.99 }],
        }}
        options={{ levels: [], factorName: 'A', between: '', ...TWO }}
        current
      />,
    );
    expect(three).toContain('Mauchly’s W');
    expect(three).toContain('Effects with one degree of freedom');
  });
});

describe('Cohen’s kappa of an agreement table', () => {
  it('leaves earlier reliability options and fingerprints as they were', () => {
    const old = { type: 'kappa', vars: ['r1', 'r2'] };
    expect(reliabilityAnalysis.parseOptions(old)).toEqual(old);
    expect(reliabilityAnalysis.fingerprint(old as never, ctx)).toBe(
      columnsFingerprint(ctx, ['r1', 'r2'], ['kappa', DEFAULT_SETTINGS.confidence]),
    );
  });
  it('parses the table, the number of subjects and the weights', () => {
    const o = reliabilityAnalysis.parseOptions({
      type: 'kappa',
      vars: [],
      kappaTable: { rows: 'r1', columns: 'r2', counts: 'n', nObs: 200 },
      kappaWeights: 'custom',
      weightMatrix: [
        [0, 1],
        [1, 'x'],
      ],
    })!;
    expect(o).toEqual({
      type: 'kappa',
      vars: [],
      kappaTable: { rows: 'r1', columns: 'r2', counts: 'n', nObs: 200 },
      kappaWeights: 'custom',
      weightMatrix: [
        [0, 1],
        [1, NaN],
      ],
    });
    expect(
      reliabilityAnalysis.parseOptions({
        type: 'kappa',
        vars: [],
        kappaTable: { rows: 'r1', columns: 'r2', counts: '', nObs: -3 },
        kappaWeights: 'cubic',
      }),
    ).toEqual({ type: 'kappa', vars: [], kappaTable: { rows: 'r1', columns: 'r2', counts: '' } });
    expect(
      reliabilityAnalysis.parseOptions({ type: 'kappa', vars: [], kappaWeights: 'linear' }),
    ).toEqual({ type: 'kappa', vars: [], kappaWeights: 'linear' });
    expect(parseWeightMatrix('0 1 3\n1, 0, 6;3 6 0\n')).toEqual([
      [0, 1, 3],
      [1, 0, 6],
      [3, 6, 0],
    ]);
  });
  it('says what it still needs, and reruns when the table or the weights change', () => {
    const t = {
      type: 'kappa' as const,
      vars: [],
      kappaTable: { rows: 'r1', columns: 'r2', counts: 'n' },
    };
    expect(reliabilityAnalysis.blocked(t, ctx)).toBeNull();
    expect(
      reliabilityAnalysis.blocked({ ...t, kappaTable: { ...t.kappaTable, columns: '' } }, ctx),
    ).toMatch(/two raters/);
    expect(
      reliabilityAnalysis.blocked({ ...t, kappaTable: { ...t.kappaTable, columns: 'r1' } }, ctx),
    ).toMatch(/two different/);
    expect(
      reliabilityAnalysis.blocked({ ...t, kappaTable: { ...t.kappaTable, counts: 'gone' } }, ctx),
    ).toMatch(/gone/);
    expect(
      reliabilityAnalysis.blocked(
        { ...t, kappaWeights: 'custom', weightMatrix: [[0, 1], [1]] },
        ctx,
      ),
    ).toMatch(/square matrix/);
    expect(
      reliabilityAnalysis.blocked(
        {
          ...t,
          kappaWeights: 'custom',
          weightMatrix: [
            [0, 1],
            [1, 0],
          ],
        },
        ctx,
      ),
    ).toBeNull();
    const f = reliabilityAnalysis.fingerprint(t, ctx);
    expect(
      reliabilityAnalysis.fingerprint({ ...t, kappaTable: { ...t.kappaTable, nObs: 200 } }, ctx),
    ).not.toBe(f);
    expect(reliabilityAnalysis.fingerprint({ ...t, kappaWeights: 'linear' }, ctx)).not.toBe(f);
    expect(reliabilityAnalysis.summary!(t)).toBe('cohen’s kappa · table r1 × r2');
  });
  it('shows the weights and the agreement table', () => {
    const r: ReliabilityResult = {
      type: 'kappa',
      vars: ['r1', 'r2'],
      n: 200,
      confidence: 0.95,
      table: true,
      kappa: { est: 0.49, ciLow: 0.39, ciHigh: 0.59 },
      weighted: { est: 0.35, ciLow: 0.2, ciHigh: 0.5 },
      categories: 2,
      weights: 'custom',
      levels: ['1', '2'],
      counts: [
        [100, 20],
        [30, 50],
      ],
      warnings: [],
      engine: { package: 'psych', version: '2.6.9' },
    };
    const html = renderToStaticMarkup(
      <reliabilityAnalysis.View result={r} options={{ type: 'kappa', vars: [] }} current />,
    );
    expect(html).toContain('Weighted κ (the given weights)');
    expect(html).toContain('Agreement table');
    expect(html).toContain('Scaled to the 200 subjects');
  });
});

describe('exact p-values for Spearman and Kendall', () => {
  it('are an option kept only when chosen; earlier options and fingerprints are unchanged', () => {
    const old = {
      vars: ['r1', 'r2'],
      method: 'kendall',
      alternative: 'greater',
      deletion: 'pairwise',
    };
    expect(correlationAnalysis.parseOptions(old)).toEqual(old);
    expect(correlationAnalysis.parseOptions({ ...old, exact: 'yes' })).toEqual(old);
    expect(correlationAnalysis.parseOptions({ ...old, exact: true })).toEqual({
      ...old,
      exact: true,
    });
    const o = correlationAnalysis.parseOptions(old)!;
    expect(correlationAnalysis.fingerprint(o, ctx)).toBe(
      columnsFingerprint(
        ctx,
        ['r1', 'r2'],
        ['kendall', 'greater', 'pairwise', DEFAULT_SETTINGS.confidence],
      ),
    );
    expect(correlationAnalysis.fingerprint({ ...o, exact: true }, ctx)).not.toBe(
      correlationAnalysis.fingerprint(o, ctx),
    );
    // (Pearson has no exact option: the flag changes nothing)
    expect(correlationAnalysis.fingerprint({ ...o, method: 'pearson', exact: true }, ctx)).toBe(
      correlationAnalysis.fingerprint({ ...o, method: 'pearson' }, ctx),
    );
    expect(correlationAnalysis.summary!({ ...o, exact: true })).toBe('Kendall (exact p) · r1, r2');
  });
  it('show the statistic and mark the pairs that kept the approximation', () => {
    const r: CorrelationResult = {
      method: 'kendall',
      alternative: 'greater',
      confidence: 0.95,
      deletion: 'pairwise',
      vars: ['r1', 'r2', 'n'],
      exact: true,
      pairs: [
        { a: 'r1', b: 'r2', r: 0.44, p: 0.0597, n: 9, stat: 26, exact: true },
        { a: 'r1', b: 'n', r: 0.2, p: 0.3, n: 9, stat: 0.8, exact: false },
        { a: 'r2', b: 'n', r: 0.1, p: 0.4, n: 9, stat: 20, exact: true },
      ],
      warnings: [],
      engine: ENGINE,
    };
    const html = renderToStaticMarkup(
      <correlationAnalysis.View
        result={r}
        options={{
          vars: [],
          method: 'kendall',
          alternative: 'greater',
          deletion: 'pairwise',
          exact: true,
        }}
        current
      />,
    );
    expect(html).toContain('p (exact)');
    expect(html).toContain('(approx.)');
    expect(html).toContain('Exact p-values');
  });
});

describe('the Bayesian binomial test’s logistic prior', () => {
  it('is an option beside the beta prior; earlier options and fingerprints are unchanged', () => {
    const old = { variable: 'g', testValue: 0.75, alternative: 'two.sided', priorA: 1, priorB: 1 };
    expect(bayesBinomialAnalysis.parseOptions(old)).toEqual(old);
    expect(bayesBinomialAnalysis.fingerprint(old as never, ctx)).toBe(
      columnsFingerprint(ctx, ['g'], [0.75, 'two.sided', 1, 1, DEFAULT_SETTINGS.confidence]),
    );
    const l = bayesBinomialAnalysis.parseOptions({ ...old, prior: 'logistic', priorScale: -1 })!;
    expect(l).toEqual({ ...old, prior: 'logistic', priorScale: 0.5, iterations: 10000 });
    expect(bayesBinomialAnalysis.parseOptions({ ...old, prior: 'cauchy', priorScale: 2 })).toEqual(
      old,
    );
    const f = bayesBinomialAnalysis.fingerprint(l, ctx);
    expect(f).not.toBe(bayesBinomialAnalysis.fingerprint(old as never, ctx));
    expect(
      bayesBinomialAnalysis.fingerprint(l, { ...ctx, settings: { ...DEFAULT_SETTINGS, seed: 99 } }),
    ).not.toBe(f);
    expect(bayesBinomialAnalysis.fingerprint({ ...l, priorScale: 1 }, ctx)).not.toBe(f);
    expect(bayesBinomialAnalysis.summary!(l)).toBe('g vs 0.75 · logistic prior, r = 0.500');
  });
  it('shows the prior it used', () => {
    const r: BBinomialResult = {
      variable: 'g',
      levels: ['x', 'y'],
      counts: [15, 10],
      n: 25,
      alternative: 'two.sided',
      testValue: 0.5,
      priorA: 1,
      priorB: 1,
      confidence: 0.95,
      prior: 'logistic',
      priorScale: 0.5,
      seed: 1,
      iterations: 10000,
      rows: [
        { bf10: 0.66, median: 0.58, low: 0.41, high: 0.74 },
        { bf10: 0.66, median: 0.42, low: 0.26, high: 0.59 },
      ],
      warnings: [],
      engine: { package: 'BayesFactor', version: '0.9.12-4.8' },
    };
    const html = renderToStaticMarkup(
      <bayesBinomialAnalysis.View
        result={r}
        options={{
          variable: 'g',
          testValue: 0.5,
          alternative: 'two.sided',
          priorA: 1,
          priorB: 1,
          prior: 'logistic',
        }}
        current
      />,
    );
    expect(html).toContain('Logistic prior on the log odds');
    expect(html).toContain('proportionBF');
  });
});

describe('Bayesian ANCOVA with covariate interactions', () => {
  it('is an option kept only when chosen; earlier fingerprints are unchanged', () => {
    const old = {
      dependent: 'r1',
      factors: ['g'],
      covariates: ['n'],
      interactions: true,
      priorFixed: 0.5,
      priorCovariates: Math.SQRT2 / 4,
      iterations: 10000,
    };
    expect(bayesAnovaAnalysis.parseOptions(old)).toEqual(old);
    expect(bayesAnovaAnalysis.parseOptions({ ...old, covariateInteractions: true })).toEqual({
      ...old,
      covariateInteractions: true,
    });
    expect(bayesAnovaAnalysis.fingerprint(old, ctx)).toBe(
      columnsFingerprint(
        ctx,
        ['r1', 'g', 'n'],
        ['true', 0.5, Math.SQRT2 / 4, 10000, 'g', '|', 'n', DEFAULT_SETTINGS.seed],
      ),
    );
    expect(bayesAnovaAnalysis.fingerprint({ ...old, covariateInteractions: true }, ctx)).not.toBe(
      bayesAnovaAnalysis.fingerprint(old, ctx),
    );
    // (without interactions, or without covariates, the option changes nothing)
    expect(
      bayesAnovaAnalysis.fingerprint(
        { ...old, interactions: false, covariateInteractions: true },
        ctx,
      ),
    ).toBe(bayesAnovaAnalysis.fingerprint({ ...old, interactions: false }, ctx));
    expect(bayesAnovaAnalysis.summary!({ ...old, covariateInteractions: true })).toBe(
      'r1 by g × n',
    );
  });
  it('says so in the view', () => {
    const r: BAnovaResult = {
      dependent: 'r1',
      factors: ['g'],
      covariates: ['n'],
      covariateInteractions: true,
      n: 4,
      priorFixed: 0.5,
      priorCovariates: 0.354,
      seed: 1,
      iterations: 10000,
      models: [
        { model: 'Null model', terms: [], bf10: 1, error: 0, prior: 0.5, posterior: 0.5, bfM: 1 },
        { model: 'g', terms: ['g'], bf10: 1, error: 0, prior: 0.5, posterior: 0.5, bfM: 1 },
      ],
      effects: [],
      warnings: [],
      engine: { package: 'BayesFactor', version: '0.9.12-4.8' },
    };
    expect(
      renderToStaticMarkup(
        <bayesAnovaAnalysis.View result={r} options={bayesAnovaAnalysis.defaults(ctx)} current />,
      ),
    ).toContain('with the covariates’ interactions');
  });
});
