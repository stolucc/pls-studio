// The distribution-free estimator (ADF; EQS's AGLS; lavaan's WLS) in webR
// against native lavaan on the Holzinger & Swineford data (scripts/validation/adf.R).
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  makeCovariancesExplicit,
  newId,
  toSpec,
  validateModel,
  type ModelState,
} from '../model/project';
import { estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Ref = {
  data: { names: string[]; cols: number[][] };
  chisq: number;
  df: number;
  cfi: number;
  rmsea: number;
  estimates: { lhs: string; op: string; rhs: string; est: number; se: number }[];
};
const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'adf', 'reference.json'), 'utf8'),
) as Ref;

it('ADF (WLS) reproduces native lavaan: fit, estimates and standard errors', async () => {
  const data = { names: ref.data.names, cols: ref.data.cols.map((c) => Float64Array.from(c)) };
  const F = (name: string, indicators: string[]) => ({
    id: newId('c'),
    name,
    type: 'factor' as const,
    mode: 'A' as const,
    indicators,
    x: 0,
    y: 0,
    side: 'left' as const,
  });
  // (the three factors covary, as lavaan's cfa: drawn explicitly)
  const model: ModelState = makeCovariancesExplicit({
    constructs: [
      F('visual', ['x1', 'x2', 'x3']),
      F('textual', ['x4', 'x5', 'x6']),
      F('speed', ['x7', 'x8', 'x9']),
    ],
    paths: [],
    moderations: [],
  });
  const settings = {
    ...DEFAULT_SETTINGS,
    method: 'cbsem' as const,
    estimator: 'WLS' as const,
    engine: 'r' as const,
    missing: 'casewise' as const,
  };
  expect(validateModel(model, data, settings).filter((i) => i.level === 'error')).toEqual([]);
  const r = await estimateCbLavaan(data, toSpec(model), 'casewise', 'WLS', 'product');
  expect(r.converged).toBe(true);
  expect(r.fit.df).toBe(ref.df);
  expect(r.fit.chisq).toBeCloseTo(ref.chisq, 4);
  expect(r.fit.cfi).toBeCloseTo(ref.cfi, 4);
  expect(r.fit.rmsea).toBeCloseTo(ref.rmsea, 4);
  for (const w of ref.estimates) {
    const e = r.estimates.find(
      (x) =>
        (x.op as string) === w.op &&
        ((x.lhs === w.lhs && x.rhs === w.rhs) ||
          (w.op === '~~' && x.lhs === w.rhs && x.rhs === w.lhs)),
    );
    expect(e, `${w.lhs} ${w.op} ${w.rhs}`).toBeTruthy();
    expect(e!.est).toBeCloseTo(w.est, 5);
    expect(e!.se ?? NaN).toBeCloseTo(w.se, 5);
  }
}, 600_000);
