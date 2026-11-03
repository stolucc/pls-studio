// The EQS manual examples under lavaan in webR against native lavaan on the
// same matrices (scripts/validation/eqs.R) and the chi-squares EQS prints.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { against, example, same } from '../validation/record';
import { builtinDefinition, nearest } from '../validation/textbook';
import { makeBagozziExample, makeHeadStartExample, makeHeadStartGroupsExample, makeOlssonExample, makeWertsExample } from './eqs';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Est = { lhs: string; op: string; rhs: string; group: number; est: number; se: number | null };
type Ref = Record<string, { chisq: number; df: number; cfi: number; rmsea: number; estimates: Est[]; eqs: { chisq: number; df: number } }>;
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'eqs.json'), 'utf8')) as Ref;
/** Construct names the app gives differently from the reference script. */
const RENAMED: Record<string, string> = { JobSat: 'Job satisfaction', Achieve: 'Achievement motivation', Esteem: 'Self-esteem', Perform: 'perform', Pre: 'Pre-test ability', Post: 'Post-test ability' };
/** The examples' ids (src/io.ts). */
const ID = { bagozzi: 'eqs-bagozzi', werts: 'eqs-werts', headStart: 'eqs-headstart', headStartGroups: 'eqs-headstart-groups', olsson: 'eqs-olsson' } as const;
const CASES = { bagozzi: makeBagozziExample, werts: makeWertsExample, headStart: makeHeadStartExample, headStartGroups: makeHeadStartGroupsExample, olsson: makeOlssonExample };

it.each(Object.keys(CASES))('%s reproduces native lavaan and the chi-square EQS prints', async (key) => {
  const ex = CASES[key as keyof typeof CASES](DEFAULT_SETTINGS);
  example(ID[key as keyof typeof CASES], { title: key, method: 'CB-SEM', packages: ['lavaan'], definition: builtinDefinition(ex) });
  const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
  const want = ref[key];
  expect(r.converged, key).toBe(true);
  against({ label: 'EQS 6 Structural Equations Program Manual (Bentler): printed output', level: 'published' });
  expect(r.fit.chisq, 'χ² (EQS)').toBeCloseTo(want.eqs.chisq, 3);
  same('df (EQS)', r.fit.df, want.eqs.df);
  against({ label: 'desktop lavaan on the same matrices, scripts/validation/eqs.R', script: 'scripts/validation/eqs.R', level: 'native' });
  same('df', r.fit.df, want.df);
  expect(r.fit.chisq, 'χ²').toBeCloseTo(want.chisq, 3);
  if (want.df > 0) { expect(r.fit.cfi, 'CFI').toBeCloseTo(want.cfi, 3); expect(r.fit.rmsea, 'RMSEA').toBeCloseTo(want.rmsea, 3); }
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
    nearest(`${w.lhs} ${w.op} ${w.rhs}${results.length > 1 ? ` (group ${w.group})` : ''}`, pool, w.est);
  }
  expect(r.warnings, key).toEqual([]);
}, 600_000);
