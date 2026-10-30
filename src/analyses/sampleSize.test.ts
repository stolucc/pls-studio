import { describe, expect, it } from 'vitest';
import type { PlsResult } from '../engine/types';
import { DEFAULT_SETTINGS } from '../model/project';
import { minSampleSize, qnorm, sampleSizeAnalysis as t } from './sampleSize';
import type { AnalysisCtx } from './types';

describe('minimum sample size (Kock & Hadaya 2018)', () => {
  it('normal quantiles to machine precision (R’s qnorm)', () => {
    expect(qnorm(0.95)).toBeCloseTo(1.6448536269514722, 14);
    expect(qnorm(0.8)).toBeCloseTo(0.8416212335729143, 14);
    expect(qnorm(0.975)).toBeCloseTo(1.959963984540054, 14);
    expect(qnorm(1e-10)).toBeCloseTo(-6.361340902404056, 12);
    expect(qnorm(0.5)).toBe(0);
  });

  it('reproduces the paper: z = 2.486, and β_min = .197 needs 160 observations', () => {
    expect(qnorm(0.95) + qnorm(0.8)).toBeCloseTo(2.486, 3);
    expect(minSampleSize(0.197, 0.05, 0.8)).toBe(160);
    expect(minSampleSize(-0.197, 0.05, 0.8)).toBe(160);
    expect(minSampleSize(0.2, 0.05, 0.8, 2)).toBeGreaterThan(minSampleSize(0.2, 0.05, 0.8, 1));
  });

  it('uses the smallest path of the current results, or an expected value', async () => {
    const pls = { constructs: ['A', 'B', 'C'], n: 120, pathCoef: [[0, 0.5, 0.15], [0, 0, 0.4], [0, 0, 0]], hasPath: [[false, true, true], [false, false, true], [false, false, false]] } as unknown as PlsResult;
    const ctx: AnalysisCtx = { data: null, info: null, settings: DEFAULT_SETTINGS, pls, projectName: 'p' };
    const o = t.defaults(ctx);
    const r = await t.run(o, ctx, () => {});
    expect(r.betaMin).toBe(0.15);
    expect(r.nMin).toBe(minSampleSize(0.15, 0.05, 0.8));
    expect(r.paths.map((p) => `${p.from}${p.to}`)).toEqual(['AB', 'AC', 'BC']);
    expect(r.n).toBe(120);
    expect(t.blocked(o, { ...ctx, pls: null })).toContain('Calculate the PLS-SEM model first');
    expect(t.blocked({ ...o, source: 'manual' }, { ...ctx, pls: null })).toBeNull();
    expect((await t.run({ ...o, source: 'manual', beta: 0.197 }, { ...ctx, pls: null }, () => {})).nMin).toBe(160);
  });
});
