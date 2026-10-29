// Labels (equality constraints), a defined parameter and a Wald test, from the
// app's model state through lavaan in webR, against desktop lavaan 0.6-16
// (scripts/validation/categorical_fiml.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { toSpec, type ModelState } from '../model/project';
import { cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const data = parseCsv(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'validation', 'data', 'holzinger_swineford.csv'), 'utf8')).dataset;
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'categorical', 'hs_constraints.json'), 'utf8'));
const C = (id: string, indicators: string[], extra = {}) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators, x: 0, y: 0, side: 'left' as const, ...extra });
const model: ModelState = {
  constructs: [C('visual', ['x1', 'x2', 'x3'], { loadingLabels: { x2: 'b', x3: 'b' } }), C('textual', ['x4', 'x5', 'x6']), C('speed', ['x7', 'x8', 'x9'])],
  paths: [{ id: 'p1', from: 'visual', to: 'speed', label: 'a' }, { id: 'p2', from: 'textual', to: 'speed', label: 'a' }],
  moderations: [],
  // The reference (lavaan's default) correlates the exogenous factors: drawn, as in the app.
  correlations: [{ id: 'k', kind: 'construct', a: 'visual', b: 'textual' }],
  defined: [{ id: 'd', name: 'ab', expr: 'a * b' }],
  waldTests: [{ id: 'w', name: 'b is 1, a is 0.2', constraints: 'b == 1\na == 0.2' }],
};

it('labels, := and lavTestWald match lavaan', async () => {
  const spec = toSpec(model);
  const r = await estimateCbLavaan(data, spec, 'casewise', 'ML');
  expect(r.fit.chisq).toBeCloseTo(ref.fit.chisq, 3);
  expect(r.fit.df).toBe(ref.fit.df);
  const ab = r.estimates.find((e) => e.kind === 'defined' && e.lhs === 'ab')!;
  expect(ab.est).toBeCloseTo(ref.defined.est, 6);
  expect(ab.se!).toBeCloseTo(ref.defined.se, 6);
  expect(r.wald).toEqual([{ name: 'b is 1, a is 0.2', stat: expect.closeTo(ref.wald.stat, 4), df: 2, p: expect.closeTo(ref.wald.p, 8) }]);
  // Equal labels, equal estimates.
  const a = r.estimates.filter((e) => e.label === 'a').map((e) => e.est);
  expect(a).toHaveLength(2);
  expect(a[0]).toBeCloseTo(a[1], 12);
  const script = await cbScriptLavaan(data, spec, 'casewise', 'ML');
  for (const line of ['visual =~ 1*x1 + b*x2 + b*x3', 'speed ~ a*visual + a*textual', 'ab := (a * b)', "lavTestWald(fit, constraints = 'b == 1"]) expect(script).toContain(line);
}, 600_000);

it('refuses code smuggled into a label or expression (project files are untrusted)', async () => {
  const spec = toSpec(model);
  await expect(estimateCbLavaan(data, { ...spec, paths: [{ ...spec.paths[0], label: 'a*visual; stop("x")' }, spec.paths[1]] }, 'casewise', 'ML')).rejects.toThrow(/Invalid parameter label/);
  await expect(estimateCbLavaan(data, { ...spec, defined: [{ name: 'ab', expr: 'system("x")' }] }, 'casewise', 'ML')).rejects.toThrow(/Invalid expression/);
}, 600_000);
