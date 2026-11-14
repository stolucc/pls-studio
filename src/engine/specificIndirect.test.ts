// The built-in engine's specific indirect effects (bootstrap.ts: pathChains, chainProduct), as the R
// bootstrap computes them (boot.R, specific_indirect): one chain's draws equal the indirect effect's
// draws when the pair has no other chain.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bootstrapPls, chainProduct, pathChains } from './bootstrap';
import { parseCsv } from './dataset';
import type { ModelSpec } from './types';

describe('pathChains', () => {
  it('lists every chain with at least one mediator, depth first, serial chains included', () => {
    // 0 → 1 → 2 → 3, 0 → 2, 0 → 3
    const has = [
      [false, true, true, true],
      [false, false, true, false],
      [false, false, false, true],
      [false, false, false, false],
    ];
    expect(pathChains(has)).toEqual([
      [0, 1, 2],
      [0, 1, 2, 3],
      [0, 2, 3],
      [1, 2, 3],
    ]);
    expect(pathChains([[false]])).toEqual([]);
  });
  it('multiplies the path coefficients along the chain', () => {
    const B = [
      [0, 0.5, 0.2],
      [0, 0, -0.4],
      [0, 0, 0],
    ];
    expect(chainProduct(B, [0, 1, 2])).toBeCloseTo(-0.2, 15);
  });
});

describe('bootstrapPls: specific indirect effects', () => {
  const data = parseCsv(readFileSync(join(__dirname, '__fixtures__', 'mobi.csv'), 'utf8')).dataset;
  const spec: ModelSpec = {
    constructs: [
      { name: 'Image', mode: 'A', indicators: ['IMAG1', 'IMAG2', 'IMAG3', 'IMAG4', 'IMAG5'] },
      { name: 'Satisfaction', mode: 'A', indicators: ['CUSA1', 'CUSA2', 'CUSA3'] },
      { name: 'Loyalty', mode: 'A', indicators: ['CUSL1', 'CUSL2', 'CUSL3'] },
    ],
    paths: [
      { from: 'Image', to: 'Satisfaction' },
      { from: 'Satisfaction', to: 'Loyalty' },
      { from: 'Image', to: 'Loyalty' },
    ],
  };
  it('one chain: the same estimate, SD and interval as the indirect effect', () => {
    const res = bootstrapPls(data, spec, {}, { samples: 100, seed: 3, confidence: 0.95 });
    const get = (key: string) => res.stats.find((s) => s.key === key)!;
    const one = get('specific:Image:Satisfaction:Loyalty');
    const ind = get('indirect:Image:Loyalty');
    expect(one.group).toBe('specific');
    expect(one.label).toBe('Image → Satisfaction → Loyalty');
    expect(one.original).toBeCloseTo(ind.original, 12);
    expect(one.sd).toBeCloseTo(ind.sd, 12);
    expect(one.ciLow).toBeCloseTo(ind.ciLow, 12);
    expect(one.ciHigh).toBeCloseTo(ind.ciHigh, 12);
  });
});
