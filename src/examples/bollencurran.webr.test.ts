// Bollen & Curran (2004) under lavaan in webR against native lavaan (bollencurran.json). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { makeBollenCurranAltExample, makeBollenCurranLcmExample } from './bollencurran';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);
type Ref = { chisq: number; df: number; estimates: { lhs: string; op: string; rhs: string; est: number; se: number | null }[] };
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'bollencurran.json'), 'utf8')) as Record<string, Ref>;

it.each([['lcm', makeBollenCurranLcmExample], ['alt', makeBollenCurranAltExample]] as const)('%s reproduces native lavaan, without a warning', async (key, make) => {
  const ex = make(DEFAULT_SETTINGS);
  const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
  expect(r.converged).toBe(true);
  expect(r.warnings).toEqual([]);
  expect(r.fit.df).toBe(ref[key].df);
  expect(Math.abs(r.fit.chisq - ref[key].chisq)).toBeLessThan(0.001);
  for (const w of ref[key].estimates) {
    const pool = r.estimates.filter((e) => e.op === w.op && ((e.lhs === w.lhs && e.rhs === w.rhs) || (w.op === '~~' && e.lhs === w.rhs && e.rhs === w.lhs)));
    if (!pool.length && (w.se === 0 || w.se === null)) continue;
    expect(pool.length, `${key}: ${w.lhs} ${w.op} ${w.rhs}`).toBeGreaterThan(0);
    expect(Math.min(...pool.map((e) => Math.abs(e.est - w.est))), `${key}: ${w.lhs} ${w.op} ${w.rhs}`).toBeLessThan(1e-4 * Math.max(1, Math.abs(w.est)));
  }
}, 600_000);
