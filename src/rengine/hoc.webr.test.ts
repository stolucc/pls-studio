// The other second-order approaches against the packages run natively
// (scripts/validation/hoc-approaches.R): seminr with repeated indicators on
// its higher-order demo model (the composite of the dimensions' items, the
// dimensions as predictors), cSEM's embedded two-stage ("mixed") and repeated
// indicators as on its help page. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { exampleModel, PACKAGE_EXAMPLES } from '../examples/packages';
import { toSpec } from '../model/project';
import { rCall } from './bridge';
import { estimatePlsR, plsScriptR } from './pls';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'secondorder', 'approaches.json'),
    'utf8',
  ),
);

it('seminr with repeated indicators reproduces the hand-written seminr model', async () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'seminr-hoc')!;
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset',
    { package: 'seminr', name: 'mobi', na: [] },
    'seminr',
  );
  const data = {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
  };
  const spec = toSpec(exampleModel(ex));
  const options = {
    scheme: 'path' as const,
    consistent: false,
    missing: 'mean' as const,
    tolerance: 1e-7,
    maxIter: 300,
    hocApproach: 'repeated' as const,
  };
  const r = await estimatePlsR(data, spec, options, 'seminr');
  const C = r.constructs,
    at = (n: string) => C.indexOf(n);
  const want = ref.seminrRepeated;
  for (const [k, b] of Object.entries(want.paths as Record<string, number>)) {
    const [f, t] = k.split(' -> ');
    expect(r.pathCoef[at(f)][at(t)], k).toBeCloseTo(b, 5);
  }
  for (const [k, v] of Object.entries(want.r2 as Record<string, number>))
    expect(r.rSquared[at(k)], k).toBeCloseTo(v, 5);
  for (const comp of ['Image', 'Value']) {
    const h = r.higherOrder!.find(
      (x) => C[x.construct] === 'Satisfaction' && C[x.component] === comp,
    )!;
    expect(h.loading, comp).toBeCloseTo(want.secondOrder.loadings[comp], 5);
    expect(h.weight, comp).toBeCloseTo(want.secondOrder.weights[comp], 5);
    expect(r.hasPath[at(comp)][at('Satisfaction')]).toBe(true); // the dimensions' paths are part of the model
  }
  const script = await plsScriptR(data, spec, options, 'seminr');
  expect(script).toContain(
    'composite("Satisfaction", c("IMAG1", "IMAG2", "IMAG3", "IMAG4", "IMAG5", "PERV1", "PERV2"), weights = mode_A)',
  );
  expect(script).toContain(
    'paths(from = c("Expectation", "Quality", "Image", "Value"), to = "Satisfaction")',
  );
  expect(script).not.toContain('higher_composite');
}, 600_000);

it('refuses the embedded approach for seminr and names the alternative', async () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'seminr-hoc')!;
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset',
    { package: 'seminr', name: 'mobi', na: [] },
    'seminr',
  );
  const data = {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
  };
  await expect(
    estimatePlsR(
      data,
      toSpec(exampleModel(ex)),
      {
        scheme: 'path',
        consistent: false,
        missing: 'mean',
        tolerance: 1e-7,
        maxIter: 300,
        hocApproach: 'embedded',
      },
      'seminr',
    ),
  ).rejects.toThrow(/embedded two-stage approach is cSEM's/);
}, 600_000);
