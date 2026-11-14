// The guided measurement invariance card (analyses/guidedInvariance.tsx) run as the Run button runs it, compared
// with desktop R written independently of the app's bridge (scripts/validation/guided_invariance.R →
// src/engine/__fixtures__/invariance/guided.json): semTools' own ?measEq.syntax example (datCat, ordinal items,
// Wu & Estabrook identification, delta and theta), lavaan's tutorial data by school with plain group.equal (ML and
// MLR), and binary items against lavaan's categorical group.equal.
// Run with WEBR_TESTS=1 PS_NATIVE_R=1 npx vitest run --dir src rengine/guidedInvariance (or in webR without
// PS_NATIVE_R). Tolerances: the card may run in webR (~1e-6 relative from WebAssembly floating point); optimiser
// results 1e-5, the rest 1e-6.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  guidedInvarianceAnalysis,
  type GuidedInvarianceOptions,
} from '../analyses/guidedInvariance';
import type { AnalysisCtx } from '../analyses/types';
import type { Dataset } from '../engine/types';
import { DEFAULT_SETTINGS, type ModelState, type Settings } from '../model/project';
import { near, same } from '../validation/record';
import { rCall } from './bridge';
import type { GuidedInvarianceResult } from './invariance';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const REF = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'invariance', 'guided.json'),
    'utf8',
  ),
).cases;

async function dataset(pkg: 'lavaan' | 'semTools', name: string): Promise<Dataset> {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset',
    { package: pkg, name, na: [] },
    'lavaan',
  );
  return {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
  };
}

const factor = (name: string, indicators: string[]) => ({
  id: name,
  name,
  type: 'factor',
  mode: 'A',
  indicators,
  x: 0,
  y: 0,
  side: 'left',
});

function context(
  data: Dataset,
  constructs: [string, string[]][],
  ordered: string[],
  settings: Partial<Settings>,
): AnalysisCtx {
  const model = {
    constructs: constructs.map(([n, i]) => factor(n, i)),
    paths: [],
    moderations: [],
    ordered,
  } as unknown as ModelState;
  return {
    data,
    info: null,
    settings: { ...DEFAULT_SETTINGS, method: 'cbsem', missing: 'casewise', ...settings },
    pls: null,
    projectName: 'p',
    model,
  };
}

async function run(o: GuidedInvarianceOptions, ctx: AnalysisCtx) {
  expect(guidedInvarianceAnalysis.blocked(o, ctx)).toBeNull();
  const r = (await guidedInvarianceAnalysis.run(o, ctx, () => {})) as GuidedInvarianceResult;
  expect(r.warnings).toEqual([]);
  return r;
}

const WHY = 'Wording differs between the two versions of the item.';

it('ordinal items: semTools ?measEq.syntax example (datCat), Wu & Estabrook steps, delta and theta, u3 intercept freed', async () => {
  const data = await dataset('semTools', 'datCat');
  const items = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'];
  const ctx = context(
    data,
    [
      ['FU1', items.slice(0, 4)],
      ['FU2', items.slice(4)],
    ],
    items,
    {},
  );
  for (const param of ['delta', 'theta'] as const) {
    const ref = param === 'delta' ? REF.catDelta : REF.catTheta;
    const o: GuidedInvarianceOptions = {
      ...guidedInvarianceAnalysis.defaults(ctx),
      group: 'g',
      parameterization: param,
      strict: param === 'theta',
      free: [{ step: 'scalar', kind: 'intercept', item: 'u3', why: WHY }],
    };
    const r = await run(o, ctx);
    const steps =
      param === 'theta'
        ? 'configural thresholds metric scalar strict'
        : 'configural thresholds metric scalar';
    same(`${param}: steps`, r.steps.map((s) => s.step).join(' '), steps);
    same(`${param}: estimator`, r.estimator, 'WLSMV');
    r.steps.forEach((s, i) => {
      const f = ref.fit[i];
      near(`${param} ${s.step}: scaled χ²`, s.chisq!, f.chisq, 1e-5);
      same(`${param} ${s.step}: df`, s.df!, f.df);
      near(`${param} ${s.step}: scaled CFI`, s.cfi!, f.cfi, 1e-6);
      near(`${param} ${s.step}: scaled RMSEA`, s.rmsea!, f.rmsea, 1e-6);
      near(`${param} ${s.step}: SRMR`, s.srmr!, f.srmr, 1e-6);
      if (i > 0) {
        near(`${param} ${s.step}: Δχ² (lavTestLRT)`, s.chisqDiff!, ref.lrt.chisqDiff[i - 1], 1e-5);
        same(`${param} ${s.step}: Δdf`, s.dfDiff!, ref.lrt.dfDiff[i - 1]);
        near(`${param} ${s.step}: p`, s.p!, ref.lrt.p[i - 1], 1e-6);
      }
    });
    same(`${param}: lavTestLRT method`, r.steps[1].method ?? '', 'satorra.2000');
    r.means.forEach((m, k) => {
      near(`${param} ${m.factor}: latent mean difference`, m.est, ref.meanEst[k], 1e-5);
      near(`${param} ${m.factor}: its SE`, m.se, ref.meanSe[k], 1e-5);
      near(`${param} ${m.factor}: z`, m.z, ref.meanZ[k], 1e-4);
      near(`${param} ${m.factor}: CI lower`, m.lo, ref.meanLo[k], 1e-5);
      near(`${param} ${m.factor}: CI upper`, m.hi, ref.meanHi[k], 1e-5);
    });
    // Score tests of the metric step's loadings (two groups: each the univariate test of its one constraint)
    const metric = r.steps.find((s) => s.step === 'metric')!;
    ref.metricScoreItems.forEach((item: string, k: number) => {
      const cand = metric.candidates.find((x) => x.item === item)!;
      near(`${param} metric: score test of ${item}’s loading`, cand.x2, ref.metricScore[k], 1e-5);
    });
    expect(metric.candidates.every((x) => x.test === 'score.scaled')).toBe(true);
    // The scalar step's latent intercepts are fixed at 0 in both groups: modification indices (u3 is freed)
    const scalar = r.steps.find((s) => s.step === 'scalar')!;
    expect(scalar.candidates.some((x) => x.item === 'u3')).toBe(false);
    for (const cand of scalar.candidates) {
      const k = ref.scalarMiItems.indexOf(cand.item);
      expect(cand.test).toBe('mi');
      near(
        `${param} scalar: modification index of ${cand.item}’s intercept`,
        cand.x2,
        ref.scalarMi[k],
        1e-4,
      );
    }
    same(`${param}: no dMACS for ordinal items`, r.dmacs.length, 0);
    const script = await guidedInvarianceAnalysis.script!(o, ctx);
    expect(script).toContain('ID.cat = "Wu.Estabrook.2016"');
    expect(script).toContain('scalar = c("u3 ~ 1")');
    expect(script).not.toContain(WHY);
  }
}, 600_000);

it('continuous items: Holzinger & Swineford by school equals plain lavaan group.equal / group.partial, ML and MLR, with dMACS', async () => {
  const data = await dataset('lavaan', 'HolzingerSwineford1939');
  const fs: [string, string[]][] = [
    ['visual', ['x1', 'x2', 'x3']],
    ['textual', ['x4', 'x5', 'x6']],
    ['speed', ['x7', 'x8', 'x9']],
  ];
  for (const est of ['ML', 'MLR'] as const) {
    const ref = est === 'ML' ? REF.hsML : REF.hsMLR;
    const ctx = context(data, fs, [], { estimator: est });
    const o: GuidedInvarianceOptions = {
      ...guidedInvarianceAnalysis.defaults(ctx),
      group: 'school',
      strict: true,
      free: [
        { step: 'scalar', kind: 'intercept', item: 'x3', why: WHY },
        { step: 'scalar', kind: 'intercept', item: 'x7', why: WHY },
      ],
    };
    const r = await run(o, ctx);
    same(`${est}: steps`, r.steps.map((s) => s.step).join(' '), 'configural metric scalar strict');
    r.steps.forEach((s, i) => {
      const f = ref.fit[i];
      // (two routes to one model, measEq.syntax labels and lavaan's group.partial: the optimiser stops ~1e-6
      // relative apart, which the MLR scaling factor carries into its χ²)
      near(`${est} ${s.step}: χ²`, s.chisq!, f.chisq, 1e-6 * f.chisq);
      same(`${est} ${s.step}: df`, s.df!, f.df);
      near(`${est} ${s.step}: CFI`, s.cfi!, f.cfi, 1e-6);
      near(`${est} ${s.step}: RMSEA`, s.rmsea!, f.rmsea, 1e-6);
      if (i > 0) {
        // (the Satorra–Bentler difference divides by a difference of scaling factors, which magnifies that
        // optimiser gap to ~1e-5 relative for MLR)
        const tol = est === 'MLR' ? 1e-4 : 1e-5;
        near(`${est} ${s.step}: Δχ²`, s.chisqDiff!, ref.lrt.chisqDiff[i - 1], tol);
        near(`${est} ${s.step}: p`, s.p!, ref.lrt.p[i - 1], tol / 10);
      }
    });
    same(`${est}: CFI kind`, r.steps[0].cfiKind ?? '', est === 'MLR' ? 'robust' : 'standard');
    r.means.forEach((m, k) => {
      near(`${est} ${m.factor}: latent mean difference`, m.est, ref.meanEst[k], 1e-5);
      near(`${est} ${m.factor}: its SE`, m.se, ref.meanSe[k], 1e-5);
    });
    const metric = r.steps[1];
    ref.metricScoreItems.forEach((item: string, k: number) => {
      const cand = metric.candidates.find((x) => x.item === item)!;
      near(`${est} metric: score test of ${item}’s loading`, cand.x2, ref.metricScore[k], 1e-5);
    });
    same(`${est}: dMACS items`, r.dmacs.map((d) => d.item).join(' '), 'x3 x7');
    r.dmacs.forEach((d, k) => {
      // (the card's closed form against the reference's numerical integration, rel.tol 1e-10; both from
      // optimiser estimates of two routes to the same model, so 1e-5)
      near(`${est} ${d.item}: dMACS`, d.dmacs, ref.dmacs[k], 1e-5);
    });
  }
}, 600_000);

it('binary items: the scalar model equals lavaan’s categorical group.equal (scale factors 1 in every group)', async () => {
  const hs = await dataset('lavaan', 'HolzingerSwineford1939');
  // Each item split at its median (1 above it), as the reference does
  const items = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9'];
  const cols = hs.names.map((n, k) => {
    if (!items.includes(n)) return hs.cols[k];
    const sorted = Array.from(hs.cols[k]).sort((a, b) => a - b);
    const m = sorted.length;
    const median = m % 2 ? sorted[(m - 1) / 2] : (sorted[m / 2 - 1] + sorted[m / 2]) / 2;
    return Float64Array.from(hs.cols[k], (v) => (v > median ? 1 : 0));
  });
  const data: Dataset = { names: hs.names, cols };
  const ctx = context(
    data,
    [
      ['visual', ['x1', 'x2', 'x3']],
      ['textual', ['x4', 'x5', 'x6']],
      ['speed', ['x7', 'x8', 'x9']],
    ],
    items,
    {},
  );
  const o: GuidedInvarianceOptions = { ...guidedInvarianceAnalysis.defaults(ctx), group: 'school' };
  const r = await run(o, ctx);
  same('binary items', r.binary.join(' '), items.join(' '));
  same('thresholds step is no test', String(r.steps[1].equivalent), 'true');
  const scalar = r.steps.find((s) => s.step === 'scalar')!;
  const ref = REF.hsBinaryScalar;
  near('binary scalar: scaled χ²', scalar.chisq!, ref.chisq, 1e-5);
  same('binary scalar: df', scalar.df!, ref.df);
  near('binary scalar: scaled CFI', scalar.cfi!, ref.cfi, 1e-6);
  r.means.forEach((m, k) => {
    near(`binary ${m.factor}: latent mean difference`, m.est, ref.meanEst[k], 1e-5);
    near(`binary ${m.factor}: its SE`, m.se, ref.meanSe[k], 1e-5);
  });
}, 600_000);
