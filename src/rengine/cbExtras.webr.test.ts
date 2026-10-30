// CB-SEM extras through webR on the Holzinger–Swineford CFA (lavaan's ?cfa):
// Bollen–Stine p equals lavaan's own test = "bollen.stine" (and native lavaan,
// scripts/validation/cbextras.R); pairwise z² equals lavaan's Wald test of the
// equality; factor score weights reproduce lavPredict's scores.
// Run with npm run test:webr.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset, ModelSpec } from '../engine/types';
import { rCall } from './bridge';
import commonR from './R/common.R?raw';
import { bollenStineR, compareParamsR, scoreWeightsR, type CbCall } from './cbExtras';
import { callJson, withR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const F = (name: string, inds: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators: inds });
const spec: ModelSpec = {
  constructs: [F('visual', ['x1', 'x2', 'x3']), F('textual', ['x4', 'x5', 'x6']), F('speed', ['x7', 'x8', 'x9'])],
  paths: [{ from: 'visual', to: 'textual' }, { from: 'visual', to: 'speed' }, { from: 'textual', to: 'speed' }],
};
const MODEL = 'visual =~ x1 + x2 + x3\ntextual =~ x4 + x5 + x6\nspeed =~ x7 + x8 + x9\ntextual ~ a*visual\nspeed ~ b*visual + c*textual';
let hs: Dataset;
const call = (): CbCall => ({ data: hs, spec, missing: 'casewise', estimator: 'ML', interaction: 'product' });
const inLavaan = <T,>(code: string) => withR(['jsonlite', 'lavaan'], { common: commonR }, (webR) => callJson(webR, `suppressPackageStartupMessages(library(lavaan)); fit <- sem("${MODEL.replace(/\n/g, '\\n')}", data = HolzingerSwineford1939); ${code}`, null)) as Promise<T>;

beforeAll(async () => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
  hs = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
}, 900_000);

describe('CB-SEM extras (lavaan)', () => {
  it('Bollen–Stine p equals lavaan’s test = "bollen.stine" with the same seed (and native lavaan)', async () => {
    const r = await bollenStineR(call(), { samples: 200, seed: 1 });
    const own = await inLavaan<{ p: number; stat: number }>('set.seed(1); f2 <- update(fit, test = "bollen.stine", bootstrap = 200); t <- lavInspect(f2, "test")$bollen.stine; ps_json(list(p = t$pvalue, stat = t$stat))');
    expect(r.p).toBeCloseTo(own.p, 12);
    expect(r.chisq).toBeCloseTo(own.stat, 8);
    expect(r.chisq).toBeCloseTo(r.mlChisq, 8);
    expect(r.df).toBe(24);
    if (r.boot.length) expect(r.boot.filter((t) => t >= r.chisq).length / r.boot.length).toBeCloseTo(r.p, 2);
    const refFile = join(__dirname, '..', 'engine', '__fixtures__', 'cbextras', 'reference.json');
    if (existsSync(refFile)) {
      const ref = JSON.parse(readFileSync(refFile, 'utf8'));
      expect(r.chisq).toBeCloseTo(ref.bollenStine.chisq, 6);
      expect(r.p).toBeCloseTo(ref.bollenStine.p, 2);
    }
  }, 900_000);

  it('pairwise z² equals lavaan’s Wald test of each equality', async () => {
    const r = await compareParamsR(call(), ['paths']);
    expect(r.params.map((p) => p.label)).toEqual(['visual → textual', 'visual → speed', 'textual → speed']);
    const wald = await inLavaan<Record<string, number>>('ps_json(list(ab = lavTestWald(fit, "a == b")$stat, ac = lavTestWald(fit, "a == c")$stat, bc = lavTestWald(fit, "b == c")$stat))');
    expect(r.z[1][0]! ** 2).toBeCloseTo(wald.ab, 8);
    expect(r.z[2][0]! ** 2).toBeCloseTo(wald.ac, 8);
    expect(r.z[2][1]! ** 2).toBeCloseTo(wald.bc, 8);
    expect(r.z[0][0]).toBeNull();
    const all = await compareParamsR(call(), ['loadings', 'variances']);
    expect(all.params.filter((p) => p.kind === 'loading')).toHaveLength(6);  // first loadings fixed at 1
    expect(all.params.filter((p) => p.kind === 'variance')).toHaveLength(12);
  }, 900_000);

  it('factor score weights reproduce lavPredict’s scores (regression and Bartlett)', async () => {
    for (const method of ['regression', 'Bartlett'] as const) {
      const r = await scoreWeightsR(call(), method);
      expect(r.factors).toEqual(['visual', 'textual', 'speed']);
      const ref = await inLavaan<{ scores: number[][]; x: number[][] }>(`ps_json(list(scores = unname(lavPredict(fit, method = "${method}")[1:5, ]), x = unname(scale(as.matrix(HolzingerSwineford1939[paste0("x", 1:9)]), scale = FALSE)[1:5, ])))`);
      const order = r.variables.map((v) => Number(v.slice(1)) - 1);
      ref.x.forEach((row, i) => r.factors.forEach((_, f) => {
        const s = order.reduce((acc, k, j) => acc + r.weights[f][j] * row[k], 0);
        expect(s, `${method} case ${i + 1} factor ${f + 1}`).toBeCloseTo(ref.scores[i][f], 8);
      }));
    }
  }, 900_000);

  it('says why it cannot run', async () => {
    const names = Array.from({ length: 9 }, (_, i) => `x${i + 1}`);
    const S = names.map((_, i) => names.map((__, j) => (i === j ? 1 : 0.3)));
    await expect(bollenStineR({ ...call(), data: { names, cols: [], moments: { S, n: 100 } } }, { samples: 20, seed: 1 })).rejects.toThrow(/raw data/);
    await expect(compareParamsR(call(), [])).rejects.toThrow('Choose which parameters');
  }, 900_000);
});
