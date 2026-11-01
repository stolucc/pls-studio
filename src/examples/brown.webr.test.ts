// The Brown (2015) examples under lavaan in webR against native lavaan on the
// same matrices (scripts/validation/brown.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { makeBrownCopingExample, makeBrownMtmmExample, makeBrownNeExample, makeBrownReliabilityExample, makeBrownStressExample, makeBrownTauExample } from './brown';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Est = { lhs: string; op: string; rhs: string; group: number; est: number; se: number | null };
type Ref = Record<string, { chisq: number; df: number; cfi: number; rmsea: number; estimates: Est[] }>;
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'brown.json'), 'utf8')) as Ref;
const CASES = { ne: makeBrownNeExample, tau: makeBrownTauExample, mtmm: makeBrownMtmmExample, coping: makeBrownCopingExample, reliability: makeBrownReliabilityExample, stress: makeBrownStressExample };

it.each(Object.keys(CASES))('%s reproduces native lavaan, without a warning', async (key) => {
  const ex = CASES[key as keyof typeof CASES](DEFAULT_SETTINGS);
  const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
  const want = ref[key];
  const RENAMED: Record<string, Record<string, string>> = { tau: { Auditory: 'Auditory memory', Visual: 'Visual memory' } };
  const name = (x: string) => RENAMED[key]?.[x] ?? x;
  expect(r.converged, key).toBe(true);
  expect(r.warnings, key).toEqual([]);
  expect(r.fit.df).toBe(want.df);
  expect(r.fit.chisq).toBeCloseTo(want.chisq, 3);
  expect(r.fit.cfi).toBeCloseTo(want.cfi, 3);
  expect(r.fit.rmsea).toBeCloseTo(want.rmsea, 3);
  for (const w of want.estimates) {
    const pool = r.estimates.filter((e) => (e.op as string) === w.op && ((e.lhs === name(w.lhs) && e.rhs === name(w.rhs)) || (w.op === '~~' && e.lhs === name(w.rhs) && e.rhs === name(w.lhs))));
    if (!pool.length && (w.se === 0 || w.se === null)) continue;  // fixed parameters are not reported
    expect(pool.length, `${key}: ${w.lhs} ${w.op} ${w.rhs}`).toBeGreaterThan(0);
    expect(Math.min(...pool.map((e) => Math.abs(e.est - w.est))), `${key}: ${w.lhs} ${w.op} ${w.rhs}`).toBeLessThan(1e-4 * Math.max(1, Math.abs(w.est)));
  }
  // Brown's Table 8.8: the reliabilities of the two scales, .919 and .823 with the model-implied variance of the sum (his MODEL
  // CONSTRAINT); semTools' omega divides by the observed variance: .9195 and .8234 (semTools compRelSEM, native and webR).
  if (key === 'reliability') { expect(r.reliability[0].omega).toBeCloseTo(0.9195, 3); expect(r.reliability[1].omega).toBeCloseTo(0.8234, 3); }
}, 600_000);
