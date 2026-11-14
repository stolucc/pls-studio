// What the R bridge sends back and exports, checked end to end (the R bridge audit of
// 2026-11): JSON shapes that must not depend on how many elements there are, and
// exported scripts that reproduce what the app reports. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { McDesign } from '../engine/montecarlo';
import type { ModelSpec } from '../engine/types';
import { rCall } from './bridge';
import { cbRequest, estimateCbLavaan } from './lavaan';
import { mcChunkRequest, runMcChunkR } from './mc';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const hs = parseCsv(
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

const oneFactor: ModelSpec = {
  constructs: [{ name: 'visual', type: 'factor', mode: 'A', indicators: ['x1', 'x2', 'x3'] }],
  paths: [],
};

it('a one-factor CFA sends its construct names as an array', async () => {
  const raw = await rCall<Record<string, any>>(
    'ps_cb',
    cbRequest(hs, oneFactor, 'casewise', 'ML'),
    'lavaan',
  );
  expect(raw.constructs).toEqual(['visual']);
  const r = await estimateCbLavaan(hs, oneFactor, 'casewise', 'ML');
  expect(r.constructs).toEqual(['visual']);
  expect(r.reliability).toHaveLength(1);
}, 600_000);

it('a Monte Carlo chunk of one replication sends one-element arrays', async () => {
  const design: McDesign = {
    population: {
      constructs: ['A', 'B'].map((name) => ({
        name,
        type: 'factor' as const,
        indicators: [1, 2, 3].map((i) => `${name.toLowerCase()}${i}`),
        loadings: [0.8, 0.7, 0.75],
      })),
      paths: [{ from: 'A', to: 'B', value: 0.4 }],
      exoCor: [],
    },
    estimators: [{ id: 'CB-ML', method: 'cb', estimator: 'ML' }],
    sampleSizes: [200],
    replications: 1,
    seed: 5,
    alpha: 0.05,
    bootSamples: 0,
    mcDraws: 500,
  };
  const raw = await rCall<Record<string, any>>(
    'ps_mc',
    mcChunkRequest(design, 200, 0, 1),
    'simulation',
  );
  expect(Array.isArray(raw.proper[0])).toBe(true);
  expect(Array.isArray(raw.est[0][0])).toBe(true);
  const part = await runMcChunkR(design, 200, 0, 1);
  expect(part.est[0][0]).toHaveLength(1);
}, 600_000);

it('values per group go to the groups in the order of their codes, whatever the order of the rows', async () => {
  // Two groups (codes 1 and 2) and a covariance held at 0.2 in group 1 and 0.4 in group 2.
  const g = Float64Array.from(hs.cols[0], (_v, i) => (i % 3 === 1 ? 2 : 1));
  const grouped = { names: [...hs.names, 'g'], cols: [...hs.cols, g] };
  const order = Array.from(g.keys()).sort((a, b) => g[b] - g[a] || a - b);
  const reordered = {
    names: grouped.names,
    cols: grouped.cols.map((c) => Float64Array.from(order, (i) => c[i])),
  };
  const f = (name: string, indicators: string[]) => ({
    name,
    type: 'factor' as const,
    mode: 'A' as const,
    indicators,
  });
  const spec: ModelSpec = {
    constructs: [f('visual', ['x1', 'x2', 'x3']), f('textual', ['x4', 'x5', 'x6'])],
    paths: [],
    covariances: [{ a: 'visual', b: 'textual', kind: 'construct', byGroup: [0.2, 0.4] }],
    multigroup: { column: 'g', invariance: 'configural', free: [] },
  };
  const first = await estimateCbLavaan(grouped, spec, 'casewise', 'ML');
  const sorted = await estimateCbLavaan(reordered, spec, 'casewise', 'ML');
  // (rows of group 2 first: lavaan makes it its first group, so the values must follow the groups, not the positions)
  expect(reordered.cols[9][0]).toBe(2);
  expect(first.groups!.labels).toEqual(['1', '2']);
  expect(sorted.groups!.labels).toEqual(['2', '1']);
  expect(sorted.fit.chisq).toBeCloseTo(first.fit.chisq, 8);
  const cov = (r: typeof first, group: string) =>
    r.groups!.results[r.groups!.labels.indexOf(group)].estimates.find(
      (e) => e.op === '~~' && e.lhs === 'visual' && e.rhs === 'textual',
    )!.est;
  for (const r of [first, sorted]) {
    expect(cov(r, '1')).toBeCloseTo(0.2, 12);
    expect(cov(r, '2')).toBeCloseTo(0.4, 12);
  }
}, 600_000);
