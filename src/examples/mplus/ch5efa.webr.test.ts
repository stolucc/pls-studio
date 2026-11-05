// Mplus User's Guide, chapter 5: the EFA / ESEM examples 5.24–5.30 in webR against what their Mplus outputs
// print (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import type { CbEstimator } from '../../engine/cbsem';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { estimateCbLavaan } from '../../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { exampleModel } from '../packages';
import { evidence, example, load, MPLUS, sameFit, samePrinted } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const fit = async (key: string) => {
  const ex = example(key);
  evidence(key, 'CB-SEM', ['lavaan']);
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const r = await estimateCbLavaan(load(key), toSpec(exampleModel(ex)), 'casewise', st.estimator as CbEstimator, 'product');
  expect(r.converged).toBe(true);
  expect(r.warnings).toEqual([]);
  return r;
};

it.each([['ex5.27'], ['ex5.27b'], ['ex5.27c'], ['ex5.27d'], ['ex5.27e'], ['ex5.28']])('%s reproduces the Mplus output: fit, estimates and standard errors', async (key) => {
  const r = await fit(key);
  const want = MPLUS[key];
  sameFit(r.fit, want.fit);
  if (r.groups) {
    expect(r.groups.labels.length).toBe(2);
    // (Mplus stops at a looser convergence criterion: group 2's residual variances, about 2, differ by up to 0.0011)
    for (const g of [1, 2]) samePrinted(r.groups.results[g - 1].estimates, want.estimates.filter((p) => p.group === g), `${key} group ${g}`, { tol: 0.0015 });
  } else samePrinted(r.estimates, want.estimates, key);
}, 600_000);

it('ex5.29: the bi-geomin ESEM reproduces Mplus’s fit and estimates, and the standard errors of the intercepts and residual variances', async () => {
  const key = 'ex5.29';
  const r = await fit(key);
  const want = MPLUS[key];
  sameFit(r.fit, want.fit);
  // Every estimate within 0.0015: y4 is close to a Heywood case (residual variance 0.985, SE 1.29), where the
  // likelihood is flat and the two programs stop 0.0013 apart.
  samePrinted(r.estimates, want.estimates, key, { tol: 0.0015, ses: false });
  // lavaan's standard errors of the rotated loadings and of the factor correlation are not Mplus's (documented on
  // the card); those of the intercepts and residual variances agree.
  samePrinted(r.estimates, want.estimates.filter((p) => p.op === '~1' || (p.op === '~~' && p.lhs === p.rhs && p.lhs.startsWith('y'))), key, { tol: 0.0015, seTol: 0.003 });
}, 600_000);

it.each([['ex5.24'], ['ex5.30']])('%s reproduces the Mplus output: fit, estimates and standard errors (direct effects on indicators; a factor scaled by its variance)', async (key) => {
  const r = await fit(key);
  sameFit(r.fit, MPLUS[key].fit);
  samePrinted(r.estimates, MPLUS[key].estimates, key);
  if (key === 'ex5.24') for (const [y, x] of [['y1', 'x1'], ['y8', 'x2']]) expect(r.estimates.find((e) => e.op === '~' && e.lhs === y && e.rhs === x)?.kind).toBe('regression');
  if (key === 'ex5.30') expect(r.estimates.find((e) => e.op === '~~' && e.lhs === 'fg' && e.rhs === 'fg')?.est).toBe(1);
}, 600_000);


it('the replication scripts write the variance scaling (NA* and f ~~ 1*f), the direct effects, and leave an ESEM block’s residual covariance to the rotation', async () => {
  const { cbScriptLavaan } = await import('../../rengine/lavaan');
  const script = (key: string) => cbScriptLavaan(load(key), toSpec(exampleModel(example(key))), 'casewise', 'ML');
  const s530 = await script('ex5.30');
  expect(s530).toContain('fg =~ NA*y1 + y2');
  expect(s530).toMatch(/fg ~~ 1\*fg/);
  expect(s530).toMatch(/fg ~~ 0\*f1/);
  const s524 = await script('ex5.24');
  expect(s524).toMatch(/y1 ~ x1\n/);
  expect(s524).toMatch(/y8 ~ x2\n/);
  expect(s524).not.toMatch(/f1 ~~ f2/);
  expect(s524).not.toContain('auto.cov.y = FALSE');
}, 600_000);

it('ex5.27b–e: with the loadings held equal across groups the unstandardised loadings are rotated (std.ov = FALSE), as Mplus; not without groups or with configural groups', async () => {
  const { cbScriptLavaan } = await import('../../rengine/lavaan');
  const script = (key: string) => cbScriptLavaan(load(key), toSpec(exampleModel(example(key))), 'casewise', 'ML');
  for (const k of ['ex5.27b', 'ex5.27c', 'ex5.27d', 'ex5.27e']) expect(await script(k)).toContain('std.ov = FALSE');
  for (const k of ['ex5.27', 'ex5.28']) expect(await script(k)).not.toContain('std.ov');
  expect(await script('ex5.27d')).toMatch(/group.equal = c\("loadings", "intercepts", "lv.variances", "lv.covariances"\)/);
}, 600_000);
