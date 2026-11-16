// ps_mc's answer as an McPart (the R side runs in mc.webr.test.ts).

import { describe, expect, it } from 'vitest';
import type { McDesign } from '../engine/montecarlo';
import { mcChunkSize, parseMcChunk } from './mc';

const design: McDesign = {
  population: {
    constructs: [
      { name: 'A', type: 'factor', indicators: ['a1', 'a2', 'a3'], loadings: [0.8, 0.7, 0.75] },
      { name: 'B', type: 'factor', indicators: ['b1', 'b2', 'b3'], loadings: [0.8, 0.7, 0.75] },
    ],
    paths: [{ from: 'A', to: 'B', value: 0.4 }],
    exoCor: [],
  },
  estimators: [{ id: 'CB-ML', method: 'cb', estimator: 'ML' }],
  sampleSizes: [300],
  replications: 1,
  seed: 5,
  alpha: 0.05,
  bootSamples: 0,
  mcDraws: 500,
};

it('a chunk of one replication (each vector unboxed to a scalar by R) parses', () => {
  const part = parseMcChunk(design, 300, 0, {
    est: [[0.41, 0.2]],
    lo: [[0.3, 0.1]],
    hi: [[0.5, 0.3]],
    sig: [[1, 0]],
    proper: [1],
  });
  expect(Array.from(part.est[0][0])).toEqual([0.41]);
  expect(Array.from(part.sig[0][1])).toEqual([0]);
  expect(Array.from(part.proper[0])).toEqual([1]);
});

describe('replications per R call', () => {
  const design = (replications: number, sampleSizes: number[]) =>
    ({ replications, sampleSizes }) as unknown as McDesign;
  it('leaves the fewest sessions idle in the last round, the largest such chunk, 1 to 10', () => {
    // (500 replications on 11 sessions: 2 per call, 46 on the busiest session against 50 with 10 per call)
    expect(mcChunkSize(design(500, [100]), 11)).toBe(2);
    // (4 sessions: 10 per call already fills every round)
    expect(mcChunkSize(design(500, [100, 200, 300, 500]), 4)).toBe(10);
    expect(mcChunkSize(design(3, [100]), 8)).toBe(1);
    expect(mcChunkSize(design(1000, [100]), 0)).toBe(10);
  });
});
