// Two exogenous factors fixed as uncorrelated (visual ~~ 0*textual): the
// built-in engine against lavaan 0.6-16 (ML, Holzinger & Swineford 1939).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from './cbsem';
import { parseCsv } from './dataset';
import type { ModelSpec } from './types';

const data = parseCsv(readFileSync(join(__dirname, '__fixtures__', 'validation', 'data', 'holzinger_swineford.csv'), 'utf8')).dataset;
const f = (name: string, indicators: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators });
const base: ModelSpec = {
  constructs: [f('visual', ['x1', 'x2', 'x3']), f('textual', ['x4', 'x5', 'x6']), f('speed', ['x7', 'x8', 'x9'])],
  paths: [{ from: 'visual', to: 'speed' }, { from: 'textual', to: 'speed' }],
};

describe('fixed-zero covariance between exogenous factors', () => {
  it('matches lavaan', () => {
    const free = estimateCb(data, base);
    const zero = estimateCb(data, { ...base, covariances: [{ a: 'visual', b: 'textual', kind: 'construct', zero: true }] });
    expect(free.fit.chisq).toBeCloseTo(85.305522, 3);
    expect(free.fit.df).toBe(24);
    expect(zero.fit.chisq).toBeCloseTo(121.471333, 3);
    expect(zero.fit.df).toBe(25);
    expect(zero.estimates.find((e) => e.op === '~~' && [e.lhs, e.rhs].sort().join() === 'textual,visual')).toBeUndefined();
    expect(zero.estimates.find((e) => e.op === '~' && e.rhs === 'visual')!.est).toBeCloseTo(0.334, 3);
  });

  it('only between two exogenous factors', () => {
    expect(() => estimateCb(data, { ...base, covariances: [{ a: 'visual', b: 'speed', kind: 'construct', zero: true }] })).toThrow(/only two exogenous constructs/);
  });
});
