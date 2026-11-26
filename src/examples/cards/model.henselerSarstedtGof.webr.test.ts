// Monte Carlo cards of cards/model.ts: Henseler & Sarstedt (2013), its three models compared in one test. Run through the card's design in R (modelHarness.ts, which says why these
// are split over files, one heavy card per file) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near, resume } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'henseler-sarstedt-gof cards: GoF rises for a wrong model; lavaan’s free covariances make both wrong models equivalent (Table 1)',
  async () => {
    const gof = (run: Awaited<ReturnType<typeof mcCardRun>>, n: number) =>
      run.row('PLS', 'validity:gof', n).mean;
    const correct = await mcCardRun('henseler-sarstedt-gof-correct');
    const misspecified = await mcCardRun('henseler-sarstedt-gof-misspecified');
    const omitted = await mcCardRun('henseler-sarstedt-gof-omitted');
    // (the three models run first, then each one's comparisons go to its own example: resume)
    const table1 = (model: string) =>
      against({
        label: `Henseler & Sarstedt (2013), Table 1, ${model}: GoF .369 for the right model (4), .374 for Model 2 (X1 → X2 left out), .304 for Model 3 (X2 → X3 left out); PLS paths .455 for a true .6`,
        level: 'published',
        url: 'https://doi.org/10.1007/s00180-012-0317-1',
      });
    // (equivalent models in lavaan: the χ² test keeps its level for all three)
    const chisqKeepsLevel = (run: Awaited<ReturnType<typeof mcCardRun>>, n: number) =>
      expect(run.row('CB-ML', 'fit:chisq', n).rejection!).toBeLessThan(0.1);

    resume('henseler-sarstedt-gof-correct');
    table1('the right model');
    for (const n of [100, 250, 500]) {
      near(`right model GoF at N = ${n}`, gof(correct, n), 0.373, 0.012);
      chisqKeepsLevel(correct, n);
    }
    near('PLS X1 → X2 (.455)', correct.row('PLS', 'path:X1:X2', 500).mean, 0.455, 0.015);

    resume('henseler-sarstedt-gof-misspecified');
    table1('Model 2');
    for (const n of [100, 250, 500]) {
      // (the paper’s point is the gap, Model 2 .005 above the right model; its level is higher here, .39 at N = 100)
      near(
        `Model 2 GoF less the right model’s at N = ${n} (.374 − .369)`,
        gof(misspecified, n) - gof(correct, n),
        0.005,
        0.012,
      );
      expect(
        gof(misspecified, n),
        `Model 2 GoF above the right model’s at N = ${n}`,
      ).toBeGreaterThan(gof(correct, n));
      chisqKeepsLevel(misspecified, n);
    }

    resume('henseler-sarstedt-gof-omitted');
    table1('Model 3');
    for (const n of [100, 250, 500]) {
      near(`Model 3 GoF at N = ${n}`, gof(omitted, n), 0.31, 0.012);
      chisqKeepsLevel(omitted, n);
    }
    near('Model 3: ML X1 → X3', omitted.row('CB-ML', 'path:X1:X3', 500).mean, 0.36, 0.02);
    expect(omitted.row('CB-ML', 'path:X1:X3', 500).rejection!).toBeGreaterThan(0.95);
  },
  3_600_000,
);
