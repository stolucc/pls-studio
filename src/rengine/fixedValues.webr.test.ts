// Parameters fixed at values reach lavaan as value*name. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { FIXED_CHISQ, FIXED_DF, FIXED_SPEC } from '../engine/__fixtures__/fixedValues';
import { cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const data = parseCsv(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'validation', 'data', 'holzinger_swineford.csv'), 'utf8')).dataset;

it('lavaan holds the fixed values (lavaan 0.6-16 reference)', async () => {
  const r = await estimateCbLavaan(data, FIXED_SPEC, 'casewise', 'ML');
  expect(r.fit.chisq).toBeCloseTo(FIXED_CHISQ, 3);
  expect(r.fit.df).toBe(FIXED_DF);
  expect(r.estimates.find((e) => e.lhs === 'speed' && e.op === '~' && e.rhs === 'visual')!.est).toBeCloseTo(0.3, 12);
  const script = await cbScriptLavaan(data, FIXED_SPEC, 'casewise', 'ML');
  for (const line of ['visual =~ 1*x1 + 0.6*x2 + x3', 'speed =~ 0.9*x7 + x8 + x9', 'speed ~ 0.3*visual + textual', 'visual ~~ 0.2*textual', 'x7 ~~ 0.1*x8']) expect(script).toContain(line);
}, 600_000);

it('refuses a fixed value that is not a number (project files are untrusted)', async () => {
  const bad = { ...FIXED_SPEC, paths: [{ from: 'visual', to: 'speed', fixed: '0.3); stop("x' as unknown as number }] };
  await expect(estimateCbLavaan(data, bad, 'casewise', 'ML')).rejects.toThrow(/Invalid fixed value/);
}, 600_000);
