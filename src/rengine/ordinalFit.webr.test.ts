// CB-SEM with ordinal indicators: the sample polychoric correlations and thresholds (Mplus SAMPSTAT) and
// each pair's bivariate fit (Mplus TECH10) in webR against desktop lavaan, psych::polychoric and one pair's
// X² and G² recomputed by hand (scripts/validation/ordinal_fit.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { ModelSpec } from '../engine/types';
import { estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const dir = join(__dirname, '..', 'engine', '__fixtures__', 'categorical');
const data = parseCsv(readFileSync(join(dir, 'bfi_ac.csv'), 'utf8')).dataset;
const ref = JSON.parse(readFileSync(join(dir, 'ordinal_fit.json'), 'utf8'));
const items: string[] = ref.items;
const f = (name: string, indicators: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators });
const spec: ModelSpec = { constructs: [f('agree', items.slice(0, 5)), f('consc', items.slice(5))], paths: [], covariances: [{ a: 'agree', b: 'consc', kind: 'construct' }], ordered: items };

it('sample polychoric correlations and thresholds (SAMPSTAT), and every pair’s bivariate fit (TECH10)', async () => {
  const r = await estimateCbLavaan(data, spec, 'casewise', 'WLSMV');
  const s = r.sampleCor!;
  expect(s.names).toEqual(items);
  expect(s.ordinal.every(Boolean)).toBe(true);
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
    expect(s.cor[i][j]).toBeCloseTo(ref.polychoric[i][j], 6);
    expect(s.cor[i][j]).toBeCloseTo(ref.psychPolychoric[i][j], 4);  // an independent estimate
  }
  expect(s.thresholds).toHaveLength(ref.thresholds.values.length);
  s.thresholds.forEach((t, k) => { expect(`${t.variable}|t${t.index}`).toBe(ref.thresholds.names[k]); expect(t.value).toBeCloseTo(ref.thresholds.values[k], 6); });

  const t10 = r.tech10!;
  expect(t10).toHaveLength(45);
  t10.forEach((p, k) => {
    expect([p.lhs, p.rhs]).toEqual([ref.tech10.lhs[k], ref.tech10.rhs[k]]);
    expect(p.df).toBe(ref.tech10.df[k]);
    for (const key of ['x2', 'x2p', 'g2', 'g2p'] as const) expect(p[key]).toBeCloseTo(ref.tech10[key][k], 4);
  });
  const hand = t10.find((p) => p.lhs === ref.byHand.lhs && p.rhs === ref.byHand.rhs)!;
  expect(hand.x2).toBeCloseTo(ref.byHand.x2, 4);
  expect(hand.g2).toBeCloseTo(ref.byHand.g2, 4);
}, 600_000);

it('continuous indicators: neither table', async () => {
  const r = await estimateCbLavaan(data, { ...spec, ordered: [] }, 'casewise', 'ML');
  expect(r.sampleCor).toBeUndefined();
  expect(r.tech10).toBeUndefined();
}, 600_000);
