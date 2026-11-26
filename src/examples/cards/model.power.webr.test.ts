// Monte Carlo cards of cards/model.ts: Muthén & Muthén (2002), Rönkkö & Evermann (2013), Henseler et al. (2014), Goodhue et al. (2012). Each run through the card's design in R (modelHarness.ts, which says
// why these are split over files) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { designParameters, summariseMc, type McDesign } from '../../engine/montecarlo';
import { buildPopulation } from '../../engine/population';
import { runMcChunkR } from '../../rengine/mc';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near, same } from '../../validation/record';
import { exampleOf, mcCardRun, open, ronkkoEvermannRun, runMcChunks } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

// (slow: minutes in webR; run with WEBR_SLOW, as npm run validate:evidence does)
slowIt(
  'muthen-mc-cfa: power .81 for the factor correlation at N = 150',
  async () => {
    const { options } = await open('muthen-mc-cfa', 'Simulation', ['lavaan']);
    // The card's run() spreads chunks over the app's R sessions (runner.simulate); here the same chunks at N = 150.
    const design = { ...(options as McDesign), sampleSizes: [150] };
    const rows = summariseMc(design, await runMcChunks(design));
    // (the correlation of the two factors, as the paper tests it)
    const cor = rows.find((x) => x.param.kind === 'covariance')!;
    same('replications', cor.reps, 1000);
    same('failed replications', cor.failed, 0);
    against({
      label:
        'Muthén & Muthén (2002), p. 607: N = 150 gives power .81 for the factor correlation (10,000 replications; here 1,000: Monte Carlo SE 0.012, within 0.04)',
      level: 'published',
      url: 'https://doi.org/10.1207/S15328007SEM0904_8',
    });
    near('power of f1 ↔ f2', cor.rejection!, 0.81, 0.04);
    near('mean estimate of f1 ↔ f2 (population .25)', cor.mean, 0.25, 0.01);
    near('coverage of the 95% interval', cor.coverage!, 0.95, 0.02);
  },
  1_800_000,
);

slowIt(
  'ronkko-evermann-null: the PLS estimate of a null path is bimodal; sum scores and ML SEM are not',
  async () => {
    const { parts, path, reliability } = await ronkkoEvermannRun('ronkko-evermann-null');
    const [modeA, modeB] = ['PLS mode A, centroid', 'PLS mode B, centroid'];
    // (cSEM's PLS does not converge in a few samples of a null path: 9 (mode A) and 14 (mode B) of
    // 500 in desktop cSEM 0.7.1)
    for (const e of [modeA, modeB])
      expect(path(e).failed, `${e}: replications without convergence`).toBeLessThan(25);
    for (const e of ['Sum scores', 'CB-ML']) same(`${e} failed`, path(e).failed, 0);
    // (the PLS estimators come first, in the card's order; A → B comes after the fit tests CB-SEM adds)
    const card = exampleOf('ronkko-evermann-null').panel as unknown as McDesign;
    const at = designParameters(card, buildPopulation(card.population)).findIndex(
      (p) => p.key === 'path:A:B',
    );
    const share = (estimator: number, lo: number, hi: number) => {
      const est = parts.flatMap((p) => Array.from(p.est[estimator][at])).filter(Number.isFinite);
      return est.filter((x) => Math.abs(x) >= lo && Math.abs(x) < hi).length / est.length;
    };
    against({
      label:
        'Rönkkö & Evermann (2013), Figures 2 and 3: at β = 0 and N = 100 the estimates of PLS mode A and mode B (centroid weighting) are bimodal (fewer within ±.05 of 0 than between ±.10 and ±.15), mode B the more spread; regression on sum scores and ML SEM center on 0; the composites of mode A are less reliable than sum scores, those of mode B less still',
      level: 'published',
      url: 'https://doi.org/10.1177/1094428112474693',
    });
    for (const [k, e] of [modeA, modeB].entries())
      expect(share(k, 0, 0.05), `${e}: fewer estimates near 0 than at ±.1 to ±.15`).toBeLessThan(
        share(k, 0.1, 0.15),
      );
    near('sum scores: mean estimate', path('Sum scores').mean, 0, 0.02);
    near('ML SEM: mean estimate', path('CB-ML').mean, 0, 0.03);
    expect(path(modeA).sd, 'PLS mode A: larger SD than sum scores').toBeGreaterThan(
      1.5 * path('Sum scores').sd,
    );
    expect(path(modeB).sd, 'PLS mode B: larger SD than mode A').toBeGreaterThan(path(modeA).sd);
    expect(reliability(modeA).mean, 'PLS mode A: less reliable than sum scores').toBeLessThan(
      reliability('Sum scores').mean,
    );
    expect(reliability(modeB).mean, 'PLS mode B: less reliable than mode A').toBeLessThan(
      reliability(modeA).mean,
    );
  },
  1_800_000,
);

slowIt(
  'ronkko-evermann-beta: sum scores underestimate β = .3, PLS less so, ML SEM not at all',
  async () => {
    const { path, reliability } = await ronkkoEvermannRun('ronkko-evermann-beta');
    const [modeA, modeB] = ['PLS mode A, centroid', 'PLS mode B, centroid'];
    against({
      label:
        'Rönkkö & Evermann (2013), Figures 2 and 3: with loadings .6/.7/.8 and N = 100, sum scores are attenuated (composite reliability about .75: β ≈ .3 · .75 = .22); PLS weights capitalise on chance and raise the estimate above the sum scores’ (mode A below the true value, mode B about at it, with the larger SD) although their composites are less reliable; ML SEM is unbiased with a larger SD than PLS mode A',
      level: 'published',
      url: 'https://doi.org/10.1177/1094428112474693',
    });
    near('sum scores: mean estimate', path('Sum scores').mean, 0.22, 0.02);
    expect(path(modeA).mean, 'PLS mode A: above sum scores').toBeGreaterThan(
      path('Sum scores').mean,
    );
    expect(path(modeA).mean, 'PLS mode A: below the true .3').toBeLessThan(0.3);
    expect(path(modeB).mean, 'PLS mode B: above mode A').toBeGreaterThan(path(modeA).mean);
    expect(path(modeB).sd, 'PLS mode B: larger SD than mode A').toBeGreaterThan(path(modeA).sd);
    near('ML SEM: mean estimate', path('CB-ML').mean, 0.3, 0.03);
    expect(path('CB-ML').sd, 'ML SEM: larger SD than PLS mode A').toBeGreaterThan(path(modeA).sd);
    expect(reliability(modeA).mean, 'PLS mode A: less reliable than sum scores').toBeLessThan(
      reliability('Sum scores').mean,
    );
    expect(reliability(modeB).mean, 'PLS mode B: less reliable than mode A').toBeLessThan(
      reliability(modeA).mean,
    );
  },
  1_800_000,
);

const [MODE_A, MODE_B] = ['PLS mode A, centroid', 'PLS mode B, centroid'];
const HENSELER = {
  level: 'published' as const,
  url: 'https://doi.org/10.1177/1094428114526928',
};

slowIt(
  'henseler-beta5: at β = .5 PLS mode A composites are at least as reliable as sum scores; estimates unimodal',
  async () => {
    const { path, reliability, unimodal } = await ronkkoEvermannRun('henseler-beta5');
    against({
      ...HENSELER,
      label:
        'Henseler et al. (2014), Table 2 condition c and Figure 5c: at β = .5 and N = 100 the average reliability of PLS mode A composites (.867, squared .752) reaches that of sum scores (.862, squared .743), mode B lower; the estimates of the path are unimodal',
    });
    expect(reliability(MODE_A).mean, 'PLS mode A: more reliable than sum scores').toBeGreaterThan(
      reliability('Sum scores').mean,
    );
    near('PLS mode A reliability (paper .867² = .752)', reliability(MODE_A).mean, 0.752, 0.01);
    expect(reliability(MODE_B).mean, 'PLS mode B: less reliable').toBeLessThan(
      reliability(MODE_A).mean,
    );
    for (const e of [MODE_A, MODE_B, 'Sum scores'])
      expect(unimodal(e, 'path:A:B', 100), `${e}: unimodal`).toBe(true);
    near('sum scores: mean estimate (.745 · .5)', path('Sum scores').mean, 0.37, 0.02);
    near('ML SEM: mean estimate', path('CB-ML').mean, 0.5, 0.03);
  },
  1_800_000,
);

slowIt(
  'henseler-n500: PLS mode A falls behind sum scores at N = 100 and overtakes them at N = 500',
  async () => {
    const { path, reliability, unimodal } = await ronkkoEvermannRun('henseler-n500');
    against({
      ...HENSELER,
      label:
        'Henseler et al. (2014), Table 2 conditions b and d and Figure 5d: at β = .3 the reliability of PLS mode A composites is below that of sum scores at N = 100 (.843 against .862, squared .711 and .743) and above it at N = 500 (.868, squared .753); at N = 500 the path estimates are unimodal and far less spread',
    });
    expect(reliability(MODE_A, 100).mean).toBeLessThan(reliability('Sum scores', 100).mean);
    expect(reliability(MODE_A, 500).mean).toBeGreaterThan(reliability('Sum scores', 500).mean);
    near(
      'PLS mode A reliability at N = 500 (paper .753)',
      reliability(MODE_A, 500).mean,
      0.753,
      0.01,
    );
    expect(reliability(MODE_B, 500).mean).toBeGreaterThan(reliability(MODE_B, 100).mean + 0.1);
    for (const e of [MODE_A, MODE_B, 'Sum scores', 'CB-ML']) {
      expect(unimodal(e, 'path:A:B', 500), `${e}: unimodal at N = 500`).toBe(true);
      expect(path(e, 500).sd, `${e}: SD at N = 500 under half that at 100`).toBeLessThan(
        path(e, 100).sd / 2,
      );
    }
  },
  1_800_000,
);

slowIt(
  'henseler-loadings: with loadings .5/.7/.9 PLS mode A composites beat sum scores at N = 100',
  async () => {
    const { reliability } = await ronkkoEvermannRun('henseler-loadings');
    against({
      ...HENSELER,
      label:
        'Henseler et al. (2014), Table 2 condition e: with loadings .5, .7 and .9, β = .3 and N = 100 PLS mode A composites are more reliable on average than sum scores (.871 against .867, squared .759 and .752)',
    });
    near('sum scores: reliability (population .752)', reliability('Sum scores').mean, 0.752, 0.002);
    expect(reliability(MODE_A).mean, 'PLS mode A: more reliable than sum scores').toBeGreaterThan(
      reliability('Sum scores').mean,
    );
    expect(reliability(MODE_B).mean).toBeLessThan(reliability(MODE_A).mean);
  },
  1_800_000,
);

slowIt(
  'henseler-four: in the four-construct model PLS mode A is as reliable as sum scores; estimates unimodal',
  async () => {
    const { path, reliability, unimodal } = await ronkkoEvermannRun('henseler-four');
    against({
      ...HENSELER,
      label:
        'Henseler et al. (2014), Table 2 condition f and Figure 5f: in the model C → A → B ← D (all paths .3, N = 100) PLS mode A composites are about as reliable as sum scores (.858 against .862, squared .736 and .743) and the estimates of A → B are unimodal',
    });
    near(
      'PLS mode A against sum scores',
      reliability(MODE_A).mean,
      reliability('Sum scores').mean,
      0.015,
    );
    for (const e of [MODE_A, MODE_B, 'Sum scores'])
      expect(unimodal(e, 'path:A:B', 100), `${e}: unimodal`).toBe(true);
    for (const e of [MODE_A, 'Sum scores']) expect(path(e).mean).toBeLessThan(0.3);
    near('ML SEM: mean estimate', path('CB-ML').mean, 0.3, 0.03);
  },
  1_800_000,
);

const GOODHUE = { level: 'published' as const, url: 'https://doi.org/10.2307/41703490' };

slowIt(
  'goodhue-nonnormal: Fleishman per indicator reproduces Tables A4 and A5; Vale–Maurelli keeps the estimates',
  async () => {
    const { card, row } = await mcCardRun('goodhue-nonnormal');
    same('the paper’s generator', card.population.nonnormal ?? '', 'fleishman');
    const path = (e: string, k: number, n: number) => row(e, `path:Ksi${k}:Eta1`, n);
    against({
      ...GOODHUE,
      label:
        'Goodhue, Lewis & Thompson (2012), Appendix Tables A4 and A5, extreme skew: mean estimates of the .48 path .330 / .334 (regression) and .407 / .428 (LISREL) at N = 40 / 90; power for the .314 path at N = 90 .53 (regression) and .50 (LISREL)',
    });
    for (const n of [40, 90]) {
      near(`regression, large path at N = ${n}`, path('Sum scores', 1, n).mean, 0.332, 0.03);
      near(`ML SEM, large path at N = ${n}`, path('CB-ML', 1, n).mean, 0.417, 0.04);
    }
    near('regression power, medium path, N = 90', path('Sum scores', 2, 90).rejection!, 0.53, 0.07);
    near('ML SEM power, medium path, N = 90', path('CB-ML', 2, 90).rejection!, 0.5, 0.07);
    // Vale–Maurelli: the same skewness without shrinking the correlations
    const vm = await runMcChunkR(
      { ...card, bootSamples: 0, population: { ...card.population, nonnormal: undefined } },
      90,
      0,
      200,
    );
    const kept = summariseMc({ ...card, bootSamples: 0, sampleSizes: [90] }, [vm]).find(
      (x) => x.estimator === 'Sum scores' && x.param.key === 'path:Ksi1:Eta1',
    )!;
    near('regression, large path, Vale–Maurelli (normal data .391)', kept.mean, 0.4, 0.03);
  },
  3_600_000,
);

slowIt(
  'goodhue-sample-size: regression and ML SEM against Tables A1 and A2 at N = 20 to 200; PLS estimates like regression',
  async () => {
    const { row } = await mcCardRun('goodhue-sample-size');
    const path = (e: string, k: number, n: number) => row(e, `path:Ksi${k}:Eta1`, n);
    against({
      ...GOODHUE,
      label:
        'Goodhue, Lewis & Thompson (2012), Appendix Tables A1 and A2: mean estimates of the .48 path about .39 (regression), .40 (PLS) and .48 (LISREL) at every N; power for the .314 path .40 / .76 / .97 (regression) and .37 / .79 / .98 (LISREL) at N = 40 / 90 / 200; the null path rejected about 5% of the time',
    });
    for (const n of [40, 90, 150, 200]) {
      near(`regression, large path at N = ${n}`, path('Sum scores', 1, n).mean, 0.39, 0.03);
      near(`PLS, large path at N = ${n}`, path('PLS', 1, n).mean, 0.4, 0.03);
      near(`ML SEM, large path at N = ${n}`, path('CB-ML', 1, n).mean, 0.48, 0.03);
    }
    // (the paper's indicators are rounded to whole numbers, a little less reliable than the card's)
    near('regression power, medium path, N = 40', path('Sum scores', 2, 40).rejection!, 0.4, 0.07);
    near('regression power, medium path, N = 90', path('Sum scores', 2, 90).rejection!, 0.76, 0.07);
    near(
      'regression power, medium path, N = 200',
      path('Sum scores', 2, 200).rejection!,
      0.97,
      0.03,
    );
    near('ML SEM power, medium path, N = 90', path('CB-ML', 2, 90).rejection!, 0.79, 0.07);
    near('ML SEM power, medium path, N = 200', path('CB-ML', 2, 200).rejection!, 0.98, 0.03);
    for (const n of [90, 150, 200])
      for (const e of ['Sum scores', 'CB-ML'])
        expect(path(e, 4, n).rejection!, `${e}: Type I at N = ${n}`).toBeLessThan(0.09);
    // ML SEM fails or is improper far more often at small N
    expect(path('CB-ML', 1, 20).failed + path('CB-ML', 1, 20).improper).toBeGreaterThan(
      5 * (path('CB-ML', 1, 200).failed + path('CB-ML', 1, 200).improper),
    );
    // the SDs about triple from N = 200 to 20 (Figure 3c)
    for (const e of ['Sum scores', 'PLS'])
      expect(path(e, 1, 20).sd / path(e, 1, 200).sd).toBeGreaterThan(2.5);
  },
  3_600_000,
);
