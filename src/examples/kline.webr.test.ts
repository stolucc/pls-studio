// The Kline (2023) examples under lavaan in webR against native lavaan on the same
// matrices (scripts/validation/kline.R) and the chi-squares of Kline's output.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { makeKabcExample, makeLynamExample, makeRobbinsExample, makeRomneyExample, makeRothExample, makeSabatelliExample, makeSauveExample, makeWorlandExample } from './kline';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Est = { lhs: string; op: string; rhs: string; group: number; est: number; se: number | null; std: number | null };
type Ref = Record<string, { chisq: number; df: number; pvalue: number; cfi: number; rmsea: number; srmr: number; estimates: Est[]; kline: { chisq: number; df: number } }>;
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'kline.json'), 'utf8')) as Ref;
/** Construct names the app gives differently from the reference script. */
const RENAMED: Record<string, Record<string, string>> = { sabatelli: { Marital: 'Marital adjustment', FOE: 'Family of origin' } };
const CASES = {
  roth: makeRothExample, kabc: makeKabcExample, sabatelli: makeSabatelliExample, worland: makeWorlandExample,
  romneySomatic: (s: typeof DEFAULT_SETTINGS) => makeRomneyExample(s, 'somatic'), romneyMedical: (s: typeof DEFAULT_SETTINGS) => makeRomneyExample(s, 'medical'),
  lynam: makeLynamExample, robbins: makeRobbinsExample, sauve: makeSauveExample,
};

it.each(Object.keys(CASES))('%s reproduces native lavaan and the chi-square of Kline’s output', async (key) => {
  const ex = CASES[key as keyof typeof CASES](DEFAULT_SETTINGS);
  const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
  const want = ref[key];
  expect(r.converged, key).toBe(true);
  expect(r.fit.df).toBe(want.df);
  expect(r.fit.chisq).toBeCloseTo(want.chisq, 3);
  expect(r.fit.chisq).toBeCloseTo(want.kline.chisq, 2);
  expect(r.fit.cfi).toBeCloseTo(want.cfi, 3);
  expect(r.fit.rmsea).toBeCloseTo(want.rmsea, 3);
  // Every loading, path, covariance, intercept and defined parameter, by group.
  const results = r.groups ? r.groups.results : [r];
  const name = (x: string) => RENAMED[key]?.[x] ?? x;
  for (const w of want.estimates) {
    // Defined parameters by name; intercepts and means by the variable (the app leaves rhs empty).
    const pool = results[w.group - 1].estimates.filter((e) => (e.op as string) === w.op && (w.op === ':=' || w.op === '~1'
      ? e.lhs === name(w.lhs)
      : (e.lhs === name(w.lhs) && e.rhs === name(w.rhs)) || (w.op === '~~' && e.lhs === name(w.rhs) && e.rhs === name(w.lhs))));
    if (!pool.length && (w.se === 0 || w.se === null)) continue;  // a fixed parameter (an exogenous observed variable's variance, a zero covariance): not reported by the app
    expect(pool.length, `${key}: ${w.lhs} ${w.op} ${w.rhs} (group ${w.group})`).toBeGreaterThan(0);
    expect(Math.min(...pool.map((e) => Math.abs(e.est - w.est))), `${key}: ${w.lhs} ${w.op} ${w.rhs}`).toBeLessThan(1e-4 * Math.max(1, Math.abs(w.est)));
  }
  if (key === 'sabatelli') expect(r.warnings.join(' ')).toMatch(/negative/i);  // the Heywood case
  else expect(r.warnings, key).toEqual([]);
}, 600_000);
