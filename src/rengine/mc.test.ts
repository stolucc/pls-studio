// ps_mc's answer as an McPart (the R side runs in mc.webr.test.ts).

import { expect, it } from 'vitest';
import type { McDesign } from '../engine/montecarlo';
import { parseMcChunk } from './mc';

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
