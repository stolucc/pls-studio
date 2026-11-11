// Bollen & Curran (2004) under lavaan in webR against native lavaan (bollencurran.json). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { against, example, near, same } from '../validation/record';
import { builtinDefinition, nearest } from '../validation/textbook';
import { makeBollenCurranAltExample, makeBollenCurranLcmExample } from './bollencurran';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);
type Ref = {
  chisq: number;
  df: number;
  cfi: number;
  tli: number;
  estimates: { lhs: string; op: string; rhs: string; est: number; se: number | null }[];
};
const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'bollencurran.json'),
    'utf8',
  ),
) as Record<string, Ref>;

it.each([
  ['lcm', makeBollenCurranLcmExample],
  ['alt', makeBollenCurranAltExample],
] as const)(
  '%s reproduces native lavaan, without a warning',
  async (key, make) => {
    const ex = make(DEFAULT_SETTINGS);
    example(`bollen-curran-${key}`, {
      title: key,
      method: 'CB-SEM',
      packages: ['lavaan'],
      definition: builtinDefinition(ex),
    });
    against({
      label: 'desktop lavaan on the same matrix, scripts/validation/bollencurran.R',
      script: 'scripts/validation/bollencurran.R',
      level: 'native',
    });
    const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
    expect(r.converged).toBe(true);
    expect(r.warnings).toEqual([]);
    same('df', r.fit.df, ref[key].df);
    near('χ²', r.fit.chisq, ref[key].chisq, 0.001);
    // CFI and TLI against lavaan's baseline (the waves are components of intercept and slope, not exogenous variables).
    near('CFI', r.fit.cfi, ref[key].cfi, 1e-6);
    near('TLI', r.fit.tli, ref[key].tli, 1e-6);
    for (const w of ref[key].estimates) {
      const pool = r.estimates.filter(
        (e) =>
          e.op === w.op &&
          ((e.lhs === w.lhs && e.rhs === w.rhs) ||
            (w.op === '~~' && e.lhs === w.rhs && e.rhs === w.lhs)),
      );
      if (!pool.length && (w.se === 0 || w.se === null)) continue;
      expect(pool.length, `${key}: ${w.lhs} ${w.op} ${w.rhs}`).toBeGreaterThan(0);
      nearest(`${w.lhs} ${w.op} ${w.rhs}`, pool, w.est);
    }
  },
  600_000,
);
