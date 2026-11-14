// Reproduction of Barcomb, Stol, Riehle & Fitzgerald (ICSE 2019), "Why do
// episodic volunteers stay in FLOSS communities?": the global PLS model
// (GoF .699, R² .774) and the REBUS-PLS segmentation (4 classes, GQI .795,
// Table VIII). The survey data are private and not in the repository: the
// test runs only when BARCOMB_DATA points to the CSV.
//   BARCOMB_DATA=/path/to/icse2019-data.csv npm run test:webr -- barcomb

import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { ModelSpec } from '../engine/types';
import { estimatePlsR } from './pls';
import { rebusR } from './segment';
import { near, same } from '../validation/record';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

const file = process.env.BARCOMB_DATA;
const run = !!file && existsSync(file);

describe.skipIf(!run)('Barcomb et al. (ICSE 2019)', () => {
  beforeAll(startTestRuntime);
  afterAll(stopTestRuntime);
  const raw = run ? parseCsv(readFileSync(file!, 'utf8')).dataset : { names: [], cols: [] };
  // Reverse-coded items (R in the paper's Table IV): 6 - x on the 5-point scale.
  const data = {
    names: raw.names,
    cols: raw.cols.map((c, i) =>
      ['socnorm7', 'orgcomm2', 'orgcomm6', 'orgcomm7'].includes(raw.names[i])
        ? c.map((v) => 6 - v)
        : c,
    ),
  };
  const f = (name: string, indicators: string[]) => ({
    name,
    type: 'factor' as const,
    mode: 'A' as const,
    indicators,
  });
  // The retained items (Table IV).
  const spec: ModelSpec = {
    constructs: [
      f('CBM', ['utility6']),
      f('SN', ['socnorm2', 'socnorm3', 'socnorm6', 'socnorm7']),
      f('PSC', ['psychcom3']),
      f('SAT', ['satisfaction1', 'satisfaction2', 'satisfaction3', 'satisfaction6']),
      f('CC', ['orgcomm2', 'orgcomm4', 'orgcomm6', 'orgcomm7', 'orgcomm8', 'orgcomm9']),
      f('IR', ['remain1', 'remain2', 'remain3', 'remain4', 'remain7', 'remain8']),
    ],
    paths: ['CBM', 'SN', 'PSC', 'SAT', 'CC'].map((from) => ({ from, to: 'IR' })),
  };
  const options = {
    scheme: 'centroid' as const,
    consistent: false,
    tolerance: 1e-6,
    maxIter: 100,
    missing: 'casewise' as const,
  };

  it('the global model: R² .774 (and the loadings of Table IV)', async () => {
    const r = await estimatePlsR(data, spec, options, 'cSEM');
    expect(r.rSquared[r.constructs.indexOf('IR')]!, 'R² of IR').toBeCloseTo(0.774, 3);
    const load = (i: string) => r.loadings[r.indicators.findIndex((x) => x.name === i)];
    // Table IV: sn2 .755, sn7 (R) .726, cc2 (R) .701, cc8 .850, s2 .900, ir8 .845.
    for (const [i, v] of [
      ['socnorm2', 0.755],
      ['socnorm7', 0.726],
      ['orgcomm2', 0.701],
      ['orgcomm8', 0.85],
      ['satisfaction2', 0.9],
      ['remain8', 0.845],
    ] as const)
      expect(load(i), i).toBeCloseTo(v, 3);
  }, 900_000);

  it('REBUS-PLS: four classes of 31, 19, 20 and 31 volunteers, GQI .795 (GoF .699), Table VIII', async () => {
    const r = await rebusR(data, spec, options, {
      classes: [3, 4, 5],
      stopCrit: 0.005,
      iterMax: 100,
      seed: 1,
    });
    expect(r.globalGof, 'global GoF').toBeCloseTo(0.699, 3);
    const four = r.models.find((m) => m.k === 4)!;
    expect(four.gqi, 'GQI (4 classes)').toBeCloseTo(0.795, 3);
    // Table VIII, classes in plspm's order: satisfied, social, classic, obligated. Each number is recorded on its own
    // (the paper gives paths to 2 decimals, GoF to 3: the tolerance is half a unit of the last digit).
    const names = ['satisfied', 'social', 'classic', 'obligated'];
    [31, 19, 20, 31].forEach((n, c) => same(`size of class ${names[c]}`, four.sizes[c], n));
    const table: Record<string, number[]> = {
      SAT: [1.05, 0.35, 0.19, 0.01],
      CC: [0.08, 0.42, 0.24, 1.03],
      SN: [-0.1, 0.42, 0.45, -0.09],
    };
    for (const [from, want] of Object.entries(table)) {
      const byClass = four.paths.find((x) => x.from === from)!.byClass;
      want.forEach((v, c) => near(`${from} → IR in class ${names[c]}`, byClass[c], v, 0.005));
    }
    [0.871, 0.858, 0.883, 0.807].forEach((v, c) =>
      near(`GoF of class ${names[c]}`, four.gof[c], v, 0.0005),
    );
  }, 900_000);
});
