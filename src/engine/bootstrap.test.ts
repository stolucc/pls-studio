import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootstrapPls } from './bootstrap';
import { parseCsv } from './dataset';
import { estimatePls } from './pls';
import type { ModelSpec } from './types';

const data = parseCsv(readFileSync(join(__dirname, '__fixtures__', 'mobi.csv'), 'utf8')).dataset;
const spec: ModelSpec = {
  constructs: [
    { name: 'Image', mode: 'A', indicators: ['IMAG1', 'IMAG2', 'IMAG3', 'IMAG4', 'IMAG5'] },
    { name: 'Satisfaction', mode: 'A', indicators: ['CUSA1', 'CUSA2', 'CUSA3'] },
    { name: 'Loyalty', mode: 'A', indicators: ['CUSL1', 'CUSL2', 'CUSL3'] },
  ],
  paths: [{ from: 'Image', to: 'Satisfaction' }, { from: 'Satisfaction', to: 'Loyalty' }, { from: 'Image', to: 'Loyalty' }],
};

describe('bootstrapPls', () => {
  const opts = { samples: 200, seed: 7, confidence: 0.95 };
  const res = bootstrapPls(data, spec, {}, opts);
  const get = (key: string) => res.stats.find((s) => s.key === key)!;

  it('reports original estimates identical to estimatePls', () => {
    const est = estimatePls(data, spec);
    expect(get('path:Image:Satisfaction').original).toBeCloseTo(est.pathCoef[0][1], 10);
    expect(get('r2:Loyalty').original).toBeCloseTo(est.rSquared[2]!, 10);
    expect(get('loading:IMAG1').original).toBeCloseTo(est.loadings[0], 10);
  });

  it('produces sane standard errors, intervals and p-values', () => {
    const p = get('path:Image:Satisfaction');
    expect(res.samples + res.failed).toBe(200);
    expect(p.sd).toBeGreaterThan(0.01);
    expect(p.sd).toBeLessThan(0.2);
    expect(p.ciLow).toBeLessThan(p.original);
    expect(p.ciHigh).toBeGreaterThan(p.original);
    expect(p.t).toBeCloseTo(Math.abs(p.original / p.sd), 10);
    expect(p.p).toBeLessThan(0.001);
  });

  it('includes indirect and total effects only where mediation exists', () => {
    expect(get('indirect:Image:Loyalty').original).toBeGreaterThan(0);
    expect(res.stats.find((s) => s.key === 'indirect:Image:Satisfaction')).toBeUndefined();
  });

  it('is reproducible for a given seed', () => {
    const again = bootstrapPls(data, spec, {}, opts);
    expect(again.stats.map((s) => s.sd)).toEqual(res.stats.map((s) => s.sd));
    const other = bootstrapPls(data, spec, {}, { ...opts, seed: 8 });
    expect(other.stats[0].sd).not.toBe(res.stats[0].sd);
  });

  it('reports progress and supports cancellation', () => {
    const seen: number[] = [];
    bootstrapPls(data, spec, {}, { ...opts, samples: 50 }, { onProgress: (d) => seen.push(d) });
    expect(seen.at(-1)).toBe(50);
    expect(() => bootstrapPls(data, spec, {}, opts, { shouldCancel: () => true })).toThrow(/cancelled/);
  });
});

describe('parallel bootstrapping', () => {
  it('gives identical results however samples are split across workers', async () => {
    const { runRange, mergeBootstrap, splitRanges } = await import('./bootstrap');
    const req = { job: 'pls' as const, data, spec, options: {}, seed: 99 };
    const whole = mergeBootstrap([runRange({ ...req, start: 0, end: 90 })], 0.95);
    // Ranges finishing out of order, as workers would.
    const parts = splitRanges(90, 4).map(([start, end]) => runRange({ ...req, start, end })).reverse();
    const split = mergeBootstrap(parts, 0.95);
    expect(split.stats).toEqual(whole.stats);
    expect(split.samples + split.failed).toBe(90);
  });

  it('splits sample ranges evenly without gaps', async () => {
    const { splitRanges } = await import('./bootstrap');
    expect(splitRanges(10, 3)).toEqual([[0, 3], [3, 6], [6, 10]]);
    expect(splitRanges(2, 8)).toEqual([[0, 1], [1, 2]]);
  });

  it('per-sample seeds differ across samples and seeds', async () => {
    const { sampleSeed } = await import('./bootstrap');
    const seen = new Set(Array.from({ length: 1000 }, (_, b) => sampleSeed(1234, b)));
    expect(seen.size).toBe(1000);
    expect(sampleSeed(1, 0)).not.toBe(sampleSeed(2, 0));
  });
});
