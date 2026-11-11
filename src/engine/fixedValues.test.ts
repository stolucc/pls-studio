// Parameters fixed at values (lavaan's value*name) in the built-in engine,
// against lavaan 0.6-16 (ML, Holzinger & Swineford 1939):
//   visual =~ x1 + 0.6*x2 + x3; textual =~ x4 + x5 + x6; speed =~ 0.9*x7 + x8 + x9
//   speed ~ 0.3*visual + textual; visual ~~ 0.2*textual; x7 ~~ 0.1*x8

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from './cbsem';
import { parseCsv } from './dataset';
import { FIXED_CHISQ, FIXED_DF, FIXED_SPEC } from './__fixtures__/fixedValues';

const data = parseCsv(
  readFileSync(
    join(__dirname, '__fixtures__', 'validation', 'data', 'holzinger_swineford.csv'),
    'utf8',
  ),
).dataset;
describe('parameters fixed at values', () => {
  it('match lavaan', () => {
    const r = estimateCb(data, FIXED_SPEC);
    expect(r.fit.chisq).toBeCloseTo(FIXED_CHISQ, 3);
    expect(r.fit.df).toBe(FIXED_DF);
    const est = (lhs: string, op: string, rhs: string) =>
      r.estimates.find((e) => e.lhs === lhs && e.op === op && e.rhs === rhs)!;
    expect(est('visual', '=~', 'x3').est).toBeCloseTo(0.845, 3);
    expect(est('textual', '=~', 'x5').est).toBeCloseTo(1.144, 3);
    expect(est('speed', '~', 'textual').est).toBeCloseTo(0.068, 3);
    // Fixed values are reported as they are, without standard errors.
    expect(est('speed', '~', 'visual')).toMatchObject({ est: 0.3, se: null, kind: 'fixed' });
    expect(est('visual', '=~', 'x2')).toMatchObject({ est: 0.6, se: null });
    expect(est('speed', '=~', 'x7')).toMatchObject({ est: 0.9, se: null });
    expect(r.estimates.some((e) => e.lhs === 'speed' && e.rhs === 'x7' && e.est === 1)).toBe(false);
    expect(est('x7', '~~', 'x8')).toMatchObject({ est: 0.1, se: null });
  });
});
