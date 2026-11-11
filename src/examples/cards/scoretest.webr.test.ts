// The Score-based invariance test card against strucchange run natively (scripts/validation/scoretest.R →
// src/engine/__fixtures__/scoretest/reference.json): the published example (Wang, Merkle & Zeileis 2014; Merkle, Fan &
// Zeileis 2014) on the publications' 1327 complete cases, every test; the home-screen example on all rows, through its
// card; and a continuous covariate on the Holzinger & Swineford CFA (strucchange's own vcov = "info"). Run in the
// browser's R (npm run test:webr) or with PS_NATIVE_R=1 in desktop R.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset, ModelSpec } from '../../engine/types';
import { categoriesOf } from '../../io';
import { DEFAULT_SETTINGS } from '../../model/project';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import type { ScoreView } from '../../analyses/scoretest';
import { rCall, type RPackage } from '../../rengine/bridge';
import type { CbCall } from '../../rengine/cbExtras';
import {
  scoreTestR,
  scoreTestScriptR,
  type ScoreFn,
  type ScoreScale,
} from '../../rengine/scoretest';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { exampleModel, exampleSettings, PACKAGE_EXAMPLES, panelPreset } from '../packages';
import { against, example as exampleCheck, near, same } from '../../validation/record';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

interface T {
  statistic: number;
  p: number;
}
const REF = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', 'engine', '__fixtures__', 'scoretest', 'reference.json'),
    'utf8',
  ),
) as {
  R: string;
  strucchange: string;
  lavaan: string;
  published: { n: number; rows: number[]; tests: Record<ScoreFn, T> };
  example: { n: number; tests: Record<ScoreFn, T>; all: Record<string, T>; npar: number };
  hs: {
    n: number;
    loadings: Record<string, T>;
    all: Record<string, T>;
    variances: Record<string, T>;
    ordinal: Record<string, T>;
    dmComponents: number[];
  };
};
const SOURCE = {
  label: `strucchange ${REF.strucchange} on lavaan ${REF.lavaan} in desktop ${REF.R}: scripts/validation/scoretest.R`,
  level: 'native' as const,
  script: 'scripts/validation/scoretest.R',
};
/** A comparison outside an example's record (the published subset, the Holzinger & Swineford checks). */
// Relative to the size of the value: the statistics come from lavaan's fit, which webR's floating point moves by ~1e-6.
const close = (what: string, got: number, want: number, tol: number) =>
  expect(Math.abs(got - want), `${what}: |${got} − ${want}|`).toBeLessThanOrEqual(
    tol * Math.max(1, Math.abs(want)),
  );
const SCALE: Record<ScoreFn, ScoreScale> = {
  DM: 'continuous',
  CvM: 'continuous',
  maxLM: 'continuous',
  WDMo: 'ordinal',
  maxLMo: 'ordinal',
  LMuo: 'categorical',
};

async function load(pkg: string, name: string): Promise<Dataset> {
  const raw = await rCall<{
    names: string[];
    cols: (number | null)[][];
    levels?: Record<string, string[]>;
  }>('ps_dataset', { package: pkg, name, na: [] }, pkg as RPackage);
  return {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
    ...categoriesOf(raw.levels),
  };
}
/** The rows of a dataset (1-based, as R gives them). */
const rows = (d: Dataset, keep: number[]): Dataset => ({
  ...d,
  cols: d.cols.map((c) => Float64Array.from(keep, (i) => c[i - 1])),
});

const GQ6: ModelSpec = {
  constructs: [
    {
      name: 'f1',
      type: 'factor',
      mode: 'A',
      indicators: ['gq6_1', 'gq6_2', 'gq6_3', 'gq6_4', 'gq6_5'],
    },
  ],
  paths: [],
  multigroup: { column: 'agegroup', invariance: 'metric', free: [] },
};
const HS: ModelSpec = {
  constructs: [
    { name: 'visual', type: 'factor', mode: 'A', indicators: ['x1', 'x2', 'x3'] },
    { name: 'textual', type: 'factor', mode: 'A', indicators: ['x4', 'x5', 'x6'] },
    { name: 'speed', type: 'factor', mode: 'A', indicators: ['x7', 'x8', 'x9'] },
  ],
  paths: [],
  covariances: [
    { a: 'visual', b: 'textual', kind: 'construct' },
    { a: 'visual', b: 'speed', kind: 'construct' },
    { a: 'textual', b: 'speed', kind: 'construct' },
  ],
};

describe('score-based invariance tests (strucchange)', () => {
  it('reproduces the published example: every test of the four loadings along age group (n = 1327, seed 1090)', async () => {
    const yg = await load('psychotools', 'YouthGratitude');
    const call: CbCall = {
      data: rows(yg, REF.published.rows),
      spec: GQ6,
      missing: 'casewise',
      estimator: 'ML',
      interaction: 'product',
    };
    for (const fn of ['LMuo', 'DM', 'CvM', 'maxLM', 'WDMo', 'maxLMo'] as ScoreFn[]) {
      const r = await scoreTestR(call, {
        covariate: 'agegroup',
        scale: SCALE[fn],
        fn,
        sets: ['loadings'],
        seed: 1090,
        nrep: 50000,
      });
      expect(r.n).toBe(1327);
      expect(r.params.length).toBe(4);
      close(`${fn} statistic`, r.statistic, REF.published.tests[fn].statistic, 1e-4);
      // (WDMo's p is a randomised quadrature, seeded alike; maxLMo's from the same simulated critical values)
      close(`${fn} p`, r.p, REF.published.tests[fn].p, fn === 'WDMo' ? 1e-4 : 1e-4);
      expect(r.params.every((p) => p.endsWith('all groups (equal)'))).toBe(true);
    }
    // the published numbers themselves (Wang, Merkle & Zeileis 2014: p; Merkle, Fan & Zeileis 2014: WDMo and maxLMo)
    expect(REF.published.tests.LMuo.statistic).toBeCloseTo(31.4, 1);
    expect(REF.published.tests.LMuo.p).toBeCloseTo(0.05018, 5);
    expect(REF.published.tests.DM.p).toBeCloseTo(0.03804, 5);
    expect(REF.published.tests.CvM.p).toBeCloseTo(0.11557, 4);
    expect(REF.published.tests.maxLM.p).toBeCloseTo(0.00414, 5);
    expect(REF.published.tests.WDMo.statistic).toBeCloseTo(2.91, 2);
    expect(REF.published.tests.maxLMo.statistic).toBeCloseTo(11.16, 2);
  }, 900_000);

  it('the home-screen example runs through its card as the native reference (all 1405 rows)', async () => {
    const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'strucchange-gratitude-agegroup')!;
    exampleCheck(ex.id, {
      title: ex.title,
      method: 'CB-SEM',
      packages: ['strucchange', 'lavaan'],
      definition: ex,
    });
    const data = await load(ex.data.package, ex.data.name);
    const ctx: AnalysisCtx = {
      data,
      info: null,
      settings: exampleSettings(DEFAULT_SETTINGS, ex.settings),
      pls: null,
      projectName: ex.title,
      model: exampleModel(ex),
    };
    const t = analysisType('scoretest')!;
    const o = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(ex.panel!) })!;
    expect(t.blocked(o, ctx)).toBeNull();
    const r = (await t.run(o, ctx, () => {})) as ScoreView;
    against(SOURCE);
    same('N', r.n, REF.example.n);
    near('WDMo', r.statistic, REF.example.tests.WDMo.statistic, 1e-4);
    near('WDMo p', r.p, REF.example.tests.WDMo.p, 1e-4);
    expect(r.warnings).toEqual([]);
    // the chart: one split per category but the last, its maximum is the statistic; labels are the age groups
    expect(r.series.labels).toEqual(['1', '2', '3', '4', '5']);
    expect(r.categoryLabels).toEqual(['10-11', '12-13', '14', '15', '16', '17-19']);
    expect(Math.max(...r.series.y)).toBeCloseTo(r.statistic, 10);
    expect(r.peak).toBe('4');
    const script = await t.script!(o, ctx);
    expect(script).toContain('library(strucchange)');
    expect(script).toContain(
      'scus <- gefp(fit, fit = NULL, order.by = z, vcov = info, sandwich = FALSE, parm = parm)',
    );
    expect(script).toContain('fun <- ordwmax(z)');
    // every free parameter (the 4 shared loadings and each group's own), and the other tests of the card
    const call: CbCall = {
      data,
      spec: GQ6,
      missing: 'casewise',
      estimator: 'ML',
      interaction: 'product',
    };
    const all = await scoreTestR(call, {
      covariate: 'agegroup',
      scale: 'categorical',
      fn: 'LMuo',
      sets: ['all'],
      seed: 1234,
      nrep: 50000,
    });
    same('parameters, all', all.params.length, REF.example.npar);
    near('LMuo, all parameters', all.statistic, REF.example.all.LMuo.statistic, 1e-4);
    for (const fn of ['LMuo', 'maxLMo', 'DM'] as ScoreFn[]) {
      const x = await scoreTestR(call, {
        covariate: 'agegroup',
        scale: SCALE[fn],
        fn,
        sets: ['loadings'],
        seed: 1234,
        nrep: 50000,
      });
      near(`${fn} (all rows)`, x.statistic, REF.example.tests[fn].statistic, 1e-4);
      near(`${fn} p (all rows)`, x.p, REF.example.tests[fn].p, 1e-4);
    }
  }, 900_000);

  it('a continuous covariate without constraints equals strucchange’s vcov = "info" (Holzinger & Swineford, along ageyr)', async () => {
    const hs = await load('lavaan', 'HolzingerSwineford1939');
    const call: CbCall = {
      data: hs,
      spec: HS,
      missing: 'casewise',
      estimator: 'ML',
      interaction: 'product',
    };
    for (const [sets, ref] of [
      [['loadings'], REF.hs.loadings],
      [['all'], REF.hs.all],
      [['residuals'], REF.hs.variances],
    ] as const) {
      for (const fn of ['DM', 'CvM', 'maxLM'] as ScoreFn[]) {
        const r = await scoreTestR(call, {
          covariate: 'ageyr',
          scale: 'continuous',
          fn,
          sets: [...sets],
          seed: 1234,
          nrep: 50000,
        });
        close(`${sets[0]} ${fn}`, r.statistic, ref[fn].statistic, 1e-4);
        close(`${sets[0]} ${fn} p`, r.p, ref[fn].p, 1e-4);
        if (fn === 'DM') {
          expect(Math.max(...r.series.y)).toBeCloseTo(r.statistic, 10);
          if (sets[0] === 'loadings') {
            r.componentMax.forEach((v, i) =>
              close(`DM component ${i + 1}`, v, REF.hs.dmComponents[i], 1e-4),
            );
            expect(r.params).toEqual([
              'visual → x2',
              'visual → x3',
              'textual → x5',
              'textual → x6',
              'speed → x8',
              'speed → x9',
            ]);
          }
        }
        if (fn === 'CvM') expect(r.series.y.length).toBeLessThanOrEqual(601);
        if (fn === 'maxLM') expect(Math.max(...r.series.y)).toBeCloseTo(r.statistic, 10);
      }
    }
    for (const fn of ['WDMo', 'maxLMo', 'LMuo'] as ScoreFn[]) {
      const r = await scoreTestR(call, {
        covariate: 'ageyr',
        scale: SCALE[fn],
        fn,
        sets: ['loadings'],
        seed: 1234,
        nrep: 50000,
      });
      close(`ageyr as ordinal: ${fn}`, r.statistic, REF.hs.ordinal[fn].statistic, 1e-4);
      close(`ageyr as ordinal: ${fn} p`, r.p, REF.hs.ordinal[fn].p, fn === 'WDMo' ? 1e-4 : 1e-4);
      if (fn === 'LMuo') expect(r.series.y.reduce((a, b) => a + b, 0)).toBeCloseTo(r.statistic, 8);
    }
  }, 900_000);

  it('refuses what the scores cannot test, and the script is self-contained', async () => {
    const hs = await load('lavaan', 'HolzingerSwineford1939');
    const call: CbCall = {
      data: hs,
      spec: HS,
      missing: 'casewise',
      estimator: 'ML',
      interaction: 'product',
    };
    await expect(
      scoreTestR(
        { ...call, estimator: 'WLSMV' },
        {
          covariate: 'ageyr',
          scale: 'continuous',
          fn: 'DM',
          sets: ['loadings'],
          seed: 1,
          nrep: 50000,
        },
      ),
    ).rejects.toThrow(/ML or MLR/);
    await expect(
      scoreTestR(call, {
        covariate: 'ageyr',
        scale: 'continuous',
        fn: 'DM',
        sets: ['intercepts'],
        seed: 1,
        nrep: 50000,
      }),
    ).rejects.toThrow(/none of the parameters/);
    await expect(
      scoreTestR(call, {
        covariate: 'ageyr',
        scale: 'continuous',
        fn: 'WDMo',
        sets: ['loadings'],
        seed: 1,
        nrep: 50000,
      }),
    ).rejects.toThrow(/Invalid test/);
    await expect(
      scoreTestR(call, {
        covariate: 'id',
        scale: 'ordinal',
        fn: 'WDMo',
        sets: ['loadings'],
        seed: 1,
        nrep: 50000,
      }),
    ).rejects.toThrow(/at most 50 values/);
    const script = await scoreTestScriptR(call, {
      covariate: 'ageyr',
      scale: 'continuous',
      fn: 'maxLM',
      sets: ['loadings', 'residuals'],
      seed: 1,
      nrep: 50000,
    });
    expect(script).toContain('data <- read.csv(text =');
    expect(script).toContain('sets <- c("loadings", "residuals")');
    expect(script).toContain('fun <- supLM(from = 0.1)');
    expect(script).toContain('test <- sctest(scus, functional = fun)');
  }, 900_000);
});
