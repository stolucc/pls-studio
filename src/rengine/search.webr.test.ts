// Model search and modification through R (R/search.R). The specification search (Bollen's Political Democracy
// model, lavaan's ?sem) fixes left-out arrows at zero in the full model's parameter table; every one of its models
// must fit exactly as that model written out and fitted on its own (scripts/validation/specsearch.R). Equivalent
// models (Roth et al.'s path model, Kline's data): the replacing rules must give the six alternatives written by hand
// in scripts/validation/equivalent.R, each with the model's chi-square and df. The multivariate LM and Wald tests
// (Holzinger & Swineford) must take EQS's steps as scripts/validation/lmwald.R does with lavTestScore and lavTestWald.
// Run natively: WEBR_TESTS=1 PS_NATIVE_R=1 npx vitest run src/rengine/search.webr.test.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset, ModelSpec } from '../engine/types';
import { rCall } from './bridge';
import type { CbCall } from './cbExtras';
import { equivalentFitsR, equivalentFitsScriptR, lmWaldR, lmWaldScriptR, specSearchR, specSearchScriptR, type ArrowRef } from './search';
import { alternativesOf, sameFit } from '../analyses/equivalent';
import { toSpec, type ModelState } from '../model/project';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const F = (name: string, inds: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators: inds });
const POLDEM: ModelSpec = {
  constructs: [F('ind60', ['x1', 'x2', 'x3']), F('dem60', ['y1', 'y2', 'y3', 'y4']), F('dem65', ['y5', 'y6', 'y7', 'y8'])],
  paths: [{ from: 'ind60', to: 'dem60' }, { from: 'ind60', to: 'dem65' }, { from: 'dem60', to: 'dem65' }],
  covariances: [{ a: 'y1', b: 'y5', kind: 'indicator' }, { a: 'y4', b: 'y8', kind: 'indicator' }],
};
let pd: Dataset;
const call = (spec: ModelSpec = POLDEM): CbCall => ({ data: pd, spec, missing: 'casewise', estimator: 'ML', interaction: 'product' });
const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'search', `${name}.json`), 'utf8'));

beforeAll(async () => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'PoliticalDemocracy', na: [] }, 'lavaan');
  pd = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
}, 900_000);

describe('specification search (lavaan)', () => {
  const optional: ArrowRef[] = [{ type: 'path', from: 'ind60', to: 'dem65' }, { type: 'cov', kind: 'indicator', a: 'y1', b: 'y5' }, { type: 'cov', kind: 'indicator', a: 'y4', b: 'y8' }];
  it('fits every combination of the optional arrows as the models fitted one by one (native lavaan)', async () => {
    const r = await specSearchR(call(), optional);
    const ref = fixture('specsearch');
    expect(r.models).toHaveLength(8);
    for (const m of r.models) {
      const want = ref.models.find((x: { keep: boolean[] }) => x.keep.every((k, j) => k === m.keep[j]));
      expect(want, JSON.stringify(m.keep)).toBeTruthy();
      expect(m.converged, m.warning ?? '').toBe(true);
      expect(m.npar).toBe(want.npar);
      expect(m.df).toBe(want.df);
      expect(m.chisq!).toBeCloseTo(want.chisq, 5);
      expect(m.bic!).toBeCloseTo(want.bic, 4);
      expect(m.aic!).toBeCloseTo(want.aic, 4);
      expect(m.cfi!).toBeCloseTo(want.cfi, 6);
      expect(m.rmsea!).toBeCloseTo(want.rmsea, 6);
    }
    // (the first model keeps every optional arrow: the model on the canvas)
    expect(r.models[0].keep).toEqual([true, true, true]);
  }, 900_000);

  it('exports the script that runs the search, and refuses arrows that are not free parameters', async () => {
    const script = await specSearchScriptR(call(), optional);
    expect(script).toContain('fit_without <- function(drop)');
    expect(script).toContain('c("dem65", "~", "ind60")');
    await expect(specSearchR(call(), [{ type: 'path', from: 'dem65', to: 'ind60' }])).rejects.toThrow(/not a free parameter/);
    await expect(specSearchR(call(), [{ type: 'path', from: 'nope', to: 'dem65' }])).rejects.toThrow(/Unknown construct/);
    await expect(specSearchR({ ...call(), estimator: 'ULS' }, optional)).rejects.toThrow(/maximum-likelihood/);
  }, 900_000);
});

describe('equivalent models (lavaan)', () => {
  const ref = fixture('equivalent');
  const vars: string[] = ref.names;
  const V = (id: string) => ({ id, name: id[0].toUpperCase() + id.slice(1), type: 'factor' as const, mode: 'A' as const, indicators: [id], x: 0, y: 0, side: 'left' as const });
  // Roth et al. (1989): observed variables (single indicators without error), as Kline's path model
  const roth: ModelState = {
    constructs: vars.map(V), moderations: [],
    paths: [['exercise', 'fitness'], ['hardy', 'stress'], ['fitness', 'illness'], ['stress', 'illness']].map(([from, to], i) => ({ id: `p${i}`, from, to })),
    correlations: [{ id: 'k', kind: 'construct', a: 'exercise', b: 'hardy' }],
  };
  const data: Dataset = { names: vars, cols: [], moments: { S: ref.S, n: ref.n } };
  const cbCall = (): CbCall => ({ data, spec: toSpec(roth), missing: 'casewise', estimator: 'ML', interaction: 'product' });
  // lavaan syntax of an alternative, as scripts/validation/equivalent.R writes it
  const syntaxOf = (paths: { from: string; to: string }[], covs: { a: string; b: string }[]) => {
    const to = [...new Set(paths.map((p) => p.to))];
    return [...to.map((t) => `${t} ~ ${paths.filter((p) => p.to === t).map((p) => p.from).join(' + ')}`), ...covs.map((k) => `${k.a} ~~ ${k.b}`)];
  };
  const norm = (lines: string[]) => lines.map((l) => (l.includes('~~') ? l.split(' ~~ ').sort().join(' ~~ ') : l.replace(/~ (.*)$/, (_m, r: string) => `~ ${r.split(' + ').sort().join(' + ')}`))).sort().join('\n');

  it('gives exactly the six hand-written alternatives of Roth et al.’s model, each with its chi-square and df (native lavaan)', async () => {
    const { alternatives } = alternativesOf(roth, 50);
    expect(alternatives).toHaveLength(6);
    const want = ref.fits.filter((f: { name: string }) => f.name !== 'model').map((f: { syntax: string }) => norm(f.syntax.split('\n')));
    const got = alternatives.map((a) => norm(syntaxOf(a.paths, a.correlations.filter((k) => !k.zero))));
    expect(got.sort()).toEqual(want.sort());
    const variants = alternatives.map((a) => { const s = toSpec({ ...roth, paths: a.paths, correlations: a.correlations }); return { paths: s.paths, covariances: s.covariances }; });
    const r = await equivalentFitsR(cbCall(), variants);
    expect(r.fits).toHaveLength(7);
    for (const f of r.fits) {
      expect(f.converged).toBe(true);
      expect(f.df).toBe(5);
      expect(f.chisq!).toBeCloseTo(ref.fits[0].chisq, 6);
      expect(sameFit(r.fits[0], f)).toBe(true);
    }
    const script = await equivalentFitsScriptR(cbCall(), variants.slice(0, 2));
    expect(script).toContain('alternative_2 = ');
    expect(script).toContain('fit_simple <- function(m) sem(m, sample.cov = S, sample.nobs = N, estimator = "ML", auto.cov.y = FALSE, start = "simple")');
  }, 900_000);

  it('the Political Democracy triangle: every configuration of its saturated block fits alike', async () => {
    const C = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
    const pdm: ModelState = {
      constructs: [C('ind60', ['x1', 'x2', 'x3']), C('dem60', ['y1', 'y2', 'y3', 'y4']), C('dem65', ['y5', 'y6', 'y7', 'y8'])], moderations: [],
      paths: [{ id: 'a', from: 'ind60', to: 'dem60' }, { id: 'b', from: 'ind60', to: 'dem65' }, { id: 'c', from: 'dem60', to: 'dem65' }],
      correlations: [{ id: 'k1', kind: 'indicator', a: 'y1', b: 'y5' }],
    };
    const { alternatives } = alternativesOf(pdm, 50);
    expect(alternatives).toHaveLength(12);
    const variants = alternatives.map((a) => { const s = toSpec({ ...pdm, paths: a.paths, correlations: a.correlations }); return { paths: s.paths, covariances: s.covariances }; });
    const r = await equivalentFitsR({ data: pd, spec: toSpec(pdm), missing: 'casewise', estimator: 'ML', interaction: 'product' }, variants);
    for (const f of r.fits.slice(1)) expect(sameFit(r.fits[0], f), JSON.stringify(f)).toBe(true);
    expect(r.fits[0].df).toBe(40);
  }, 900_000);
});

describe('multivariate LM and Wald tests (lavaan)', () => {
  let hs: Dataset;
  beforeAll(async () => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
    hs = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  }, 900_000);
  const F = (name: string, inds: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators: inds });
  const A: ModelSpec = {
    constructs: [F('visual', ['x1', 'x2', 'x3']), F('textual', ['x4', 'x5', 'x6']), F('speed', ['x7', 'x8', 'x9'])],
    paths: [{ from: 'visual', to: 'textual' }, { from: 'textual', to: 'speed' }],
  };
  const B: ModelSpec = { ...A, paths: [...A.paths, { from: 'visual', to: 'speed' }], covariances: [['x1', 'x4'], ['x2', 'x7'], ['x3', 'x5']].map(([a, b]) => ({ a, b, kind: 'indicator' as const })) };
  const hsCall = (spec: ModelSpec): CbCall => ({ data: hs, spec, missing: 'casewise', estimator: 'ML', interaction: 'product' });
  const ref = fixture('lmwald');

  it('LM forward stepwise: EQS’s steps, the set’s total equal to lavTestScore(cumulative = TRUE) (native lavaan)', async () => {
    const r = await lmWaldR(hsCall(A), { lm: { kinds: ['loadings', 'paths', 'covariances'], maxCandidates: 500 }, wald: { kinds: [] }, alpha: 0.05 });
    expect(r.wald).toBeNull();
    expect(r.lm!.candidates).toBe(ref.lmCandidates);
    expect(r.lm!.steps.map((s) => s.lavaan)).toEqual(ref.lm.map((s: { parameter: string }) => s.parameter));
    r.lm!.steps.forEach((s, i) => {
      expect(s.chisq).toBeCloseTo(ref.lm[i].chisq, 4);
      expect(s.increment).toBeCloseTo(ref.lm[i].increment, 4);
      expect(s.df).toBe(i + 1);
    });
    expect(r.lm!.steps.at(-1)!.chisq).toBeCloseTo(ref.lavaanCumulative.chisq.at(-1), 4);
    // (the first step's statistic is the parameter's own modification index)
    expect(r.lm!.steps[0].univariate!).toBeCloseTo(r.lm!.steps[0].chisq, 4);
    expect(r.lm!.steps[0].label).toBe('visual → x9');
  }, 900_000);

  it('Wald backward stepwise: EQS’s steps with lavTestWald (native lavaan); the script runs the same', async () => {
    const r = await lmWaldR(hsCall(B), { lm: { kinds: [], maxCandidates: 60 }, wald: { kinds: ['paths', 'covariances'] }, alpha: 0.05 });
    expect(r.lm).toBeNull();
    expect(r.wald!.candidates).toBe(ref.waldCandidates);
    expect(r.wald!.steps.map((s) => s.lavaan)).toEqual(ref.wald.map((s: { parameter: string }) => s.parameter));
    r.wald!.steps.forEach((s, i) => { expect(s.chisq).toBeCloseTo(ref.wald[i].chisq, 4); expect(s.increment).toBeCloseTo(ref.wald[i].increment, 4); });
    expect(r.wald!.steps[0].univariate!).toBeCloseTo(r.wald!.steps[0].chisq, 6);
    expect(r.wald!.steps[0].label).toBe('textual → speed');
    const script = await lmWaldScriptR(hsCall(B), { lm: { kinds: ['loadings'], maxCandidates: 10 }, wald: { kinds: ['paths'] }, alpha: 0.05 });
    expect(script).toContain('lavTestScore(fit, add = ');
    expect(script).toContain('lavTestWald(fit, constraints = ');
    await expect(lmWaldR(hsCall(B), { lm: { kinds: [], maxCandidates: 60 }, wald: { kinds: [] }, alpha: 0.05 })).rejects.toThrow(/Choose the parameters/);
  }, 900_000);
});
