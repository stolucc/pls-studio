// Monte Carlo cards of cards/model.ts: Chin et al. (2003), the PLS bootstrap SE; Qureshi & Compeau and Aguirre-Urreta & Rönkkö are in model.qureshi and model.aguirreRonkko. Run through the card's design in R (modelHarness.ts, which says why
// these are split over files) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

slowIt(
  'chin cards: product indicators recover the interaction with many indicators, sum scores underestimate it (Tables 7, 9, 10)',
  async () => {
    const source = {
      label:
        'Chin et al. (2003), Table 7: X·Z (true .30) estimated by PLS at .165 with two indicators (N = 500), .304 / .300 / .262 with eight (N = 100 / 200 / 500); Table 9: sum scores .249 (8 indicators, N = 100); Table 10, pattern A7: PLS .304, averaged scores .189',
      level: 'published',
      url: 'https://doi.org/10.1287/isre.14.2.189.16018',
    } as const;
    const xz = 'path:X × Z:Y';
    const two = await mcCardRun('chin-interaction-2');
    against(source);
    near('2 indicators: PLS X·Z at N = 500', two.row('PLS', xz, 500).mean, 0.165, 0.015);
    near('2 indicators: PLS X → Y at N = 500', two.row('PLS', 'path:X:Y', 500).mean, 0.198, 0.015);
    near('2 indicators: PLS Z → Y at N = 500', two.row('PLS', 'path:Z:Y', 500).mean, 0.328, 0.015);
    const eight = await mcCardRun('chin-interaction-8');
    against(source);
    near('8 indicators: PLS X·Z at N = 100', eight.row('PLS', xz, 100).mean, 0.304, 0.02);
    near('8 indicators: PLS X·Z at N = 200', eight.row('PLS', xz, 200).mean, 0.3, 0.025);
    near('8 indicators: PLS X·Z at N = 500', eight.row('PLS', xz, 500).mean, 0.262, 0.015);
    near(
      '8 indicators: sum scores X·Z at N = 100',
      eight.row('Sum scores', xz, 100).mean,
      0.249,
      0.015,
    );
    const significance = eight.row('PLS', xz, 100).mean / eight.row('PLS', xz, 100).sd;
    expect(significance, 'mean / SD past the paper’s 2.36').toBeGreaterThan(2.36);
    const unequal = await mcCardRun('chin-interaction-unequal');
    against(source);
    near('A7: PLS X·Z', unequal.row('PLS', xz, 100).mean, 0.304, 0.025);
    near('A7: sum scores X·Z', unequal.row('Sum scores', xz, 100).mean, 0.189, 0.025);
  },
  3_600_000,
);

slowIt(
  'pls-bootstrap-se: the bootstrap overstates the SE of a PLS path at small samples, less as N grows',
  async () => {
    const source = {
      label:
        'The Monte Carlo SD of the estimates (the precision the bootstrap estimates); outside the card at N = 100: cSEM 1.15, seminr 1.14, matrixpls 1.14, plspm 1.24, sum scores 1.02',
      level: 'recovery',
    } as const;
    const run = await mcCardRun('pls-bootstrap-se', true, [100, 500]);
    against(source);
    const ratio = (key: string, n: number) => run.row('PLS', key, n).seRatio!;
    near('A → C at N = 100', ratio('path:A:C', 100), 1.2, 0.08);
    expect(ratio('path:A:C', 500), 'smaller at N = 500').toBeLessThan(ratio('path:A:C', 100));
    expect(ratio('path:A:C', 100), 'the weaker path more').toBeGreaterThan(ratio('path:B:C', 100));
    near('coverage of A → C at N = 100', run.row('PLS', 'path:A:C', 100).coverage!, 0.94, 0.03);
  },
  3_600_000,
);
