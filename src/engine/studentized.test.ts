// Studentized (bootstrap-t) intervals: the formula by hand, and a run with inner bootstrap samples.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mergeBootstrap, runRange, studentizedInterval } from './bootstrap';
import { parseCsv } from './dataset';
import { bootQuantile } from './stats';
import { parseProject, DEFAULT_SETTINGS, serializeProject } from '../model/project';
import type { ModelSpec } from './types';

const data = parseCsv(readFileSync(join(__dirname, '__fixtures__', 'mobi.csv'), 'utf8')).dataset;
const K = (name: string, items: string[]) => ({
  name,
  mode: 'A' as const,
  type: 'factor' as const,
  indicators: items,
});
const spec: ModelSpec = {
  constructs: [K('EXPE', ['CUEX1', 'CUEX2', 'CUEX3']), K('SAT', ['CUSA1', 'CUSA2', 'CUSA3'])],
  paths: [{ from: 'EXPE', to: 'SAT' }],
};

describe('studentized intervals', () => {
  it('reflect the quantiles of the studentized draws around the estimate', () => {
    // t* from −2 to 2 in steps of 0.1 (41 draws), symmetric: its 97.5% limit (boot.ci's, about 1.95) is q.
    const t = Array.from({ length: 41 }, (_, i) => -2 + i * 0.1);
    const q = bootQuantile(Float64Array.from(t), 0.975);
    expect(bootQuantile(Float64Array.from(t), 0.025)).toBeCloseTo(-q, 10);
    const skew = t.map((v) => (v > 0 ? v * 2 : v));
    const a = studentizedInterval(t, 0.5, 0.1, 0.95);
    expect(a.ciLow).toBeCloseTo(0.5 - q * 0.1, 10);
    expect(a.ciHigh).toBeCloseTo(0.5 + q * 0.1, 10);
    // A long upper tail of t* lengthens the lower side: the interval is reflected.
    const b = studentizedInterval(skew, 0.5, 0.1, 0.95);
    expect(0.5 - b.ciLow).toBeCloseTo(2 * q * 0.1, 10);
    expect(b.ciHigh - 0.5).toBeCloseTo(q * 0.1, 10);
  });
  it('uses the one-tailed level', () => {
    const t = Array.from({ length: 41 }, (_, i) => -2 + i * 0.1);
    // one-tailed 95%: the 5% limit of t*, not the 2.5% one
    const q05 = bootQuantile(Float64Array.from(t), 0.05);
    expect(studentizedInterval(t, 0, 1, 0.95, 1).ciHigh).toBeCloseTo(-q05, 10);
    expect(studentizedInterval(t, 0, 1, 0.95, 1).ciHigh).not.toBeCloseTo(
      -bootQuantile(Float64Array.from(t), 0.025),
      3,
    );
  });
  it('ignores failed draws', () => {
    // three finite draws: the 25% limit is the first order statistic ((3 + 1) · .25 = 1), so ciHigh = 1
    expect(studentizedInterval([NaN, -1, 0, 1], 0, 1, 0.5).ciHigh).toBeCloseTo(1, 10);
  });
  const range = (start: number, end: number, inner?: number) =>
    runRange({
      job: 'pls',
      data,
      spec,
      options: {},
      seed: 11,
      start,
      end,
      ...(inner ? { innerSamples: inner } : {}),
    });
  it('come from an inner bootstrap, deterministic and independent of how the work is split', () => {
    const whole = mergeBootstrap([range(0, 12, 10)], 0.95);
    expect(whole.interval).toBe('studentized');
    const split = mergeBootstrap([range(0, 5, 10), range(5, 12, 10)], 0.95);
    expect(split.stats.map((s) => [s.ciLow, s.ciHigh])).toEqual(
      whole.stats.map((s) => [s.ciLow, s.ciHigh]),
    );
    const plain = mergeBootstrap([range(0, 12)], 0.95);
    expect(plain.interval).toBeUndefined();
    const key = 'path:EXPE:SAT';
    const s = whole.stats.find((x) => x.key === key)!,
      p = plain.stats.find((x) => x.key === key)!;
    expect([s.mean, s.sd, s.p]).toEqual([p.mean, p.sd, p.p]); // same draws, only the interval differs
    expect(s.ciLow).not.toBe(p.ciLow);
    expect(s.ciLow).toBeLessThan(s.ciHigh);
  });
  it('survive a project file', () => {
    const text = serializeProject(
      { constructs: [], paths: [], moderations: [] },
      { ...DEFAULT_SETTINGS, bootInterval: 'studentized' },
      null,
      null,
      null,
    );
    expect(parseProject(text).settings.bootInterval).toBe('studentized');
  });
});
