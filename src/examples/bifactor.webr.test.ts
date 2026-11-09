// The bifactor example through lavaan as the app calls it, against plain lavaan calls with the study's settings.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { exampleModel, PACKAGE_EXAMPLES } from './packages';

const ROOT = join(__dirname, '..', '..');
const ref = JSON.parse(readFileSync(join(ROOT, 'src', 'engine', '__fixtures__', 'samples', 'bifactor_cpb.json'), 'utf8'));

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

describe.runIf(process.env.WEBR_TESTS)('sample-bifactor in lavaan', () => {
  it('reproduces the loadings and fit', async () => {
    const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'sample-bifactor')!;
    const data = parseCsv(readFileSync(join(ROOT, 'public', ex.data.file!), 'utf8')).dataset;
    const r = await estimateCbLavaan(data, toSpec(exampleModel(ex)), 'fiml', 'MLR');
    for (const e of ref.estimates as { lhs: string; rhs: string; est: number; se: number; std: number }[]) {
      const m = r.estimates.find((x) => x.op === '=~' && x.lhs === e.lhs && x.rhs === e.rhs)!;
      expect(m.est, `${e.lhs} → ${e.rhs}`).toBeCloseTo(e.est, 2);
      expect(m.se!, `se ${e.lhs} → ${e.rhs}`).toBeCloseTo(e.se, 2);
    }
    expect(r.fit.chisq).toBeCloseTo(ref.fit.chisq, 1);
    expect(r.fit.df).toBe(ref.fit.df);
  }, 300_000);
});
