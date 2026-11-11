// The nonparametric tests of the basic-statistics cards (R/nonparametric.R) against base R
// and the packages that implement them (DescTools, dunn.test, PMCMRplus in desktop R) on the
// same data (scripts/validation/nonparametric.R). Run natively with WEBR_TESTS=1 PS_NATIVE_R=1.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { near } from '../validation/record';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';
import {
  anovaR,
  contingencyR,
  freqTestR,
  rmAnovaR,
  type FreqTestInput,
  type PAdjust,
} from './tests';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Frame = { names: string[]; cols: number[][]; categories: Record<string, string[]> };
const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'nonparametric', 'reference.json'),
    'utf8',
  ),
) as Record<string, any>;

/** A reference frame as a dataset (missing values come as null in JSON). */
const data = (f: Frame): Dataset => ({
  names: f.names,
  cols: f.cols.map((c) => Float64Array.from(c, (x) => (x === null ? NaN : x))),
  ...(Object.keys(f.categories ?? {}).length ? { categories: f.categories } : {}),
});

// Closed forms on the same data: 1e-6 relative allows for webR's WebAssembly floating point.
const close = (what: string, a: number | null | undefined, b: number) =>
  near(what, a ?? NaN, b, 1e-6 * Math.max(1, Math.abs(b)));

describe('paired contingency tables', () => {
  it('McNemar’s test of Agresti’s approval table: asymptotic, continuity-corrected, exact', async () => {
    const r = await contingencyR(data(ref.performance), {
      rows: 'first',
      columns: 'second',
      counts: 'count',
      confidence: 0.95,
      paired: true,
    });
    const p = r.paired!;
    const m = ref.mcnemar;
    close('McNemar χ²', p.mcnemar!.stat, m.plain.stat);
    close('McNemar p', p.mcnemar!.p, m.plain.p);
    close('McNemar χ², continuity correction', p.mcnemarCorrected!.stat, m.corrected.stat);
    close('McNemar p, continuity correction', p.mcnemarCorrected!.p, m.corrected.p);
    close('exact p', p.exact!.p, m.exactP);
    near('discordant b', p.exact!.b, 150, 0);
    near('discordant c', p.exact!.c, 86, 0);
  }, 600_000);
  it('come with the effect sizes when both are asked for', async () => {
    const r = await contingencyR(data(ref.performance), {
      rows: 'first',
      columns: 'second',
      counts: 'count',
      confidence: 0.95,
      paired: true,
      effectSizes: true,
    });
    close('McNemar χ², with effect sizes', r.paired!.mcnemar!.stat, ref.mcnemar.plain.stat);
    const v = r.effects!.find((e) => e.id === 'cramerV')!;
    close('Cramér’s V (effectsize), with the paired tests', v.est, r.cramerV);
  }, 600_000);

  it('Bowker’s test of symmetry: equal to mcnemar.test, and with an empty pair of cells left out', async () => {
    const input = {
      rows: 'before',
      columns: 'after',
      counts: 'count',
      confidence: 0.95,
      paired: true as const,
    };
    const full = (await contingencyR(data(ref.bowkerFull), input)).paired!.bowker!;
    close('Bowker χ² (mcnemar.test)', full.stat, ref.bowker.full.stat);
    near('Bowker df (mcnemar.test)', full.df, ref.bowker.full.df, 0);
    close('Bowker p (mcnemar.test)', full.p, ref.bowker.full.p);
    const empty = (await contingencyR(data(ref.bowkerEmpty), input)).paired!.bowker!;
    close('Bowker χ², an empty pair', empty.stat, ref.bowker.empty.stat);
    near('Bowker df, an empty pair', empty.df, ref.bowker.empty.df, 0);
    close('Bowker p, an empty pair', empty.p, ref.bowker.empty.p);
  }, 600_000);
});

describe('Cochran’s Q', () => {
  const input = (vars: string[], more: Partial<FreqTestInput> = {}): FreqTestInput => ({
    type: 'cochran',
    variable: '',
    testValue: 0.5,
    proportions: [],
    alternative: 'two.sided',
    confidence: 0.95,
    vars,
    ...more,
  });
  const tasks = ['task1', 'task2', 'task3'];

  it('three tasks: Q as DescTools::CochranQTest, pairwise McNemar tests adjusted by Holm', async () => {
    const r = await freqTestR(data(ref.tasks), input(tasks));
    const q = ref.cochran;
    close('Q', r.cochran!.stat, q.q);
    near('df', r.cochran!.df, q.df, 0);
    close('p', r.cochran!.p, q.p);
    (q.proportions as number[]).forEach((x, i) =>
      close(`share solved, ${tasks[i]}`, r.proportions![i], x),
    );
    r.posthoc!.forEach((x, i) => {
      near(`b, ${x.comparison}`, x.b, q.b[i], 0);
      near(`c, ${x.comparison}`, x.c, q.c[i], 0);
      close(`McNemar χ², ${x.comparison}`, x.chisq, q.chisq[i]);
      close(`McNemar p, ${x.comparison}`, x.p, q.pPairs[i]);
      close(`McNemar p (Holm), ${x.comparison}`, x.pAdjusted, q.pHolm[i]);
      close(`exact p, ${x.comparison}`, x.pExact, q.pExact[i]);
      close(`exact p (Holm), ${x.comparison}`, x.pExactAdjusted, q.pExactHolm[i]);
    });
  }, 600_000);

  it('the same answers as categories “no” / “yes”, Benjamini–Hochberg', async () => {
    const r = await freqTestR(data(ref.tasksLabelled), input(tasks, { adjust: 'BH' }));
    close('Q (labelled)', r.cochran!.stat, ref.cochran.q);
    near('the value counted', r.success === 'yes' ? 1 : 0, 1, 0);
    r.posthoc!.forEach((x, i) => {
      close(`McNemar p (BH), ${x.comparison}`, x.pAdjusted, ref.cochran.pBH[i]);
    });
  }, 600_000);
});

/** A comparison's groups, numeric labels as numbers ("1.0 - 2.0" and "1 - 2" are the same pair). */
const sameGroups = (comparison: string) =>
  comparison
    .split(' - ')
    .map((g) => (Number.isFinite(Number(g)) ? String(Number(g)) : g))
    .join(' - ');

describe('Dunn’s test after Kruskal–Wallis', () => {
  const cases = [
    ['PlantGrowth (no ties)', 'plantGrowth', 'dunnPlantGrowth', 'weight', 'group'],
    ['ToothGrowth by dose (ties)', 'toothGrowth', 'dunnToothGrowth', 'len', 'dose'],
  ] as const;
  const adjusted: [PAdjust, string][] = [
    ['holm', 'pHolm'],
    ['bonferroni', 'pBonferroni'],
    ['BH', 'pBH'],
  ];
  for (const [label, frame, key, y, g] of cases) {
    it(`${label}: z and p as dunn.test, adjusted by Holm, Bonferroni and Benjamini–Hochberg`, async () => {
      const want = ref[key];
      for (const [adjust, field] of adjusted) {
        const r = await anovaR(data(ref[frame]), {
          dependent: y,
          factors: [g],
          covariates: [],
          ssType: 'III',
          interactions: true,
          confidence: 0.95,
          adjust,
        });
        r.dunn!.forEach((x, i) => {
          if (sameGroups(x.comparison) !== sameGroups(want.comparisons[i]))
            throw new Error(`${x.comparison} ≠ ${want.comparisons[i]}`);
          close(`z, ${x.comparison}`, x.z, want.z[i]);
          close(`p, ${x.comparison}`, x.p, want.p[i]);
          close(`p (${adjust}), ${x.comparison}`, x.pAdjusted, want[field][i]);
        });
      }
    }, 600_000);
  }
});

describe('Conover’s test after Friedman', () => {
  it('rounding times: t and p as PMCMRplus::frdAllPairsConoverTest, Holm, Bonferroni, BH', async () => {
    const want = ref.conover;
    const levels = ['round_out', 'narrow_angle', 'wide_angle'];
    const adjusted: [PAdjust, string][] = [
      ['holm', 'pHolm'],
      ['bonferroni', 'pBonferroni'],
      ['BH', 'pBH'],
    ];
    for (const [adjust, field] of adjusted) {
      const r = await rmAnovaR(data(ref.rounding), {
        levels,
        factorName: 'method',
        between: '',
        adjust,
      });
      r.conover!.forEach((x, i) => {
        near(`df, ${x.comparison}`, x.df, want.df, 0);
        close(`t, ${x.comparison}`, x.t, want.t[i]);
        close(`p, ${x.comparison}`, x.p, want.p[i]);
        close(`p (${adjust}), ${x.comparison}`, x.pAdjusted, want[field][i]);
      });
    }
  }, 600_000);
});
