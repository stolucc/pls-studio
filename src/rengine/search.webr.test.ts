// Model search and modification through R (R/search.R) on Bollen's Political Democracy model (lavaan's ?sem).
// The specification search fixes left-out arrows at zero in the full model's parameter table; every one of its
// models must fit exactly as that model written out and fitted on its own (scripts/validation/specsearch.R).
// Run natively: WEBR_TESTS=1 PS_NATIVE_R=1 npx vitest run src/rengine/search.webr.test.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset, ModelSpec } from '../engine/types';
import { rCall } from './bridge';
import type { CbCall } from './cbExtras';
import { specSearchR, specSearchScriptR, type ArrowRef } from './search';
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
