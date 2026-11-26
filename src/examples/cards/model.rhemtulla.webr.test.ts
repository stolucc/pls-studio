// Monte Carlo card of cards/model.ts: Rhemtulla, van Bork & Borsboom (2020). Run through the card's design in R (modelHarness.ts, which says why these
// are split over files, one heavy card per file) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near, same } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'rhemtulla-composite-factor: a composite modelled as a common factor inflates its paths by √(4/3)',
  async () => {
    const run = await mcCardRun('rhemtulla-composite-factor');
    against({
      label:
        'Rhemtulla, van Bork & Borsboom (2020), Equation 1: a factor model of an error-free composite of p components correlated c inflates its correlations by √((1 + (p − 1)c) / (pc)), here √(4/3): .6 → .693; sum scores and PLS estimate the composite’s .6',
      level: 'recovery',
      url: 'https://doi.org/10.1037/met0000220',
    });
    for (const n of [100, 250, 1000]) {
      for (const key of ['path:X:M', 'path:M:Y']) {
        near(`PLS ${key} at N = ${n}`, run.row('PLS', key, n).mean, 0.6, 0.02);
        near(`sum scores ${key} at N = ${n}`, run.row('Sum scores', key, n).mean, 0.6, 0.02);
        near(`PLSc ${key} at N = ${n}`, run.row('PLSc', key, n).mean, 0.693, 0.02);
        // (ML SEM compromises: a factor M cannot reproduce cor(X, Y) = .36 under full mediation)
        const ml = run.row('CB-ML', key, n).mean;
        expect(ml, `ML ${key} at N = ${n}`).toBeGreaterThan(0.63);
        expect(ml, `ML ${key} at N = ${n}`).toBeLessThan(0.68);
      }
      same(`ML failed at N = ${n}`, run.row('CB-ML', 'path:X:M', n).failed, 0);
    }
    expect(run.row('CB-ML', 'fit:chisq', 1000).rejection!).toBeGreaterThan(0.95);
    expect(run.row('CB-ML', 'fit:chisq', 100).rejection!).toBeLessThan(0.35);
  },
  1_800_000,
);
