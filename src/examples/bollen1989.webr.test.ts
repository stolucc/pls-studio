// The Bollen (1989) examples under lavaan in webR against native lavaan on the
// same matrices (scripts/validation/bollen1989.R) and the values the book prints.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { makeAirQualityExample, makeDemocracyCfaExample, makeMoraleExample, makeSesErrorExample, makeSesExample, makeSesGroupsExample } from './bollen1989';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Est = { lhs: string; op: string; rhs: string; group: number; est: number; se: number | null };
type Ref = Record<string, { chisq: number; df: number; cfi: number; rmsea: number; estimates: Est[]; book: { chisq?: number; df?: number; est?: Record<string, number> } }>;
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'bollen1989.json'), 'utf8')) as Ref;
/** The reference script's names for the latent subjective income and prestige (the app names them after their indicator). */
const RENAMED: Record<string, string> = { SI: 'Subjective income', SP: 'Subjective prestige', Air: 'Air quality' };
const CASES = {
  ses: makeSesExample, sesError: makeSesErrorExample, sesGroups: makeSesGroupsExample, morale: makeMoraleExample,
  demUncorrelated: (s: typeof DEFAULT_SETTINGS) => makeDemocracyCfaExample(s, 'uncorrelated'), demCorrelated: (s: typeof DEFAULT_SETTINGS) => makeDemocracyCfaExample(s, 'correlated'),
  air: makeAirQualityExample,
};
/** Chi-squares the app (as native lavaan) gives on the printed matrices, against the book's: within its rounding of the matrices. */
const BOOK_TOL: Record<string, number> = { sesGroups: 0.06, morale: 0.07, demCorrelated: 0.2 };

it.each(Object.keys(CASES))('%s reproduces native lavaan and the book', async (key) => {
  const ex = CASES[key as keyof typeof CASES](DEFAULT_SETTINGS);
  const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
  const want = ref[key];
  expect(r.converged, key).toBe(true);
  expect(r.fit.df).toBe(want.df);
  expect(r.fit.chisq).toBeCloseTo(want.chisq, 3);
  if (want.book.chisq !== undefined) expect(Math.abs(r.fit.chisq - want.book.chisq), `${key}: the book's chi-square`).toBeLessThan(BOOK_TOL[key] ?? 0.05);
  if (want.book.df !== undefined) expect(r.fit.df).toBe(want.book.df);
  if (want.df > 0) { expect(r.fit.cfi).toBeCloseTo(want.cfi, 3); expect(r.fit.rmsea).toBeCloseTo(want.rmsea, 3); }
  const results = r.groups ? r.groups.results : [r];
  const name = (x: string) => RENAMED[x] ?? x;
  // Every free loading, path, (co)variance and intercept, by group, as native lavaan.
  for (const w of want.estimates) {
    if (w.se === 0 || w.se === null) continue;  // fixed (a marker, a covariate's moments)
    // (without the constant drawn the app lists the latent means, not the indicators' intercepts; the fit includes them)
    if (w.op === '~1' && ex.data.names.includes(w.lhs) && !ex.model.constant) continue;
    const pool = results[w.group - 1].estimates.filter((e) => (e.op as string) === w.op && (w.op === '~1' ? e.lhs === name(w.lhs)
      : (e.lhs === name(w.lhs) && e.rhs === name(w.rhs)) || (w.op === '~~' && e.lhs === name(w.rhs) && e.rhs === name(w.lhs))));
    expect(pool.length, `${key}: ${w.lhs} ${w.op} ${w.rhs} (group ${w.group})`).toBeGreaterThan(0);
    expect(Math.min(...pool.map((e) => Math.abs(e.est - w.est))), `${key}: ${w.lhs} ${w.op} ${w.rhs}`).toBeLessThan(1e-4 * Math.max(1, Math.abs(w.est)));
  }
  // The estimates the book prints, to its two decimals (three for the small prestige effect).
  for (const [k, v] of Object.entries(want.book.est ?? {})) {
    const [lhs, op, rhs] = k.includes('~~') ? [k.split('~~')[0], '~~', k.split('~~')[1]] : [k.split('~')[0], '~', k.split('~')[1]];
    const e = r.estimates.find((x) => x.op === op && ((x.lhs === name(lhs) && x.rhs === name(rhs)) || (op === '~~' && x.lhs === name(rhs) && x.rhs === name(lhs))));
    expect(e, `${key}: ${k}`).toBeTruthy();
    expect(Math.abs(e!.est - v), `${key}: ${k} = ${e!.est} (book ${v})`).toBeLessThanOrEqual(v === 0.007 ? 0.0005 : 0.006);  // (two decimals of LISREL VI: native lavaan gives .535 where the book prints .54)
  }
  expect(r.warnings, key).toEqual([]);
}, 600_000);
