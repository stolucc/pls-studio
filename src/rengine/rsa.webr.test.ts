// Polynomial regression / response surface analysis in webR against native R
// (scripts/validation/rsa.R) on the RSA package's example (motcon): lavaan ML
// and MLR as RSA::RSA fits them, and OLS against lm + car::linearHypothesis.
// Native lavaan 0.6-16, webR 0.7-3. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { rsaR, rsaScriptR, type RsaInput } from './rsa';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'rsa', 'reference.json'), 'utf8'),
);
const data = parseCsv(
  readFileSync(join(__dirname, '..', '..', 'public', 'examples', 'rsa', 'motcon.csv'), 'utf8'),
).dataset;
const base: RsaInput = {
  outcome: 'postVA',
  x: 'ePow',
  y: 'iPow',
  controls: [],
  estimation: 'OLS',
  center: 'none',
  midpoint: 0,
  confidence: 0.95,
};

it.each(['ML', 'MLR'] as const)(
  'lavaan %s: surface parameters equal RSA::RSA',
  async (estimation) => {
    const r = await rsaR(data, { ...base, estimation });
    const want = ref[estimation];
    for (const k of ['a1', 'a2', 'a3', 'a4', 'a5', 'X0', 'Y0', 'p10', 'p11']) {
      const s = r.surface.find((x) => x.name === k)!;
      expect(s.est, k).toBeCloseTo(want[k].est, 6);
      expect(s.se!, `${k} se`).toBeCloseTo(want[k].se, 4);
    }
    expect(r.coefficients.find((x) => x.term === 'ePow²')!.est).toBeCloseTo(want.b3.est, 8);
  },
  900_000,
);

it('OLS: coefficients, R² and the surface tests equal lm + car::linearHypothesis', async () => {
  const r = await rsaR(data, base);
  expect(r.fit.r2).toBeCloseTo(ref.OLS.r2, 10);
  expect(r.coefficients.find((x) => x.term === 'ePow × iPow')!.est).toBeCloseTo(ref.OLS.b.XY, 10);
  for (const k of ['a1', 'a2', 'a3', 'a4', 'a5']) {
    const s = r.surface.find((x) => x.name === k)!;
    expect(s.stat! ** 2, k).toBeCloseTo(ref.OLS[k].F, 8);
    expect(s.p!).toBeCloseTo(ref.OLS[k].p, 10);
  }
  expect(r.steps.map((x) => x.step)).toEqual(['+ X and Y', '+ quadratic terms']);
  expect(r.grid).toHaveLength(21);
  expect(r.block).toHaveLength(84);
  expect(await rsaScriptR(data, base)).toContain(
    'fit <- lm(postVA ~ rsaX + rsaY + rsaX2 + rsaXY + rsaY2, data = data)',
  );
}, 900_000);

it('mean centring keeps the surface shape (curvatures unchanged)', async () => {
  const raw = await rsaR(data, base),
    cen = await rsaR(data, { ...base, center: 'mean' });
  for (const k of ['a2', 'a4', 'a5'])
    expect(cen.surface.find((x) => x.name === k)!.est).toBeCloseTo(
      raw.surface.find((x) => x.name === k)!.est,
      10,
    );
}, 900_000);
