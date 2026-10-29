// Exploratory SEM blocks (lavaan efa()) in webR against desktop lavaan 0.6-16
// (scripts/validation/esem.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { EsemRotation, ModelSpec } from '../engine/types';
import { cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const data = parseCsv(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'validation', 'data', 'holzinger_swineford.csv'), 'utf8')).dataset;
const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'esem', 'hs_esem.json'), 'utf8'));
const f = (name: string, indicators: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators });
const factors = [f('visual', ['x1', 'x2', 'x3']), f('textual', ['x4', 'x5', 'x6']), f('speed', ['x7', 'x8', 'x9'])];
type Est = { lhs: string; op: string; rhs: string; est: number; std: number };

const check = (r: Awaited<ReturnType<typeof estimateCbLavaan>>, key: string) => {
  expect(r.fit.chisq).toBeCloseTo(ref[key].fit.chisq, 3);
  expect(r.fit.df).toBe(ref[key].fit.df);
  for (const e of ref[key].estimates as Est[]) {
    const mine = r.estimates.find((x) => x.lhs === e.lhs && x.op === e.op && x.rhs === e.rhs);
    expect(mine, `${e.lhs} ${e.op} ${e.rhs}`).toBeTruthy();
    expect(mine!.est).toBeCloseTo(e.est, 3);
    expect(mine!.std).toBeCloseTo(e.std, 3);
  }
};

it.each(['geomin', 'oblimin', 'target'] as EsemRotation[])('a three-factor ESEM block, %s rotation, matches lavaan (all 27 loadings)', async (rotation) => {
  const spec: ModelSpec = { constructs: factors, paths: [], esem: { blocks: [['visual', 'textual', 'speed']], rotation } };
  check(await estimateCbLavaan(data, spec, 'casewise', 'ML'), rotation);
}, 600_000);

it('an ESEM block inside a structural model matches lavaan', async () => {
  const spec: ModelSpec = { constructs: factors, paths: [{ from: 'visual', to: 'speed' }, { from: 'textual', to: 'speed' }], esem: { blocks: [['visual', 'textual']], rotation: 'geomin' } };
  check(await estimateCbLavaan(data, spec, 'casewise', 'ML'), 'structural');
  const script = await cbScriptLavaan(data, spec, 'casewise', 'ML');
  expect(script).toContain('efa("b1")*visual + efa("b1")*textual =~ x1 + x2 + x3 + x4 + x5 + x6');
  expect(script).toContain('rotation = "geomin"');
}, 600_000);
