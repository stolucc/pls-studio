// The basic tests (R/tests.R) in webR against direct base-R calls on the same
// data (scripts/validation/tests.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { near } from '../validation/record';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';
import { slowIt } from './webrSlow';
import { rCall } from './bridge';
import {
  anovaR,
  contingencyR,
  correlationR,
  freqTestR,
  manovaR,
  reliabilityR,
  rmAnovaR,
  ttestR,
  type TTestInput,
} from './tests';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Frame = { names: string[]; cols: number[][]; categories: Record<string, string[]> };
const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'tests', 'reference.json'), 'utf8'),
) as Record<string, any>;
const data = (f: Frame): Dataset => ({
  names: f.names,
  cols: f.cols.map((c) => Float64Array.from(c)),
  ...(Object.keys(f.categories ?? {}).length ? { categories: f.categories } : {}),
});
const close = (a: number | null | undefined, b: number, what: string) =>
  near(what, a ?? NaN, b, 1e-8 * Math.max(1, Math.abs(b)));
const T: Omit<TTestInput, 'type' | 'vars'> = {
  pairs: [],
  group: '',
  testValue: 0,
  student: true,
  welch: false,
  rank: true,
  alternative: 'two.sided',
  confidence: 0.95,
};

describe('t-tests', () => {
  it('independent samples: Student, Welch, Mann-Whitney, Cohen’s d, Levene', async () => {
    const r = await ttestR(data(ref.toothgrowth), {
      ...T,
      type: 'independent',
      vars: ['len'],
      group: 'supp',
      welch: true,
    });
    const w = ref.ttestIndependent,
      row = r.rows[0];
    expect(r.groups).toEqual(['OJ', 'VC']);
    close(row.student!.stat, w.student.stat, 'Student t');
    close(row.student!.p, w.student.p, 'Student p');
    close(row.student!.ciLow, w.student.ciLow, 'CI');
    close(row.welch!.stat, w.welch.stat, 'Welch t');
    close(row.welch!.df as number, w.welch.df, 'Welch df');
    close(row.rank!.stat, w.rank.stat, 'W');
    close(row.rank!.p, w.rank.p, 'Mann-Whitney p');
    close(row.d, w.d, 'd');
    close(row.levene!.stat, w.levene.stat, 'Levene F');
    close(row.levene!.p, w.levene.p, 'Levene p');
    expect(row.descriptives.map((x) => x.n)).toEqual([30, 30]);
  }, 600_000);
  it('one sample against a test value, one-sided', async () => {
    const r = await ttestR(data(ref.toothgrowth), {
      ...T,
      type: 'one',
      vars: ['len'],
      testValue: 18,
      alternative: 'greater',
    });
    const w = ref.ttestOne,
      row = r.rows[0];
    close(row.student!.stat, w.student.stat, 't');
    close(row.student!.p, w.student.p, 'p');
    close(row.rank!.p, w.rank.p, 'Wilcoxon p');
    close(row.d, w.d, 'd');
    close(row.shapiro[0]!.stat, w.shapiro.stat, 'Shapiro W');
  }, 600_000);
  it('paired samples', async () => {
    const r = await ttestR(data(ref.sleep), {
      ...T,
      type: 'paired',
      vars: [],
      pairs: [['drug1', 'drug2']],
    });
    const w = ref.ttestPaired,
      row = r.rows[0];
    expect(row.label).toBe('drug1 - drug2');
    close(row.student!.stat, w.student.stat, 't');
    close(row.student!.p, w.student.p, 'p');
    close(row.rank!.p, w.rank.p, 'Wilcoxon p');
    close(row.d, w.d, 'd');
  }, 600_000);
});

describe('ANOVA', () => {
  it('two-way, type III and type I sums of squares', async () => {
    for (const ss of ['III', 'I'] as const) {
      const r = await anovaR(data(ref.toothgrowth), {
        dependent: 'len',
        factors: ['supp', 'dose'],
        covariates: [],
        ssType: ss,
        interactions: true,
        confidence: 0.95,
      });
      const want = ref.anova2[ss === 'III' ? 'typeIII' : 'typeI'] as {
        term: string;
        ss: number;
        df: number;
        f: number;
        p: number;
      }[];
      expect(r.table.map((t) => t.term)).toEqual(['supp', 'dose', 'supp × dose']);
      want.forEach((w, i) => {
        close(r.table[i].ss, w.ss, `${ss} ${w.term} SS`);
        close(r.table[i].f, w.f, `${ss} ${w.term} F`);
        close(r.table[i].p, w.p, `${ss} ${w.term} p`);
        expect(r.table[i].df).toBe(w.df);
      });
      close(r.residual.ss, ref.anova2.residualSS, 'residual SS');
      close(
        r.table[0].partialEta2,
        r.table[0].ss / (r.table[0].ss + ref.anova2.residualSS),
        'partial eta²',
      );
    }
  }, 600_000);
  it('one-way: Welch, Kruskal-Wallis and Tukey', async () => {
    const r = await anovaR(data(ref.toothgrowth), {
      dependent: 'len',
      factors: ['dose'],
      covariates: [],
      ssType: 'III',
      interactions: true,
      confidence: 0.95,
    });
    const w = ref.anova1;
    close(r.table[0].f, w.f, 'F');
    close(r.welch!.stat, w.welch.stat, 'Welch F');
    close(r.welch!.p, w.welch.p, 'Welch p');
    close(r.kruskal!.stat, w.kruskal.stat, 'Kruskal-Wallis');
    close(r.kruskal!.p, w.kruskal.p, 'Kruskal-Wallis p');
    (w.tukey as { diff: number; ciLow: number; ciHigh: number; p: number }[]).forEach((t, i) => {
      close(r.tukey![i].diff, t.diff, 'Tukey diff');
      close(r.tukey![i].ciLow, t.ciLow, 'Tukey CI');
      close(r.tukey![i].p, t.p, 'Tukey p');
    });
  }, 600_000);
  it('ANCOVA', async () => {
    const r = await anovaR(data(ref.mtcars), {
      dependent: 'mpg',
      factors: ['am'],
      covariates: ['wt'],
      ssType: 'III',
      interactions: true,
      confidence: 0.95,
    });
    (ref.ancova as { term: string; ss: number; f: number; p: number }[]).forEach((w, i) => {
      expect(r.table[i].term).toBe(w.term);
      close(r.table[i].ss, w.ss, `${w.term} SS`);
      close(r.table[i].f, w.f, `${w.term} F`);
      close(r.table[i].p, w.p, `${w.term} p`);
    });
    expect(r.tukey).toBeNull();
  }, 600_000);
  it('repeated measures with a between factor: univariate tests, Mauchly, Greenhouse-Geisser, Huynh-Feldt', async () => {
    const r = await rmAnovaR(data(ref.co2), {
      levels: ['c95', 'c175', 'c250', 'c350'],
      factorName: 'conc',
      between: 'type',
    });
    const w = ref.rmanova;
    const eff = r.within.filter((x) => x.term !== 'Residuals');
    expect(eff.map((x) => x.term)).toEqual(['conc', 'conc × type']);
    eff.forEach((x, i) => {
      close(x.f, w.withinF[i], `${x.term} F`);
      close(x.p, w.withinP[i], `${x.term} p`);
    });
    close(r.betweenTable[0].f, w.betweenF, 'type F');
    close(r.sphericity!.w, w.mauchly.stat, 'Mauchly W');
    close(r.sphericity!.p, w.mauchly.p, 'Mauchly p');
    r.corrected.forEach((c, i) => {
      close(c.pGG, w.pGG[i], 'G-G p');
      close(c.pHF, w.pHF[i], 'H-F p');
    });
  }, 600_000);
  it('repeated measures without a between factor, with Friedman’s test', async () => {
    const r = await rmAnovaR(data(ref.co2), {
      levels: ['c95', 'c175', 'c250', 'c350'],
      factorName: 'conc',
      between: '',
    });
    const w = ref.rmanova0;
    close(r.within[0].f, w.f, 'F');
    close(r.within[0].p, w.p, 'p');
    close(r.corrected[0].pGG, w.pGG, 'G-G p');
    close(r.friedman!.stat, w.friedman.stat, 'Friedman');
    close(r.friedman!.p, w.friedman.p, 'Friedman p');
  }, 600_000);
  it('MANOVA: the four multivariate tests', async () => {
    const r = await manovaR(data(ref.iris), {
      dependents: ['Sepal.Length', 'Petal.Length'],
      factors: ['Species'],
      interactions: true,
    });
    (ref.manova as { test: string; value: number; f: number; p: number }[]).forEach((w, i) => {
      expect(r.tests[i].test).toBe(w.test);
      close(r.tests[i].rows[0].value, w.value, `${w.test} value`);
      close(r.tests[i].rows[0].f, w.f, `${w.test} F`);
      close(r.tests[i].rows[0].p, w.p, `${w.test} p`);
    });
  }, 600_000);
});

describe('correlations and frequencies', () => {
  it.each(['pearson', 'spearman', 'kendall'] as const)(
    '%s correlations, every pair',
    async (method) => {
      const r = await correlationR(data(ref.mtcars), {
        vars: ['mpg', 'wt', 'hp', 'disp'],
        method,
        alternative: 'two.sided',
        deletion: 'pairwise',
        confidence: 0.95,
      });
      (
        ref.correlation[method] as {
          a: string;
          b: string;
          r: number;
          p: number;
          ciLow: number | null;
        }[]
      ).forEach((w, i) => {
        expect([r.pairs[i].a, r.pairs[i].b]).toEqual([w.a, w.b]);
        close(r.pairs[i].r, w.r, `${w.a}-${w.b} r`);
        close(r.pairs[i].p, w.p, `${w.a}-${w.b} p`);
        if (w.ciLow !== null) close(r.pairs[i].ciLow, w.ciLow, 'CI');
      });
    },
    600_000,
  );
  it('contingency tables: 2 × 2 and 2 × 3', async () => {
    const r = await contingencyR(data(ref.mtcars), {
      rows: 'am',
      columns: 'vs',
      counts: '',
      confidence: 0.95,
    });
    const w = ref.contingency22;
    expect(r.rowLevels).toEqual(['automatic', 'manual']);
    close(r.chisq.stat, w.chisq.stat, 'χ²');
    close(r.yates!.stat, w.yates.stat, 'Yates');
    close(r.fisher!.p, w.fisher.p, 'Fisher p');
    close(r.likelihoodRatio.stat, w.g2, 'G²');
    close(r.cramerV, w.cramerV, 'Cramér’s V');
    close(r.oddsRatio!.est, w.oddsRatio, 'odds ratio');
    const r3 = await contingencyR(data(ref.mtcars), {
      rows: 'am',
      columns: 'cyl',
      counts: '',
      confidence: 0.95,
    });
    close(r3.chisq.stat, ref.contingency23.chisq.stat, 'χ² 2×3');
    close(r3.fisher!.p, ref.contingency23.fisher.p, 'Fisher 2×3');
    close(r3.cramerV, ref.contingency23.cramerV, 'V 2×3');
    expect(r3.yates).toBeNull();
    expect(r3.oddsRatio).toBeNull();
  }, 600_000);
  it('binomial and multinomial tests', async () => {
    const b = await freqTestR(data(ref.mtcars), {
      type: 'binomial',
      variable: 'am',
      testValue: 0.5,
      proportions: [],
      alternative: 'two.sided',
      confidence: 0.95,
    });
    expect(b.levels).toEqual(['automatic', 'manual']);
    (ref.binomial as { p: number; ciLow: number }[]).forEach((w, i) => {
      close(b.binomial![i].p, w.p, 'binomial p');
      close(b.binomial![i].ciLow, w.ciLow, 'Clopper-Pearson');
    });
    const m = await freqTestR(data(ref.mtcars), {
      type: 'multinomial',
      variable: 'cyl',
      testValue: 0.5,
      proportions: [],
      alternative: 'two.sided',
      confidence: 0.95,
    });
    close(m.multinomial!.stat, ref.multinomial.equal.stat, 'χ² equal');
    close(m.multinomial!.p, ref.multinomial.equal.p, 'p equal');
    const g = await freqTestR(data(ref.mtcars), {
      type: 'multinomial',
      variable: 'cyl',
      testValue: 0.5,
      proportions: [1, 1, 2],
      alternative: 'two.sided',
      confidence: 0.95,
    });
    close(g.multinomial!.stat, ref.multinomial.given.stat, 'χ² given');
  }, 600_000);
});

describe('post hoc tests and reliability', () => {
  it('pairwise rank tests after Kruskal-Wallis and paired t-tests after repeated measures, Holm-adjusted', async () => {
    const a = await anovaR(data(ref.toothgrowth), {
      dependent: 'len',
      factors: ['dose'],
      covariates: [],
      ssType: 'III',
      interactions: true,
      confidence: 0.95,
    });
    expect(a.pairwiseRank!.map((x) => x.comparison)).toEqual(['1 - 0.5', '2 - 0.5', '2 - 1']);
    (ref.pairwiseRank as number[]).forEach((p, i) => close(a.pairwiseRank![i].pHolm, p, 'Holm p'));
    const r = await rmAnovaR(data(ref.co2), {
      levels: ['c95', 'c175', 'c250', 'c350'],
      factorName: 'conc',
      between: '',
    });
    (ref.rmPosthoc.p as number[]).forEach((p, i) => {
      close(r.posthoc![i].p, p, 'paired p');
      close(r.posthoc![i].pHolm, ref.rmPosthoc.pHolm[i], 'Holm p');
    });
  }, 600_000);
  it('scale reliability: alpha, omega total, glb, item statistics', async () => {
    const r = await reliabilityR(data(ref.bfi), {
      type: 'scale',
      vars: ['A2', 'A3', 'A4', 'A5'],
      confidence: 0.95,
    });
    close(r.alpha, ref.scale.alpha, 'alpha');
    close(r.omegaTotal, ref.scale.omega, 'omega');
    close(r.glb, ref.scale.glb, 'glb');
    (ref.scale.alphaDrop as number[]).forEach((x, i) => {
      close(r.items![i].alphaIfDropped, x, 'alpha if dropped');
      close(r.items![i].itemRest, ref.scale.itemRest[i], 'item-rest');
    });
    expect(r.warnings).toEqual([]);
  }, 600_000);
  // (slow: one glb per posterior draw, ~20 s in desktop R and minutes in webR; run with WEBR_SLOW)
  slowIt(
    'scale reliability, Bayesian with the glb: strel(asrm) with seed 1 equals desktop Bayesrel',
    async () => {
      const want = JSON.parse(
        readFileSync(
          join(__dirname, '..', 'engine', '__fixtures__', 'bayesrel', 'asrm.json'),
          'utf8',
        ),
      );
      const raw = await rCall<{ names: string[]; cols: number[][] }>(
        'ps_dataset',
        { package: 'Bayesrel', name: 'asrm', na: [] },
        'Bayesrel',
      );
      const asrm: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c)) };
      const r = await reliabilityR(asrm, {
        type: 'scale',
        vars: raw.names,
        confidence: 0.95,
        bayes: true,
        bayesGlb: true,
        iterations: 1000,
        seed: 1,
      });
      const b = r.bayes!;
      expect(b.estimates.map((x) => x.estimate)).toEqual(['alpha', 'lambda2', 'glb', 'omega']);
      // Same seed, same draws: exact in desktop R; 1e-6 for webR's floating point.
      for (const x of b.estimates) {
        const w = want.withGlb[x.estimate];
        near(`${x.estimate} posterior mean`, x.mean, w.mean, 1e-6);
        near(`${x.estimate} credible interval lower`, x.low, w.low, 1e-6);
        near(`${x.estimate} credible interval upper`, x.high, w.high, 1e-6);
      }
      // Validated in R: too few iterations and fewer than three items are refused.
      await expect(
        reliabilityR(asrm, {
          type: 'scale',
          vars: raw.names,
          confidence: 0.95,
          bayes: true,
          iterations: 10,
          seed: 1,
        }),
      ).rejects.toThrow(/between 100 and 20000/);
      await expect(
        reliabilityR(asrm, {
          type: 'scale',
          vars: raw.names.slice(0, 2),
          confidence: 0.95,
          bayes: true,
          seed: 1,
        }),
      ).rejects.toThrow(/at least three items/);
    },
    1_800_000,
  );
  it('intraclass correlations, Cohen’s kappa and Bland–Altman', async () => {
    const i = await reliabilityR(data(ref.shroutFleiss), {
      type: 'icc',
      vars: ['j1', 'j2', 'j3', 'j4'],
      confidence: 0.95,
    });
    (ref.icc.icc as number[]).forEach((x, k) => {
      close(i.icc![k].icc, x, 'ICC');
      close(i.icc![k].ciLow, ref.icc.lower[k], 'ICC lower');
    });
    const k = await reliabilityR(data(ref.raters), {
      type: 'kappa',
      vars: ['a', 'b'],
      confidence: 0.95,
    });
    close(k.kappa!.est, ref.kappa.kappa, 'kappa');
    close(k.weighted!.est, ref.kappa.weighted, 'weighted kappa');
    close(k.kappa!.ciLow, ref.kappa.lower, 'kappa lower');
    const b = await reliabilityR(data(ref.co2), {
      type: 'blandaltman',
      vars: ['c250', 'c350'],
      confidence: 0.95,
    });
    close(b.bias, ref.blandAltman.bias, 'bias');
    close(b.lower, ref.blandAltman.lower, 'lower limit');
    close(b.upper, ref.blandAltman.upper, 'upper limit');
    close(b.biasCiLow, ref.blandAltman.ciLow, 'bias CI');
    expect(b.points!.diff).toHaveLength(12);
  }, 600_000);
});
