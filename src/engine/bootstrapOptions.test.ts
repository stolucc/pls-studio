import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseProject, serializeProject, toSpec } from '../model/project';
import { makeSample } from '../sample';
import { mergeBootstrap, runRange, summarise } from './bootstrap';
import { estimatePls, preparePls } from './pls';
import { DEFAULT_OPTIONS } from './types';
import { buildPopulation, generateData, specFromPopulation } from './population';
import { bootQuantile, pnorm, qnorm } from './stats';

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
    // limits as boot.ci's (bootQuantile), at .05 / .95 two-tailed and .10 / .90 one-tailed
    const sorted = Float64Array.from(v);
    expect(two.ciLow).toBeCloseTo(bootQuantile(sorted, 0.05), 12);
    expect(two.ciHigh).toBeCloseTo(bootQuantile(sorted, 0.95), 12);
    expect(one.ciLow).toBeCloseTo(bootQuantile(sorted, 0.1), 12);
    expect(one.ciHigh).toBeCloseTo(bootQuantile(sorted, 0.9), 12);
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

  it('inadmissible PLSc draws: dropped by default (as cSEM), kept on request (as matrixpls)', () => {
    // Aguirre-Urreta & Rönkkö's simple model: K4 related to nothing, so many PLSc draws at N = 50 are inadmissible.
    const factor = (name: string) => ({
      name,
      type: 'factor' as const,
      indicators: [1, 2, 3].map((i) => `${name.toLowerCase()}_${i}`),
      loadings: [0.7, 0.8, 0.9],
    });
    const population = {
      constructs: ['K1', 'K2', 'K3', 'K4', 'E1'].map(factor),
      paths: [
        { from: 'K1', to: 'E1', value: 0.48 },
        { from: 'K2', to: 'E1', value: 0.48 },
        { from: 'K3', to: 'E1', value: 0.48 },
        { from: 'K4', to: 'E1', value: 0 },
      ],
      exoCor: [],
    };
    const data = generateData(buildPopulation(population), 50, 9);
    const spec = specFromPopulation(population);
    const run = (keepInadmissible: boolean) =>
      runRange({
        job: 'pls',
        data,
        spec,
        options: { consistent: true },
        seed: 3,
        start: 0,
        end: 200,
        keepInadmissible,
      });
    const finite = (draws: Float64Array) => draws.filter(Number.isFinite).length;
    const dropped = run(false),
      kept = run(true);
    // The same resamples: kept, every draw (a negative ρA taken as |ρA|, as cSEM and matrixpls do); dropped by
    // default, most of them (24 left).
    expect(finite(kept.draws[0])).toBe(200);
    expect(finite(dropped.draws[0])).toBeLessThan(50);
    expect(finite(dropped.draws[0])).toBeGreaterThan(0);
    // An admissible draw is the same resample either way: the same estimate, kept or not.
    const i = dropped.draws[0].findIndex(Number.isFinite);
    expect(kept.draws[0][i]).toBeCloseTo(dropped.draws[0][i], 12);
  });

  it('negative ρA: undefined (NaN) by default, as seminr refuses it; |ρA| with absRhoA, as cSEM and matrixpls', () => {
    // A block whose indicators correlate negatively on balance: ĉ² < 0, so ρA < 0.
    const spec = {
      constructs: [
        { name: 'F', type: 'factor' as const, mode: 'A' as const, indicators: ['x1', 'x2', 'x3'] },
        { name: 'Y', type: 'factor' as const, mode: 'A' as const, indicators: ['y1', 'y2', 'y3'] },
      ],
      paths: [{ from: 'F', to: 'Y' }],
    };
    const n = 200;
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 3.4;
    const cols: Record<string, Float64Array> = {};
    for (const k of ['x1', 'x2', 'x3', 'y1', 'y2', 'y3']) cols[k] = new Float64Array(n);
    for (let r = 0; r < n; r++) {
      const y = rnd(),
        u = 2 * rnd(),
        v = 2 * rnd();
      // x1 and x2 both follow y but correlate negatively with each other (−.6), x3 weakly (.2): the weighted
      // off-diagonal correlations sum below zero, so ĉ² and ρA do too
      cols.x1[r] = y + u;
      cols.x2[r] = y - u;
      cols.x3[r] = y + v;
      cols.y1[r] = y + 0.5 * rnd();
      cols.y2[r] = y + 0.5 * rnd();
      cols.y3[r] = y + 0.5 * rnd();
    }
    const data = { names: Object.keys(cols), cols: Object.values(cols) };
    const fit = (absRhoA: boolean) => {
      const prep = preparePls(data, spec, { ...DEFAULT_OPTIONS, consistent: true, absRhoA });
      return prep.estimate(prep.cols).st;
    };
    const strict = fit(false),
      lenient = fit(true);
    expect(strict.rhoA[0]).toBeLessThan(0);
    expect(Number.isNaN(strict.pathCoef[0][1])).toBe(true);
    // |ρA|: the same number with the sign dropped, and a path that exists.
    expect(lenient.rhoA[0]).toBeCloseTo(-strict.rhoA[0], 12);
    expect(Number.isFinite(lenient.pathCoef[0][1])).toBe(true);
    // A positive ρA does not change.
    expect(lenient.rhoA[1]).toBeCloseTo(strict.rhoA[1], 12);
  });

  it('inadmissible draws: the choice survives a project file; anything else reads as drop', () => {
    const save = (bootInadmissible: unknown) =>
      serializeProject(
        { constructs: [], paths: [], moderations: [] },
        { ...DEFAULT_SETTINGS, bootInadmissible } as typeof DEFAULT_SETTINGS,
        null,
        null,
        null,
      );
    expect(DEFAULT_SETTINGS.bootInadmissible).toBe('drop');
    expect(parseProject(save('keep')).settings.bootInadmissible).toBe('keep');
    expect(parseProject(save('zzz')).settings.bootInadmissible).toBe('drop');
  });
});
