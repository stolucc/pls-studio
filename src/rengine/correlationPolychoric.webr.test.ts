// The correlation card's polychoric method (lavaan's lavCor) in webR against desktop lavaan and, for the
// polychoric pairs, psych::polychoric (scripts/validation/correlation_polychoric.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { rCall } from './bridge';
import { correlationR, correlationScriptR } from './tests';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'categorical', 'correlation_polychoric.json'), 'utf8'));

it('polychoric, polyserial and Pearson pairs with standard errors, intervals and bivariate-normality tests', async () => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'psych', name: 'bfi', na: [] }, 'psych');
  const data: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  const input = { vars: ref.vars, method: 'polychoric' as const, alternative: 'two.sided' as const, deletion: 'pairwise' as const, confidence: 0.95 };
  const r = await correlationR(data, input);
  expect(r.ordinal).toEqual(ref.ordinal);  // age has more than 8 values
  expect(r.pairs).toHaveLength(6);
  for (const want of ref.pairs) {
    const got = r.pairs.find((p) => p.a === want.a && p.b === want.b)!;
    expect(got, `${want.a}–${want.b}`).toBeTruthy();
    expect(got.r).toBeCloseTo(want.r, 5);
    expect(got.se!).toBeCloseTo(want.se, 5);
    expect(got.stat).toBeCloseTo(want.z, 3);
    expect(got.ciLow!).toBeCloseTo(want.ciLow, 5);
    expect(got.ciHigh!).toBeCloseTo(want.ciHigh, 5);
    expect(got.p).toBeCloseTo(want.p, 6);
  }
  const kind = (a: string, b: string) => r.pairs.find((p) => p.a === a && p.b === b)!.kind;
  expect([kind('A1', 'A2'), kind('A1', 'gender'), kind('A1', 'age')]).toEqual(['polychoric', 'polychoric', 'polyserial']);
  // An independent estimate of the polychoric pairs.
  expect(r.pairs.find((p) => p.a === 'A1' && p.b === 'A2')!.r).toBeCloseTo(ref.psych.A1_A2, 2);
  expect(r.pairs.find((p) => p.a === 'A2' && p.b === 'gender')!.r).toBeCloseTo(ref.psych.A2_gender, 2);
  expect(r.normality).toHaveLength(3);
  for (const want of ref.normality) {
    const got = r.normality!.find((t) => t.a === want.a && t.b === want.b)!;
    expect(got.x2).toBeCloseTo(want.x2, 4);
    expect(got.g2).toBeCloseTo(want.g2, 4);
    expect(got.df).toBe(want.df);
  }
  // One-sided: half the two-sided p in the direction of the estimate.
  const less = await correlationR(data, { ...input, alternative: 'less' });
  const a1a2 = (x: typeof r) => x.pairs.find((p) => p.a === 'A1' && p.b === 'A2')!;
  expect(a1a2(less).p).toBeCloseTo(a1a2(r).p / 2, 10);
  expect(await correlationScriptR(data, input)).toContain('lavCor(data[, vars], ordered = ordinal, se = "standard", output = "fit", missing = "pairwise")');
}, 900_000);

it('refuses when no variable is ordinal', async () => {
  const data: Dataset = { names: ['x', 'y'], cols: [Float64Array.from({ length: 50 }, (_, i) => Math.sin(i) * 3.1), Float64Array.from({ length: 50 }, (_, i) => Math.cos(i * 1.3) + i / 7)] };
  await expect(correlationR(data, { vars: ['x', 'y'], method: 'polychoric', alternative: 'two.sided', deletion: 'pairwise', confidence: 0.95 })).rejects.toThrow(/nothing ordinal/);
}, 900_000);
