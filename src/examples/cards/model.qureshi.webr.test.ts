// Monte Carlo cards of cards/model.ts: Qureshi & Compeau (2009), group differences. Run through the card's design in R (modelHarness.ts, which says why
// these are split over files) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'qureshi cards: PLS and CB-SEM find group differences about equally often; the paper’s reversal does not reproduce (Table 2)',
  async () => {
    const source = {
      label:
        'Qureshi & Compeau (2009), Table 2, normal data, % of path differences detected (PLS / CB-SEM) at n = 100 and 500 per group: r = 0, 3 indicators, d = .15: 0 / 0 and 40 / 76; d = .35: 31 / 68 and 100 / 100; r = .4, 6 indicators, d = .25: 96 / 4 and 100 / 100',
      level: 'recovery',
      url: 'https://doi.org/10.2307/20650285',
    } as const;
    const keys = ['diff:A:C', 'diff:B:C', 'diff:A:D', 'diff:C:D'];
    type Run = Awaited<ReturnType<typeof mcCardRun>>;
    const detected = (run: Run, e: string, n: number) =>
      keys.reduce((s, k) => s + run.row(e, k, n).rejection!, 0) / keys.length;
    const small = await mcCardRun('qureshi-small', true);
    against(source);
    near('d .15, n 100: PLS', detected(small, 'PLS', 100), 0.18, 0.05);
    near('d .15, n 500: PLS', detected(small, 'PLS', 500), 0.67, 0.06);
    near('d .15, n 500: CB-ML', detected(small, 'CB-ML', 500), 0.65, 0.06);
    near('ML unbiased', small.row('CB-ML', 'diff:A:D', 500).mean, 0.15, 0.015);
    expect(small.row('PLS', 'diff:A:D', 500).mean, 'PLS shrinks the difference').toBeLessThan(0.14);
    const big = await mcCardRun('qureshi-uncorrelated', true);
    against(source);
    near('d .35, n 100: PLS', detected(big, 'PLS', 100), 0.69, 0.06);
    near('d .35, n 100: CB-ML', detected(big, 'CB-ML', 100), 0.7, 0.06);
    const correlated = await mcCardRun('qureshi-correlated', true);
    against(source);
    near('r .4, d .25, n 100: PLS', detected(correlated, 'PLS', 100), 0.5, 0.06);
    near('r .4, d .25, n 100: CB-ML', detected(correlated, 'CB-ML', 100), 0.49, 0.06);
    expect(detected(correlated, 'CB-ML', 500), 'n 500: CB-ML').toBeGreaterThan(0.95);
  },
  14_400_000,
);
