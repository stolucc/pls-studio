// The time-varying effect model card (analyses/tvem.tsx, R ps_tvem) on its two examples (packages.ts:
// mgcv-gamsim3-tvem, nls-tvem), run as the app opens them, against the tvem package 1.4.1 in desktop R, which the
// card follows (scripts/validation/tvem.R → src/engine/__fixtures__/tvem/reference.json): every point of the
// intercept's and the effect's curves and their standard errors clustered by subject. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { TvemResult } from '../../rengine/tvem';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near, same } from '../../validation/record';
import { open } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type RefCase = {
  n: number;
  clusters?: number;
  grid: number[];
  curves: Record<string, { estimate: number[]; se: number[] }>;
  truth?: number[];
};
const REF = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', 'engine', '__fixtures__', 'tvem', 'reference.json'),
    'utf8',
  ),
) as { tvem: string; gamsim3: RefCase; nls: RefCase };

const TVEM = {
  label: `scripts/validation/tvem.R: tvem ${REF.tvem} in desktop R`,
  level: 'native' as const,
};

function compare(r: TvemResult, ref: RefCase) {
  same('rows', r.n, ref.n);
  same('grid points', r.grid.length, ref.grid.length);
  near('grid: first time', r.grid[0], ref.grid[0], 1e-10);
  near('grid: last time', r.grid[r.grid.length - 1], ref.grid[ref.grid.length - 1], 1e-10);
  for (const c of r.curves) {
    const want = ref.curves[c.name];
    expect(want, c.name).toBeTruthy();
    // (fast REML's smoothing parameters to ~1e-7 between webR and desktop R)
    const worstEst = Math.max(...c.estimate.map((x, i) => Math.abs(x - want.estimate[i])));
    const worstSe = Math.max(...c.se.map((x, i) => Math.abs(x - want.se[i])));
    const scale = Math.max(...want.estimate.map(Math.abs));
    near(`${c.name}: largest difference of the estimates over the grid`, worstEst, 0, 1e-6 * scale);
    near(`${c.name}: largest difference of the standard errors`, worstSe, 0, 1e-6 * scale);
    for (const i of [0, 33, 66, 99]) {
      near(
        `${c.name} at ${ref.grid[i].toFixed(3)}: estimate`,
        c.estimate[i],
        want.estimate[i],
        1e-6 * scale,
      );
      near(`${c.name} at ${ref.grid[i].toFixed(3)}: SE`, c.se[i], want.se[i], 1e-6 * scale);
    }
  }
}

it('mgcv-gamsim3-tvem: the varying effect of x1 along x2, each row its own case', async () => {
  const { run } = await open('mgcv-gamsim3-tvem', 'Longitudinal', ['mgcv']);
  const r = await run<TvemResult>();
  against(TVEM);
  compare(r, REF.gamsim3);
  same('clusters', r.clusters, 400);
  // (the effect follows the true f(x2) of the simulation: its peak near x2 = 0.25)
  const effect = r.curves.find((c) => c.name === 'x1')!;
  const peak = effect.estimate.indexOf(Math.max(...effect.estimate));
  expect(r.grid[peak]).toBeGreaterThan(0.2);
  expect(r.grid[peak]).toBeLessThan(0.3);
}, 600_000);

it('nls-tvem: the effect of weekly hours on log wage by age, clustered by woman', async () => {
  const { run } = await open('nls-tvem', 'Longitudinal', ['mgcv']);
  const r = await run<TvemResult>();
  against(TVEM);
  compare(r, REF.nls);
  same('women', r.clusters, REF.nls.clusters!);
}, 600_000);
