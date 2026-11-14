// Monte Carlo CIs of indirect effects through a path fixed by the user: the fixed path enters
// at its value, without sampling variance (it used to be dropped, as if it were 0).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from './cbsem';
import { parseCsv } from './dataset';
import { mcIndirect } from './mcci';
import type { ModelSpec } from './types';

const data = parseCsv(
  readFileSync(
    join(__dirname, '__fixtures__', 'validation', 'data', 'holzinger_swineford.csv'),
    'utf8',
  ),
).dataset;
const single = (name: string) => ({ name, mode: 'A' as const, indicators: [name] });

describe('Monte Carlo CIs through a fixed path', () => {
  it('use the fixed value: x1 → x4 fixed at 0.5, x4 → x7 free', () => {
    const spec: ModelSpec = {
      constructs: [single('x1'), single('x4'), single('x7')],
      paths: [
        { from: 'x1', to: 'x4', fixed: 0.5 },
        { from: 'x4', to: 'x7' },
      ],
    };
    const cb = estimateCb(data, spec);
    const b = cb.estimates.find((e) => e.lhs === 'x7' && e.rhs === 'x4')!;
    const ind = mcIndirect(cb, 4000, 7).find((r) => r.from === 'x1' && r.to === 'x7');
    expect(ind).toBeDefined();
    expect(ind!.est).toBeCloseTo(0.5 * b.est, 12);
    // Only b is drawn, so the indirect effect's draws are 0.5 × b's: SE 0.5 × se(b), roughly.
    expect(ind!.se / (0.5 * b.se!)).toBeGreaterThan(0.9);
    expect(ind!.se / (0.5 * b.se!)).toBeLessThan(1.1);
    expect(ind!.ciLow).toBeLessThan(ind!.est);
    expect(ind!.ciHigh).toBeGreaterThan(ind!.est);
  });
});
