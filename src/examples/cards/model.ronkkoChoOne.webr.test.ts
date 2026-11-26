// Monte Carlo card of cards/model.ts: Rönkkö & Cho (2022), φ = 1. Run through the card's design in R (modelHarness.ts, which says why these
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
  "ronkko-cho-one: at φ = 1 the factor correlation's interval and χ²(1) keep their level (Table 8)",
  async () => {
    const one = await mcCardRun('ronkko-cho-one', true);
    against({
      ...RONKKO_CHO,
      label:
        'Rönkkö & Cho (2022), Table 8, loadings .8, φ = 1 at N = 50 / 100 / 250 / 1,000: CI_CFA(1) .992 / .990 / .983 / .983, χ²(1) .967 / .973 / .974 / .979, AVE/SV_CFA 1.000',
    });
    const fail = (key: string, n: number) => one.row(ML, `validity:${key}`, n).rejection!;
    for (const n of NS) {
      near(`φ = 1: CI_CFA(1) at N = ${n}`, fail('cicfa:F1:F2', n), 0.98, 0.025);
      near(`φ = 1: χ²(1) at N = ${n}`, fail('chi1:F1:F2', n), 0.95, 0.04);
      expect(fail('fl:F1', n)).toBe(1);
      near(`φ = 1: correlation at N = ${n}`, one.row(ML, 'cov:F1:F2', n).mean, 1, 0.01);
    }
  },
  3_600_000,
);
