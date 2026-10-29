// Quadratic effects through the R packages in webR: cSEM (X.X in its nonlinear
// model syntax) and seminr (two-stage, interaction_term(X, X)) name the term X²
// and find the curvature in data generated with one. Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simulateQuadratic } from '../engine/__fixtures__/quadratic';
import { estimatePls } from '../engine/pls';
import { estimatePlsR } from './pls';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const f = (name: string, indicators: string[]) => ({ name, mode: 'A' as const, type: 'factor' as const, indicators });
const spec = {
  constructs: [f('X', ['x1', 'x2', 'x3']), f('Y', ['y1', 'y2', 'y3'])],
  paths: [{ from: 'X', to: 'Y' }],
  moderations: [{ from: 'X', moderator: 'X', to: 'Y' }],
};
const data = simulateQuadratic(1500, 11);
const opts = { scheme: 'path' as const, consistent: false, missing: 'mean' as const, tolerance: 1e-7, maxIter: 300 };

describe.each(['cSEM', 'seminr'] as const)('quadratic effect with %s', (pkg) => {
  it('estimates X² → Y like the built-in two-stage engine', async () => {
    const r = await estimatePlsR(data, spec, opts, pkg);
    const k = r.constructs.indexOf('X²'), y = r.constructs.indexOf('Y');
    expect(k).toBeGreaterThan(0);
    expect(r.moderations).toEqual([expect.objectContaining({ from: 'X', moderator: 'X', to: 'Y', construct: k })]);
    const own = estimatePls(data, spec);
    const ko = own.constructs.indexOf('X²'), yo = own.constructs.indexOf('Y');
    expect(r.pathCoef[k][y]).toBeGreaterThan(0.1);
    // Same two-stage method in seminr; cSEM's nonlinear PLS differs slightly.
    expect(r.pathCoef[k][y]).toBeCloseTo(own.pathCoef[ko][yo], pkg === 'seminr' ? 6 : 1);
  }, 600_000);
});
