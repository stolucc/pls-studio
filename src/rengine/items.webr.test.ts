// IRT (ltm) and latent class analysis (poLCA) in webR, against desktop R
// (scripts/validation/items.R): ltm 1.2-0 in both; poLCA 1.6.0.1 (desktop) vs
// 1.6.0.2 (webR), a patch release. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { irtR, irtScriptR, lcaR, type IrtModel } from './items';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'engine', '__fixtures__', 'items');
const load = (f: string) => parseCsv(readFileSync(join(DIR, f), 'utf8')).dataset;
const ref = JSON.parse(readFileSync(join(DIR, 'items.json'), 'utf8'));

describe('item response theory (ltm)', () => {
  it.each([['rasch', 'lsat.csv', 'rasch'], ['twopl', 'lsat.csv', 'twopl'], ['grm', 'science.csv', 'grm']] as const)('%s matches ltm', async (model, file, key) => {
    const d = load(file);
    const r = await irtR(d, d.names, model as IrtModel);
    const theirs = ref.irt[key];
    expect(r.logLik).toBeCloseTo(theirs.logLik, 4);
    expect(r.aic).toBeCloseTo(theirs.aic, 4);
    r.params.forEach((p, i) => {
      for (const [k, v] of Object.entries(theirs.coef[i] as Record<string, number>)) expect(p.values[k], `${p.item} ${k}`).toBeCloseTo(v, 4);
    });
    expect(r.information).toHaveLength(d.names.length);
    expect(r.theta[0]).toBe(-4);
    expect(r.reliability!).toBeGreaterThan(0);
    if (model === 'twopl') expect(await irtScriptR(d, d.names, 'twopl')).toContain('ltm(items ~ z1)');
  }, 600_000);
});

describe('latent class analysis (poLCA)', () => {
  it('2 and 3 classes match poLCA (classes ordered by size)', async () => {
    const d = load('values.csv');
    const r = await lcaR(d, ['A', 'B', 'C', 'D'], [2, 3], 10, 20261029);
    r.models.forEach((m, i) => {
      const t = ref.lca[i];
      expect(m.k).toBe(t.k);
      expect(m.llik).toBeCloseTo(t.llik, 3);
      expect(m.bic).toBeCloseTo(t.bic, 3);
      expect([...m.shares].sort()).toEqual(t.shares.map((x: number) => expect.closeTo(x, 3)));
      expect(m.probs[0].byClass).toHaveLength(m.k);
    });
  }, 600_000);
});
