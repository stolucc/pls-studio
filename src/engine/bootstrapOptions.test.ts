import { describe, expect, it } from 'vitest';
import { toSpec } from '../model/project';
import { makeSample } from '../sample';
import { mergeBootstrap, runRange, summarise } from './bootstrap';
import { estimatePls } from './pls';
import { pnorm, qnorm } from './stats';

describe('bootstrap options', () => {
  it('normal distribution and quantile functions are inverse', () => {
    for (const p of [0.001, 0.025, 0.3, 0.5, 0.9, 0.995])
      expect(pnorm(qnorm(p))).toBeCloseTo(p, 12);
  });

  it('one-tailed: half the two-tailed p, interval [α, 1 − α]', () => {
    const v = Array.from({ length: 101 }, (_, i) => i / 100);
    const two = summarise(v, 0.6, 0.9),
      one = summarise(v, 0.6, 0.9, 1);
    expect(one.p).toBeCloseTo(two.p / 2, 15);
    expect(two.ciLow).toBeCloseTo(0.05, 12);
    expect(two.ciHigh).toBeCloseTo(0.95, 12);
    expect(one.ciLow).toBeCloseTo(0.1, 12);
    expect(one.ciHigh).toBeCloseTo(0.9, 12);
  });

  it('BCa without bias or acceleration is the percentile interval; skewed jackknife shifts it', () => {
    const v = Array.from({ length: 1001 }, (_, i) => i / 1000);
    const flat = summarise(v, 0.5, 0.95, 2, [1, 2, 3, 4, 5]); // symmetric jackknife: a = 0; half the draws below 0.5: z0 = 0
    expect(flat.ciLow).toBeCloseTo(0.025, 2);
    expect(flat.ciHigh).toBeCloseTo(0.975, 2);
    const skew = summarise(v, 0.5, 0.95, 2, [0, 0, 0, 0, 10]);
    expect(skew.ciLow).not.toBeCloseTo(flat.ciLow, 3);
  });

  it('the built-in engine’s jackknife leaves each case out once (BCa from mergeBootstrap)', () => {
    const { data: raw, model } = makeSample(80, 5);
    // (complete cases only: the job's indices count the cases it analyses)
    const keep = Array.from({ length: raw.cols[0].length }, (_, r) => r)
      .filter((r) => raw.cols.every((c) => Number.isFinite(c[r])))
      .slice(0, 60);
    const data = { ...raw, cols: raw.cols.map((c) => Float64Array.from(keep, (r) => c[r])) };
    const spec = toSpec(model);
    // (tight convergence: the jackknife fits start from the full-sample weights)
    const opts = { tolerance: 1e-12, maxIter: 2000 };
    const part = runRange({
      job: 'pls',
      data,
      spec,
      options: opts,
      seed: 1,
      start: 0,
      end: 30,
      jackknife: true,
    });
    expect(part.jack).toHaveLength(part.params.length);
    expect(part.jack![0]).toHaveLength(60);
    const k = part.params.findIndex((p) => p.group === 'path');
    const [, from, to] = part.params[k].key.split(':');
    const without7 = {
      ...data,
      cols: data.cols.map((c) => Float64Array.from([...c.slice(0, 7), ...c.slice(8)])),
    };
    const r = estimatePls(without7, spec, opts);
    expect(part.jack![k][7]).toBeCloseTo(
      r.pathCoef[r.constructs.indexOf(from)][r.constructs.indexOf(to)],
      10,
    );
    const merged = mergeBootstrap([part], 0.95, { tails: 1 });
    expect(merged.interval).toBe('bca');
    expect(merged.tails).toBe(1);
    expect(mergeBootstrap([{ ...part, jack: undefined }], 0.95).interval).toBeUndefined();
  });
});
