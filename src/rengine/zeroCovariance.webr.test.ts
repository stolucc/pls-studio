// A fixed-zero covariance between exogenous factors reaches lavaan as
// `a ~~ 0*b` (lavaan frees it by default). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { ModelSpec } from '../engine/types';
import { cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const data = parseCsv(
  readFileSync(
    join(
      __dirname,
      '..',
      'engine',
      '__fixtures__',
      'validation',
      'data',
      'holzinger_swineford.csv',
    ),
    'utf8',
  ),
).dataset;
const f = (name: string, indicators: string[]) => ({
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators,
});
const spec: ModelSpec = {
  constructs: [
    f('visual', ['x1', 'x2', 'x3']),
    f('textual', ['x4', 'x5', 'x6']),
    f('speed', ['x7', 'x8', 'x9']),
  ],
  paths: [
    { from: 'visual', to: 'speed' },
    { from: 'textual', to: 'speed' },
  ],
  covariances: [{ a: 'visual', b: 'textual', kind: 'construct', zero: true }],
};

it('lavaan fits the uncorrelated factors (lavaan 0.6-16 reference)', async () => {
  const r = await estimateCbLavaan(data, spec, 'casewise', 'ML');
  expect(r.fit.chisq).toBeCloseTo(121.471333, 3);
  expect(r.fit.df).toBe(25);
  expect(await cbScriptLavaan(data, spec, 'casewise', 'ML')).toContain('visual ~~ 0*textual');
}, 600_000);
