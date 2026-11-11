// The estimated marginal means section (R/emm.R) of the ANOVA, repeated-measures ANOVA and
// multilevel regression cards against direct calls to emmeans, afex, rstatix and lmerTest on
// the same data (scripts/validation/emm.R). Run natively with
//   WEBR_TESTS=1 PS_NATIVE_R=1 npx vitest run --dir src src/rengine/emm.webr.test.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { near } from '../validation/record';
import type { EmmContrastRow, EmmMeanRow, EmmOptions } from './emm';
import { lmmR } from './mixed';
import { anovaR, rmAnovaR } from './tests';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Frame = { names: string[]; cols: number[][]; categories: Record<string, string[]> };
interface Tab {
  estimate: number[];
  se: number[];
  df: (number | string)[];
  t?: number[];
  p?: number[];
  lower?: number[];
  upper?: number[];
}
const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'emm', 'reference.json'), 'utf8'),
) as Record<string, any>;
const data = (f: Frame): Dataset => ({
  names: f.names,
  cols: f.cols.map((c) => Float64Array.from(c)),
  ...(Object.keys(f.categories ?? {}).length ? { categories: f.categories } : {}),
});
// Closed forms on the same fit: webR's WebAssembly arithmetic differs from desktop R's by ~1e-12, Kenward-Roger's
// numerical derivatives by more; 1e-6 relative leaves room for both.
const close = (what: string, a: number | null | undefined, b: number) =>
  near(what, a ?? NaN, b, 1e-6 * Math.max(1, Math.abs(b)));
/** An infinite reference df ("Inf") is null in the app. */
const closeDf = (what: string, a: number | null, b: number | string) => {
  if (b === 'Inf') expect(a, what).toBeNull();
  else close(what, a, b as number);
};
function means(what: string, rows: EmmMeanRow[], want: Tab) {
  expect(rows.length, `${what}: rows`).toBe(want.estimate.length);
  rows.forEach((r, i) => {
    close(`${what} mean ${i + 1}`, r.emmean, want.estimate[i]);
    close(`${what} SE ${i + 1}`, r.se, want.se[i]);
    closeDf(`${what} df ${i + 1}`, r.df, want.df[i]);
    close(`${what} CI low ${i + 1}`, r.lower, want.lower![i]);
    close(`${what} CI high ${i + 1}`, r.upper, want.upper![i]);
  });
}
function contrasts(what: string, rows: EmmContrastRow[], want: Tab, p = true) {
  expect(rows.length, `${what}: rows`).toBe(want.estimate.length);
  rows.forEach((r, i) => {
    close(`${what} estimate ${i + 1}`, r.estimate, want.estimate[i]);
    close(`${what} SE ${i + 1}`, r.se, want.se[i]);
    closeDf(`${what} df ${i + 1}`, r.df, want.df[i]);
    close(`${what} t ${i + 1}`, r.t, want.t![i]);
    if (p) close(`${what} p ${i + 1}`, r.p, want.p![i]);
    close(`${what} CI low ${i + 1}`, r.lower, want.lower![i]);
    close(`${what} CI high ${i + 1}`, r.upper, want.upper![i]);
  });
}
const EMM: EmmOptions = {
  terms: [],
  posthoc: [],
  adjust: ['tukey'],
  gamesHowell: false,
  simple: null,
  contrasts: [],
  plot: null,
  df: 'kenward-roger',
};
const ANOVA = { covariates: [], ssType: 'III' as const, interactions: true, confidence: 0.95 };

describe('marginal means after ANOVA (emmeans on the lm fit)', () => {
  it('means, post hoc adjustments, simple effects, Games–Howell, contrasts, profile plot', async () => {
    const r = await anovaR(data(ref.warpbreaks), {
      ...ANOVA,
      dependent: 'breaks',
      factors: ['wool', 'tension'],
      emm: {
        ...EMM,
        terms: [['tension'], ['wool', 'tension']],
        posthoc: [['tension']],
        adjust: ['tukey', 'bonferroni', 'holm', 'scheffe', 'none'],
        gamesHowell: true,
        simple: { factor: 'tension', by: 'wool' },
        contrasts: [
          { factor: 'tension', type: 'deviation', reference: 'first', weights: [] },
          { factor: 'wool', type: 'simple', reference: 'last', weights: [] },
        ],
        plot: { x: 'tension', lines: 'wool' },
      },
    });
    const e = r.emm!;
    const a = ref.anova;
    means('tension', e.means[0].rows, a.tension);
    expect(e.means[0].rows.map((x) => x.levels[0])).toEqual(['L', 'M', 'H']);
    // (emmeans orders cells with the first factor fastest: wool within tension)
    means('wool × tension', e.means[1].rows, a.cells);
    const ph = e.posthoc[0];
    contrasts('post hoc', ph.rows, a.posthoc.tukey, false);
    for (const adj of ['tukey', 'bonferroni', 'holm', 'scheffe', 'none'] as const)
      ph.rows.forEach((x, i) => close(`p ${adj} ${i + 1}`, x.pAdjusted[adj], a.posthoc[adj].p[i]));
    e.simple!.rows.forEach((x, i) => {
      close(`simple F ${i + 1}`, x.f, a.simple.f[i]);
      close(`simple df2 ${i + 1}`, x.df2, a.simple.df2[i]);
      close(`simple p ${i + 1}`, x.p, a.simple.p[i]);
    });
    e.gamesHowell[0].rows.forEach((x, i) => {
      close(`Games–Howell estimate ${i + 1}`, x.estimate, a.gamesHowell.estimate[i]);
      close(`Games–Howell CI low ${i + 1}`, x.lower, a.gamesHowell.lower[i]);
      close(`Games–Howell CI high ${i + 1}`, x.upper, a.gamesHowell.upper[i]);
      // (rstatix rounds its adjusted p-values to three significant digits)
      near(`Games–Howell p ${i + 1}`, x.p!, a.gamesHowell.p[i], 5e-3 * a.gamesHowell.p[i]);
    });
    contrasts('deviation', e.contrasts[0].rows, a.deviation);
    // A two-level factor against its last level: a single difference.
    expect(e.contrasts[1].rows.length).toBe(1);
    expect(e.plot!.rows.length).toBe(6);
    close('plot mean', e.plot!.rows[0].emmean, a.cells.estimate[0]);
  }, 600_000);

  it('simple (last level), Helmert, polynomial and custom contrasts', async () => {
    const r = await anovaR(data(ref.warpbreaks), {
      ...ANOVA,
      dependent: 'breaks',
      factors: ['wool', 'tension'],
      emm: {
        ...EMM,
        contrasts: [
          { factor: 'tension', type: 'simple', reference: 'last', weights: [] },
          { factor: 'wool', type: 'polynomial', reference: 'first', weights: [] },
        ],
      },
    });
    contrasts('simple', r.emm!.contrasts[0].rows, ref.anova.simpleLast);
    const h = await anovaR(data(ref.warpbreaks), {
      ...ANOVA,
      dependent: 'breaks',
      factors: ['tension'],
      emm: {
        ...EMM,
        contrasts: [{ factor: 'tension', type: 'helmert', reference: 'first', weights: [] }],
      },
    });
    h.emm!.contrasts[0].rows.forEach((x, i) =>
      close(`Helmert ${i + 1}`, x.estimate, ref.anova.helmert[i]),
    );
    const p = await anovaR(data(ref.warpbreaks), {
      ...ANOVA,
      dependent: 'breaks',
      factors: ['wool', 'tension'],
      emm: {
        ...EMM,
        contrasts: [
          { factor: 'tension', type: 'polynomial', reference: 'first', weights: [] },
          {
            factor: 'wool',
            type: 'custom',
            reference: 'first',
            weights: [[1, -1]],
          },
        ],
      },
    });
    contrasts('polynomial', p.emm!.contrasts[0].rows, ref.anova.polynomial);
    const c = await anovaR(data(ref.warpbreaks), {
      ...ANOVA,
      dependent: 'breaks',
      factors: ['wool', 'tension'],
      emm: {
        ...EMM,
        contrasts: [
          {
            factor: 'tension',
            type: 'custom',
            reference: 'first',
            weights: [
              [1, -0.5, -0.5],
              [0, 1, -1],
            ],
          },
        ],
      },
    });
    contrasts('custom', c.emm!.contrasts[0].rows, ref.anova.custom);
  }, 600_000);

  it('ANCOVA: means at the mean of the covariate', async () => {
    const r = await anovaR(data(ref.mtcars), {
      ...ANOVA,
      dependent: 'mpg',
      factors: ['cyl'],
      covariates: ['wt'],
      emm: { ...EMM, terms: [['cyl']], posthoc: [['cyl']] },
    });
    means('cyl', r.emm!.means[0].rows, ref.ancova.cyl);
    contrasts('cyl pairs', r.emm!.posthoc[0].rows, ref.ancova.posthoc, false);
    r.emm!.posthoc[0].rows.forEach((x, i) =>
      close(`cyl Tukey p ${i + 1}`, x.pAdjusted.tukey, ref.ancova.posthoc.p[i]),
    );
  }, 600_000);
});

describe('marginal means after repeated measures (afex’s multivariate model)', () => {
  const cells = ref.obk.names.slice(2, 17) as string[];
  const factors = [
    { name: 'phase', levels: ['pre', 'post', 'fup'] },
    { name: 'hour', levels: ['1', '2', '3', '4', '5'] },
  ];
  it('two within and two between factors (the car path)', async () => {
    const r = await rmAnovaR(data(ref.obk), {
      levels: [],
      factorName: 'condition',
      factors,
      cells,
      between: 'treatment',
      moreBetween: ['gender'],
      confidence: 0.95,
      emm: {
        ...EMM,
        terms: [['phase'], ['treatment', 'phase']],
        posthoc: [['phase']],
        adjust: ['bonferroni'],
        simple: { factor: 'phase', by: 'treatment' },
        contrasts: [{ factor: 'phase', type: 'polynomial', reference: 'first', weights: [] }],
      },
    });
    const e = r.emm!;
    const w = ref.rm.car;
    means('phase', e.means[0].rows, w.phase);
    means('treatment × phase', e.means[1].rows, w.treatmentPhase);
    contrasts('phase pairs', e.posthoc[0].rows, w.posthoc, false);
    e.posthoc[0].rows.forEach((x, i) =>
      close(`phase Bonferroni p ${i + 1}`, x.pAdjusted.bonferroni, w.posthoc.p[i]),
    );
    e.simple!.rows.forEach((x, i) => {
      close(`simple F ${i + 1}`, x.f, w.simple.f[i]);
      close(`simple p ${i + 1}`, x.p, w.simple.p[i]);
    });
    contrasts('phase polynomial', e.contrasts[0].rows, w.polynomial);
  }, 600_000);

  it('two within factors without a between factor', async () => {
    const r = await rmAnovaR(data(ref.obk), {
      levels: [],
      factorName: 'condition',
      factors,
      cells,
      between: '',
      emm: { ...EMM, terms: [['hour']], posthoc: [['phase']], adjust: ['holm'] },
    });
    means('hour', r.emm!.means[0].rows, ref.rm.multi.hour);
    r.emm!.posthoc[0].rows.forEach((x, i) =>
      close(`phase Holm p ${i + 1}`, x.pAdjusted.holm, ref.rm.multi.posthoc.p[i]),
    );
  }, 600_000);

  it('one within factor and a between factor', async () => {
    const r = await rmAnovaR(data(ref.obk), {
      levels: cells.slice(0, 5),
      factorName: 'hour',
      between: 'treatment',
      emm: {
        ...EMM,
        terms: [['hour'], ['hour', 'treatment']],
        posthoc: [['treatment']],
      },
    });
    means('hour', r.emm!.means[0].rows, ref.rm.single.hour);
    means('hour × treatment', r.emm!.means[1].rows, ref.rm.single.cells);
    contrasts('treatment pairs', r.emm!.posthoc[0].rows, ref.rm.single.posthoc, false);
  }, 600_000);
});

describe('marginal means after a multilevel regression (emmeans on lmer)', () => {
  it('Kenward–Roger, Satterthwaite and asymptotic degrees of freedom', async () => {
    const base = {
      outcome: 'yield',
      predictors: ['Variety', 'nitro'],
      factors: ['Variety'],
      cluster: 'Block',
      slopes: [],
      center: 'none' as const,
      estimation: 'REML' as const,
      confidence: 0.95,
    };
    const kr = await lmmR(data(ref.oats), {
      ...base,
      emm: { ...EMM, terms: [['Variety']], posthoc: [['Variety']], df: 'kenward-roger' },
    });
    means('Kenward–Roger', kr.emm!.means[0].rows, ref.lmm.kr);
    contrasts('Kenward–Roger pairs', kr.emm!.posthoc[0].rows, ref.lmm.posthoc, false);
    expect(kr.fixed.map((f) => f.term)).toContain('Variety [Victory]');
    for (const df of ['satterthwaite', 'asymptotic'] as const) {
      const r = await lmmR(data(ref.oats), { ...base, emm: { ...EMM, terms: [['Variety']], df } });
      means(df, r.emm!.means[0].rows, ref.lmm[df]);
    }
  }, 600_000);
});
