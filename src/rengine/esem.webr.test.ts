// Exploratory SEM blocks (lavaan efa()) in webR against desktop lavaan 0.6-16
// (scripts/validation/esem.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { Dataset, EsemRotation, ModelSpec } from '../engine/types';
import { rCall } from './bridge';
import { cbRequest, cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const data = parseCsv(
  readFileSync(
    join(
      __dirname,
      '..',
      'engine',
      '__fixtures__',
      'validation',
      'data',
      'holzinger_swineford.csv',
    ),
    'utf8',
  ),
).dataset;
const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'esem', 'hs_esem.json'), 'utf8'),
);
const f = (name: string, indicators: string[]) => ({
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators,
});
const factors = [
  f('visual', ['x1', 'x2', 'x3']),
  f('textual', ['x4', 'x5', 'x6']),
  f('speed', ['x7', 'x8', 'x9']),
];
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

it.each(['geomin', 'oblimin', 'target'] as EsemRotation[])(
  'a three-factor ESEM block, %s rotation, matches lavaan (all 27 loadings)',
  async (rotation) => {
    const spec: ModelSpec = {
      constructs: factors,
      paths: [],
      esem: { blocks: [['visual', 'textual', 'speed']], rotation },
    };
    check(await estimateCbLavaan(data, spec, 'casewise', 'ML'), rotation);
  },
  600_000,
);

it('an ESEM block inside a structural model matches lavaan', async () => {
  const spec: ModelSpec = {
    constructs: factors,
    paths: [
      { from: 'visual', to: 'speed' },
      { from: 'textual', to: 'speed' },
    ],
    esem: { blocks: [['visual', 'textual']], rotation: 'geomin' },
  };
  check(await estimateCbLavaan(data, spec, 'casewise', 'ML'), 'structural');
  const script = await cbScriptLavaan(data, spec, 'casewise', 'ML');
  expect(script).toContain('efa("b1")*visual + efa("b1")*textual =~ x1 + x2 + x3 + x4 + x5 + x6');
  expect(script).toContain('rotation = "geomin"');
}, 600_000);

// Bifactor rotations (scripts/validation/bifactor.R): Thurstone's nine tests, a general factor without
// tests of its own and three specific factors. lavaan orders the rotated columns by its own rule; the
// app matches them to its factors (the general one first), so the loadings are compared by name.
const bi = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'esem', 'thurstone_bifactor.json'),
    'utf8',
  ),
);
const tests: string[] = bi.indicators;
const thurstone: Dataset = { names: tests, cols: [], moments: { S: bi.S, n: 213 } };

it.each([
  ['bigeomin', false, 'bigeomin'],
  ['bigeomin', true, 'bigeomin_orthogonal'],
  ['biquartimin', false, 'biquartimin'],
  ['biquartimin', true, 'biquartimin_orthogonal'],
] as [EsemRotation, boolean, string][])(
  'a bifactor ESEM block, %s (orthogonal: %s), matches lavaan, with ECV, omega and omega hierarchical',
  async (rotation, orthogonal, key) => {
    const ref = bi[key];
    const groups: Record<string, string[]> = bi.groups;
    const spec: ModelSpec = {
      constructs: [f('g', []), ...Object.entries(groups).map(([name, items]) => f(name, items))],
      paths: [],
      esem: {
        blocks: [['g', ...Object.keys(groups)]],
        rotation,
        ...(orthogonal ? { orthogonal: true } : {}),
      },
    };
    const r = await estimateCbLavaan(thurstone, spec, 'casewise', 'ML');
    expect(r.fit.chisq).toBeCloseTo(ref.fit.chisq, 3);
    expect(r.fit.df).toBe(ref.fit.df);
    for (const { factor, std } of ref.loadings as { factor: string; std: number[] }[]) {
      tests.forEach((t, i) => {
        const mine = r.estimates.find((e) => e.op === '=~' && e.lhs === factor && e.rhs === t);
        expect(mine, `${factor} =~ ${t}`).toBeTruthy();
        expect(mine!.std).toBeCloseTo(std[i], 3);
      });
    }
    const b = r.bifactor![0];
    expect(b.general).toBe('g');
    expect(b.items).toBe(9);
    for (const k of ['ecv', 'omega', 'omegaH'] as const)
      expect(b[k]).toBeCloseTo(ref.bifactor[k], 4);
    for (const s of ref.bifactor.specific) {
      const mine = b.specific.find((x) => x.factor === s.factor)!;
      expect(mine.omega).toBeCloseTo(s.omega, 4);
      expect(mine.omegaHS).toBeCloseTo(s.omegaHS, 4);
    }
    if (key === 'bigeomin_orthogonal') {
      // psych::omegaFromSem, an independent implementation: it leaves the cross-loadings out, so its omega
      // (.9326 against .9332) and omega hierarchical (.785 against .789) differ a little.
      expect(Math.abs(b.omega - bi.psych.omega)).toBeLessThan(0.002);
      expect(Math.abs(b.omegaH - bi.psych.omegaH)).toBeLessThan(0.01);
    }
  },
  600_000,
);

it('a bifactor block is not bootstrapped (lavaan does not align the rotation across samples)', async () => {
  const spec: ModelSpec = {
    constructs: [f('g', []), ...factors],
    paths: [],
    esem: { blocks: [['g', 'visual', 'textual', 'speed']], rotation: 'bigeomin' },
  };
  await expect(
    rCall(
      'ps_cb_boot',
      { ...cbRequest(data, spec, 'casewise', 'ML'), boot: { samples: 10, seed: 1 } },
      'lavaan',
    ),
  ).rejects.toThrow(/bifactor rotation cannot be bootstrapped/);
  const script = await cbScriptLavaan(data, spec, 'casewise', 'ML');
  expect(script).toContain('rotation = "bigeomin", rotation.args = list(gpa.tol = 1e-8)');
}, 600_000);
