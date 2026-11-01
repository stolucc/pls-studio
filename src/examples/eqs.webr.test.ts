// The EQS manual examples under lavaan in webR against native lavaan on the
// same matrices (scripts/validation/eqs.R) and the chi-squares EQS prints.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { makeBagozziExample, makeHeadStartExample, makeHeadStartGroupsExample, makeOlssonExample, makeWertsExample } from './eqs';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Est = { lhs: string; op: string; rhs: string; group: number; est: number; se: number | null };
type Ref = Record<string, { chisq: number; df: number; cfi: number; rmsea: number; estimates: Est[]; eqs: { chisq: number; df: number } }>;
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'eqs.json'), 'utf8')) as Ref;
/** Construct names the app gives differently from the reference script. */
const RENAMED: Record<string, string> = { JobSat: 'Job satisfaction', Achieve: 'Achievement motivation', Esteem: 'Self-esteem', Perform: 'perform', Pre: 'Pre-test ability', Post: 'Post-test ability' };
const CASES = { bagozzi: makeBagozziExample, werts: makeWertsExample, headStart: makeHeadStartExample, headStartGroups: makeHeadStartGroupsExample, olsson: makeOlssonExample };

it.each(Object.keys(CASES))('%s reproduces native lavaan and the chi-square EQS prints', async (key) => {
  const ex = CASES[key as keyof typeof CASES](DEFAULT_SETTINGS);
  const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
  const want = ref[key];
  expect(r.converged, key).toBe(true);
  expect(r.fit.df).toBe(want.df);
  expect(r.fit.chisq).toBeCloseTo(want.chisq, 3);
  expect(r.fit.chisq, `${key}: EQS`).toBeCloseTo(want.eqs.chisq, 3);
  expect(r.fit.df).toBe(want.eqs.df);
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
  expect(r.warnings, key).toEqual([]);
}, 600_000);
