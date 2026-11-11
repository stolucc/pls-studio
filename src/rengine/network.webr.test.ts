// Network psychometrics and EGA through webR against native R
// (scripts/validation/network.R): bootnet's EBICglasso network of the 25 Big
// Five items (Pearson and cor_auto), qgraph centrality; EGAnet's ?EGA example; the unregularised and correlation networks,
// Spearman correlations and EGA's TMFG model (scripts/validation/network_modes.R).
// glasso comes from the vendored r-universe build (scripts/webr/fetch.mjs;
// repo.r-wasm.org's crashes, r-wasm/webr#633). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { rCall } from './bridge';
import { egaR, networkR } from './network';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'network', 'reference.json'),
    'utf8',
  ),
);
const modes = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'network', 'modes.json'), 'utf8'),
);
const load = async (pkg: 'psych' | 'EGAnet', name: string): Promise<Dataset> => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset',
    { package: pkg, name, na: [] },
    pkg as never,
  );
  return {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
  };
};
const close = (got: number[][], want: number[][], digits: number) =>
  got.forEach((row, i) =>
    row.forEach((v, j) => expect(v, `[${i},${j}]`).toBeCloseTo(want[i][j], digits)),
  );

describe('network analysis (bootnet, qgraph)', () => {
  it.each([
    ['cor', 'pearson', 8],
    ['cor_auto', 'cor_auto', 4],
  ] as const)(
    'EBICglasso with %s correlations equals native bootnet',
    async (corMethod, key, digits) => {
      const bfi = await load('psych', 'bfi');
      const r = await networkR(bfi, {
        vars: ref.names,
        estimator: 'EBICglasso',
        corMethod,
        missing: 'pairwise',
        gamma: 0.5,
        boot: { samples: 0, seed: 1 },
      });
      expect(r.names).toEqual(ref.names);
      close(r.weights, ref[key].weights, digits);
      r.centrality.strength.forEach((v, i) => expect(v).toBeCloseTo(ref[key].strength[i], digits));
      r.centrality.expectedInfluence.forEach((v, i) =>
        expect(v).toBeCloseTo(ref[key].expectedInfluence[i], digits),
      );
      expect(r.layout).toHaveLength(25);
    },
    900_000,
  );

  // The other estimators and correlations (scripts/validation/network_modes.R), on the first ten items.
  it.each([
    ['pcor', 'cor', 'network of partial correlations (unregularised)', 'pcor'],
    ['cor', 'cor', 'correlation network', 'cor'],
    ['EBICglasso', 'spearman', 'network of Spearman correlations', 'spearman'],
  ] as const)(
    '%s with %s: the %s equals native bootnet',
    async (estimator, corMethod, _what, key) => {
      const bfi = await load('psych', 'bfi');
      const r = await networkR(bfi, {
        vars: modes.names,
        estimator,
        corMethod,
        missing: 'pairwise',
        gamma: 0.5,
        boot: { samples: 0, seed: 1 },
      });
      expect(r.names).toEqual(modes.names);
      close(r.weights, modes[key].weights, 8);
      r.centrality.strength.forEach((v, i) =>
        expect(v, `strength ${modes.names[i]}`).toBeCloseTo(modes[key].strength[i], 8),
      );
      r.centrality.expectedInfluence.forEach((v, i) =>
        expect(v, `expected influence ${modes.names[i]}`).toBeCloseTo(
          modes[key].expectedInfluence[i],
          8,
        ),
      );
    },
    900_000,
  );

  it('case-dropping stability gives CS coefficients', async () => {
    const bfi = await load('psych', 'bfi');
    const r = await networkR(bfi, {
      vars: ref.names.slice(0, 10),
      estimator: 'EBICglasso',
      corMethod: 'cor',
      missing: 'pairwise',
      gamma: 0.5,
      boot: { samples: 30, seed: 1 },
    });
    expect(Object.keys(r.cs!).sort()).toEqual([
      'betweenness',
      'closeness',
      'expectedInfluence',
      'strength',
    ]);
    expect(r.cs!.strength).toBeGreaterThanOrEqual(0);
  }, 900_000);
});

describe('exploratory graph analysis (EGAnet)', () => {
  it('?EGA (wmt2[, 7:24]): dimensions, membership, network and loadings equal native EGAnet', async () => {
    const wmt = await load('EGAnet', 'wmt2');
    const vars = Array.from({ length: 18 }, (_, i) => `wmt${i + 1}`); // (wmt2[, 7:24])
    const r = await egaR(wmt, {
      vars,
      model: 'glasso',
      algorithm: 'walktrap',
      corr: 'auto',
      boot: { samples: 0, seed: 1 },
    });
    expect(r.dims).toBe(ref.ega.dims);
    expect(r.membership).toEqual(ref.ega.membership);
    close(r.weights, ref.ega.weights, 4);
    close(r.loadings, ref.ega.loadings, 3);
  }, 900_000);

  it('?EGA’s data with the TMFG network: dimensions, membership, network and loadings equal native EGAnet', async () => {
    const wmt = await load('EGAnet', 'wmt2');
    const r = await egaR(wmt, {
      vars: Array.from({ length: 18 }, (_, i) => `wmt${i + 1}`),
      model: 'TMFG',
      algorithm: 'walktrap',
      corr: 'auto',
      boot: { samples: 0, seed: 1 },
    });
    expect(r.dims).toBe(modes.tmfg.dims);
    expect(r.membership).toEqual(modes.tmfg.membership);
    close(r.weights, modes.tmfg.weights, 6);
    close(r.loadings, modes.tmfg.loadings, 6);
  }, 900_000);

  it('bootEGA: dimension frequencies and item stability', async () => {
    const wmt = await load('EGAnet', 'wmt2');
    const r = await egaR(wmt, {
      vars: Array.from({ length: 18 }, (_, i) => `wmt${i + 1}`),
      model: 'glasso',
      algorithm: 'walktrap',
      corr: 'auto',
      boot: { samples: 20, seed: 1 },
    });
    expect(r.frequency!.reduce((s, f) => s + f.share, 0)).toBeCloseTo(1, 6);
    expect(r.itemStability).toHaveLength(18);
    r.itemStability!.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
  }, 900_000);
});
