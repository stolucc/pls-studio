// Effect sizes with confidence intervals and equivalence tests of the basic test cards (R/effects.R through
// R/tests.R) against direct effectsize and TOSTER calls on the same data (scripts/validation/effects.R, desktop R
// 4.6.2, effectsize 1.0.3, TOSTER 0.8.6). Run with WEBR_TESTS=1 npx vitest run src/rengine/effects
// (PS_NATIVE_R=1: desktop R).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { near, same } from '../validation/record';
import {
  anovaR,
  contingencyR,
  correlationR,
  correlationScriptR,
  ttestR,
  ttestScriptR,
  type AnovaEffect,
  type EffectSize,
  type TostResult,
  type TTestInput,
} from './tests';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Frame = { names: string[]; cols: (number | null)[][]; categories: Record<string, string[]> };
type Ref = { est: number; ciLow: number | null; ciHigh: number | null };
const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'effects', 'reference.json'),
    'utf8',
  ),
) as Record<string, any>;
const data = (f: Frame): Dataset => ({
  names: f.names,
  cols: f.cols.map((c) => Float64Array.from(c, (v) => (v === null ? NaN : v))),
  ...(Object.keys(f.categories ?? {}).length ? { categories: f.categories } : {}),
});
// The intervals come from root finding on noncentral distributions (effectsize, TOSTER's SMD interval):
// webR's floating point differs from desktop R's by up to about 1e-6 relative there; closed forms agree closer.
const close = (what: string, a: number | null | undefined, b: number | null) => {
  if (b === null) {
    same(`${what} (open end)`, String(a ?? null), 'null');
    return;
  }
  near(what, a ?? NaN, b, 1e-6 * Math.max(1, Math.abs(b)));
};
const effect = (what: string, e: EffectSize | undefined, w: Ref) => {
  expect(e, what).toBeDefined();
  close(`${what}: estimate`, e!.est, w.est);
  close(`${what}: CI low`, e!.ciLow, w.ciLow);
  close(`${what}: CI high`, e!.ciHigh, w.ciHigh);
};
const tost = (what: string, t: TostResult | null | undefined, w: Record<string, number>) => {
  expect(t, what).toBeTruthy();
  close(`${what}: lower t`, t!.lower.t, w.lowerT);
  close(`${what}: lower p`, t!.lower.p, w.lowerP);
  close(`${what}: upper t`, t!.upper.t, w.upperT);
  close(`${what}: upper p`, t!.upper.p, w.upperP);
  close(`${what}: df`, t!.lower.df, w.df);
  close(`${what}: lower bound (SMD)`, t!.lowSmd, w.lowSmd);
  close(`${what}: difference CI low`, t!.raw.ciLow, w.rawLow);
  close(`${what}: difference CI high`, t!.raw.ciHigh, w.rawHigh);
  close(`${what}: SMD`, t!.smd.est, w.smd);
  close(`${what}: SMD CI low`, t!.smd.ciLow, w.smdLow);
  close(`${what}: SMD CI high`, t!.smd.ciHigh, w.smdHigh);
  close(`${what}: TOST p`, t!.p, Math.max(w.lowerP, w.upperP));
};
const byId = (es: EffectSize[] | null | undefined, id: string) => es?.find((e) => e.id === id);

const T: Omit<TTestInput, 'type' | 'vars'> = {
  pairs: [],
  group: '',
  testValue: 0,
  student: true,
  welch: false,
  rank: true,
  alternative: 'two.sided',
  confidence: 0.95,
  effectSizes: true,
};

describe('t-test effect sizes and equivalence tests', () => {
  it('independent samples: d, g, Welch d, Glass’s delta, rank-biserial r; TOST (Welch and Student)', async () => {
    const input = {
      ...T,
      type: 'independent' as const,
      vars: ['len'],
      group: 'supp',
      welch: true,
      tost: { low: -3, high: 3, units: 'raw' as const },
    };
    const r = await ttestR(data(ref.toothgrowth), input);
    const row = r.rows[0];
    const w = ref.independent;
    for (const id of ['d', 'g', 'dWelch', 'glass', 'rb'])
      effect(`independent ${id}`, byId(row.effects, id), w[id]);
    tost('independent TOST (Welch)', row.tost, w.tostWelch);
    const s = await ttestR(data(ref.toothgrowth), { ...input, welch: false });
    tost('independent TOST (Student)', s.rows[0].tost, w.tostStudent);
    same('no Welch d without Welch', String(byId(s.rows[0].effects, 'dWelch')), 'undefined');
  }, 600_000);

  it('one sample against 18, one-sided: intervals open above; TOST about the test value', async () => {
    const r = await ttestR(data(ref.toothgrowth), {
      ...T,
      type: 'one',
      vars: ['len'],
      testValue: 18,
      alternative: 'greater',
      tost: { low: -2, high: 2, units: 'raw' },
    });
    const row = r.rows[0];
    for (const id of ['d', 'g', 'rb'])
      effect(`one sample ${id}`, byId(row.effects, id), ref.one[id]);
    tost('one-sample TOST', row.tost, ref.one.tost);
  }, 600_000);

  it('paired samples: d of the differences, g, rank-biserial r; TOST with standardised bounds', async () => {
    const r = await ttestR(data(ref.sleepWide), {
      ...T,
      type: 'paired',
      vars: [],
      pairs: [['extra.1', 'extra.2']],
      tost: { low: -0.5, high: 0.5, units: 'smd' },
    });
    const row = r.rows[0];
    for (const id of ['d', 'g', 'rb'])
      effect(`paired ${id}`, byId(row.effects, id), ref.paired[id]);
    // (the card's own d of the differences is the same number)
    close('paired: the card’s d', row.d, ref.paired.d.est);
    tost('paired TOST (SMD bounds)', row.tost, ref.paired.tostSmd);
  }, 600_000);

  it('exports the effectsize and TOSTER calls in its script, and none without the options', async () => {
    const input = {
      ...T,
      type: 'independent' as const,
      vars: ['len'],
      group: 'supp',
      tost: { low: -3, high: 3, units: 'raw' as const },
    };
    const script = await ttestScriptR(data(ref.toothgrowth), input);
    expect(script).toMatch(/effectsize::glass_delta\(y1, y2, adjust = FALSE/);
    expect(script).toMatch(/TOSTER::t_TOST\(/);
    expect(script).toMatch(/install\.packages\(c\("effectsize", "TOSTER"\)\)/);
    const plain = await ttestScriptR(data(ref.toothgrowth), {
      ...input,
      effectSizes: false,
      tost: undefined,
    });
    expect(plain).not.toMatch(/effectsize|TOSTER/);
  }, 600_000);
});

describe('ANOVA effect sizes', () => {
  const terms = (what: string, effects: AnovaEffect[] | null | undefined, w: any) => {
    expect(effects?.length, `${what}: terms`).toBe(w.eta2.length);
    effects!.forEach((e, i) => {
      for (const k of ['eta2', 'partialEta2', 'omega2', 'partialOmega2'] as const)
        effect(`${what} ${e.term}: ${k}`, { id: k, ...e[k] }, w[k][i]);
    });
  };
  it('type I: η², partial η², ω², partial ω² with intervals; one way: rank ε²', async () => {
    const r = await anovaR(data(ref.toothgrowth), {
      dependent: 'len',
      factors: ['supp', 'dose'],
      covariates: [],
      ssType: 'I',
      interactions: true,
      confidence: 0.95,
      effectSizes: true,
      seed: 1234,
    });
    same('terms', r.effects!.map((e) => e.term).join(', '), 'supp, dose, supp × dose');
    terms('type I', r.effects, ref.anovaTypeI);
    const one = await anovaR(data(ref.toothgrowth), {
      dependent: 'len',
      factors: ['dose'],
      covariates: [],
      ssType: 'III',
      interactions: true,
      confidence: 0.95,
      effectSizes: true,
      seed: 1234,
    });
    // (the bootstrap interval: the same seed and resamples in both; numbers as desktop R's)
    effect('Kruskal–Wallis rank ε²', one.epsilon2 ?? undefined, ref.epsilon2);
  }, 600_000);

  it('type III on unbalanced data: as effectsize on car::Anova(type = 3)', async () => {
    const r = await anovaR(data(ref.unbalanced), {
      dependent: 'len',
      factors: ['supp', 'dose'],
      covariates: [],
      ssType: 'III',
      interactions: true,
      confidence: 0.95,
      effectSizes: true,
    });
    terms('type III', r.effects, ref.anovaTypeIII);
  }, 600_000);
});

describe('contingency and correlation', () => {
  it('Cramér’s V (2 × 3) and φ (2 × 2) with intervals, unadjusted', async () => {
    const mt = data(ref.mtcars);
    const v = await contingencyR(mt, {
      rows: 'am',
      columns: 'cyl',
      counts: '',
      confidence: 0.95,
      effectSizes: true,
    });
    effect('Cramér’s V (am × cyl)', byId(v.effects, 'cramerV'), ref.cramerV);
    close('V as the card computes it', v.cramerV, ref.cramerV.est);
    same('no φ beyond 2 × 2', String(byId(v.effects, 'phi')), 'undefined');
    const p = await contingencyR(mt, {
      rows: 'am',
      columns: 'vs',
      counts: '',
      confidence: 0.95,
      effectSizes: true,
    });
    effect('φ (am × vs)', byId(p.effects, 'phi'), ref.phi);
    effect('Cramér’s V (am × vs)', byId(p.effects, 'cramerV'), ref.cramerV2x2);
  }, 600_000);

  it.each(['pearson', 'spearman', 'kendall'] as const)(
    'equivalence tests of %s correlations, bound 0.4',
    async (method) => {
      const r = await correlationR(data(ref.mtcars), {
        vars: ['mpg', 'wt', 'qsec'],
        method,
        alternative: 'two.sided',
        deletion: 'pairwise',
        confidence: 0.95,
        tostBound: 0.4,
      });
      r.pairs.forEach((p, i) => {
        const w = ref.corTost[method][i];
        const what = `${method} ${p.a} – ${p.b}`;
        close(`${what}: estimate`, p.tost!.r, w.r);
        close(`${what}: z`, p.tost!.z, w.z);
        close(`${what}: p`, p.tost!.p, w.p);
        close(`${what}: CI low`, p.tost!.ciLow, w.ciLow);
        close(`${what}: CI high`, p.tost!.ciHigh, w.ciHigh);
      });
      const script = await correlationScriptR(data(ref.mtcars), {
        vars: ['mpg', 'wt'],
        method,
        alternative: 'two.sided',
        deletion: 'pairwise',
        confidence: 0.95,
        tostBound: 0.4,
      });
      expect(script).toMatch(/TOSTER::z_cor_test\(/);
    },
    600_000,
  );
});
