// Monte Carlo card of cards/model.ts: Rönkkö & Cho (2022), φ = .9. Run through the card's design in R (modelHarness.ts, which says why these
// are split over files, one heavy card per file) and compared with the paper. Slow: run with WEBR_TESTS=1 WEBR_SLOW=1.

import { afterAll, beforeAll, expect } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near } from '../../validation/record';
import { mcCardRun } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const RONKKO_CHO = { level: 'published' as const, url: 'https://doi.org/10.1177/1094428120968614' };
const ML = 'CB-ML';
const NS = [50, 100, 250, 1000];

slowIt(
  'ronkko-cho-nine: at φ = .9 the tests against 1 flag fewer samples as N grows; HTMT against .90 about half (Tables 8 and 9)',
  async () => {
    const nine = await mcCardRun('ronkko-cho-nine', true);
    against({
      ...RONKKO_CHO,
      label:
        'Rönkkö & Cho (2022), Tables 8 and 9, φ = .9 at N = 50 / 100 / 250 / 1,000: CI_CFA(1) .293 / .106 / .005 / .000 and χ²(1) .199 / .081 / .004 / .000 (averaged over 3, 6 and 9 items), CI_CFA(.90) .982 / .987 / .985 / .980, AVE/SV_CFA .968 / .993 / 1.000 / 1.000',
    });
    const fail = (key: string, n: number) => nine.row(ML, `validity:${key}`, n).rejection!;
    const ci1 = NS.map((n) => fail('cicfa:F1:F2', n));
    for (let k = 1; k < NS.length; k++)
      expect(ci1[k], 'CI_CFA(1): fewer flags as N grows').toBeLessThan(ci1[k - 1]);
    expect(ci1[2]).toBeLessThan(0.03);
    expect(ci1[3]).toBe(0);
    expect(fail('chi1:F1:F2', 250)).toBeLessThan(0.03);
    for (const n of NS) {
      near(`φ = .9: CI_CFA(.90) at N = ${n}`, fail('cicfa90:F1:F2', n), 0.983, 0.02);
      near(`φ = .9: HTMT (.90) at N = ${n}`, fail('htmt90:F1:F2', n), 0.53, 0.06);
    }
    near('φ = .9: AVE/SV_CFA at N = 100', fail('fl:F1', 100), 0.97, 0.03);
  },
  3_600_000,
);
