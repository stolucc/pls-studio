// The Brown (2015) examples under lavaan in webR against native lavaan on the
// same matrices (scripts/validation/brown.R) and against the chi-squares and
// estimates the book prints. Run with npm run test:webr.

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
/** The chi-squares Brown (2015) prints for these models (chapters 4, 6, 7, 8; the book rounds to two or three decimals). */
const BOOK: Record<string, { chisq: number; df: number; tol: number }> = {
  ne: { chisq: 13.285, df: 19, tol: 0.001 }, mtmm: { chisq: 14.37, df: 15, tol: 0.006 }, tau: { chisq: 5.66, df: 10, tol: 0.006 },
  coping: { chisq: 83.004, df: 49, tol: 0.002 }, reliability: { chisq: 20.52, df: 18, tol: 0.006 }, stress: { chisq: 2.17, df: 22, tol: 0.006 },
};
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
  // As the book prints it.
  expect(r.fit.df, `${key} df (Brown)`).toBe(BOOK[key].df);
  expect(Math.abs(r.fit.chisq - BOOK[key].chisq), `${key}: ${r.fit.chisq} vs Brown ${BOOK[key].chisq}`).toBeLessThan(BOOK[key].tol);
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
  // Brown's Table 8.12 (Mplus output): STRESS BY SATIS 0.317, OPTIM 0.338; STRESS ON X1 1 (fixed), X2 1.054, X3 1.073
    // (within 0.001: three printed decimals and Mplus's looser convergence criterion, as for the Mplus examples).
  if (key === 'stress') {
    const e = (op: string, lhs: string, rhs: string) => r.estimates.find((x) => (x.op as string) === op && x.lhs === lhs && x.rhs === rhs)!.est;
    expect(Math.abs(e('=~', 'Stress', 'Satisfaction') - 0.317)).toBeLessThan(0.001);
    expect(Math.abs(e('=~', 'Stress', 'Optimism') - 0.338)).toBeLessThan(0.001);
    expect(Math.abs(e('~', 'Stress', 'X2') - 1.054)).toBeLessThan(0.001);
    expect(Math.abs(e('~', 'Stress', 'X3') - 1.073)).toBeLessThan(0.001);
  }
}, 600_000);
