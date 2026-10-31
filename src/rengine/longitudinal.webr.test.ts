// Latent growth curves and the RI-CLPM through lavaan in webR, against desktop
// lavaan 0.6-16 (scripts/validation/longitudinal.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { growthR, growthScriptR, riclpmR, type LongEstimate } from './longitudinal';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'engine', '__fixtures__', 'longitudinal');
const growthData = parseCsv(readFileSync(join(DIR, 'demo_growth.csv'), 'utf8')).dataset;
const panel = parseCsv(readFileSync(join(DIR, 'panel.csv'), 'utf8')).dataset;
const ref = JSON.parse(readFileSync(join(DIR, 'longitudinal.json'), 'utf8'));
type Ref = { fit: { chisq: number; df: number }; estimates: LongEstimate[] };
const check = (mine: { fit: { chisq?: number; df?: number }; estimates: LongEstimate[] }, theirs: Ref) => {
  expect(mine.fit.chisq!).toBeCloseTo(theirs.fit.chisq, 3);
  expect(mine.fit.df).toBe(theirs.fit.df);
  for (const e of theirs.estimates) {
    const m = mine.estimates.find((x) => x.lhs === e.lhs && x.op === e.op && x.rhs === e.rhs);
    expect(m, `${e.lhs} ${e.op} ${e.rhs}`).toBeTruthy();
    expect(m!.est).toBeCloseTo(e.est, 4);
  }
};
const t = ['t1', 't2', 't3', 't4'];

describe('latent growth curves', () => {
  it.each(['linear', 'quadratic', 'basis'] as const)('%s growth matches lavaan', async (shape) => {
    const r = await growthR(growthData, { measures: t, times: [0, 1, 2, 3], shape, covariates: [], estimator: 'ML', missing: 'casewise' });
    check(r, ref[shape]);
    if (shape === 'linear') r.impliedMeans.forEach((m, i) => expect(m).toBeCloseTo(ref.impliedMeansLinear[i], 5));
  }, 600_000);
  it('conditional growth (covariates predict intercept and slope) matches lavaan', async () => {
    const input = { measures: t, times: [0, 1, 2, 3], shape: 'linear' as const, covariates: ['x1', 'x2'], estimator: 'ML' as const, missing: 'casewise' as const };
    check(await growthR(growthData, input), ref.conditional);
    expect(await growthScriptR(growthData, input)).toContain('i + s ~ x1 + x2');
  }, 600_000);
  it('time-varying covariates (each occasion on its own) match the lavaan tutorial model', async () => {
    const input = { measures: t, times: [0, 1, 2, 3], shape: 'linear' as const, covariates: ['x1', 'x2'], timeVarying: ['c1', 'c2', 'c3', 'c4'], estimator: 'ML' as const, missing: 'casewise' as const };
    const r = await growthR(growthData, input);
    check(r, ref.timeVarying);
    expect(r.estimates.filter((e) => e.op === '~' && /^t\d$/.test(e.lhs)).map((e) => `${e.lhs} ~ ${e.rhs}`)).toEqual(['t1 ~ c1', 't2 ~ c2', 't3 ~ c3', 't4 ~ c4']);
    expect(await growthScriptR(growthData, input)).toContain('t3 ~ c3');
    await expect(growthR(growthData, { ...input, timeVarying: ['c1', 'c2'] })).rejects.toThrow(/one time-varying covariate per measurement occasion/);
  }, 600_000);
});

describe('RI-CLPM', () => {
  it.each([[false, 'riclpm'], [true, 'riclpmEqual']] as const)('equal lagged effects %s: matches lavaan, with the CLPM comparison', async (equal, key) => {
    const r = await riclpmR(panel, { x: ['x1', 'x2', 'x3', 'x4'], y: ['y1', 'y2', 'y3', 'y4'], equal, estimator: 'ML', missing: 'casewise' });
    check(r, ref[key]);
    if (!equal) {
      expect(r.clpmFit.chisq!).toBeCloseTo(ref.clpm.fit.chisq, 3);
      expect(r.comparison.chisqDiff).toBeCloseTo(ref.clpmVsRiclpm.chisqDiff, 3);
      expect(r.comparison.dfDiff).toBe(ref.clpmVsRiclpm.dfDiff);
    }
  }, 600_000);
});
