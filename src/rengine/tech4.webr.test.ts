// The model-implied latent moments (Mplus TECH4) in webR against desktop lavaan, where the endogenous
// factor's moments are written out as defined (:=) parameters with lavaan's delta-method standard
// errors (scripts/validation/tech4.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { ModelSpec } from '../engine/types';
import { estimateCbLavaan } from './lavaan';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const fixtures = join(__dirname, '..', 'engine', '__fixtures__');
const data = parseCsv(readFileSync(join(fixtures, 'multigroup', 'hs_school.csv'), 'utf8')).dataset;
const ref = JSON.parse(readFileSync(join(fixtures, 'means', 'tech4.json'), 'utf8'));
const f = (name: string, indicators: string[]) => ({
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators,
});

it('implied latent means, variances, covariances and correlations, with delta-method standard errors, per group', async () => {
  const spec: ModelSpec = {
    constructs: [
      f('visual', ['x1', 'x2', 'x3']),
      f('textual', ['x4', 'x5', 'x6']),
      f('speed', ['x7', 'x8', 'x9']),
    ],
    paths: [
      { from: 'visual', to: 'speed' },
      { from: 'textual', to: 'speed' },
    ],
    covariances: [{ a: 'visual', b: 'textual', kind: 'construct' }],
    multigroup: { column: 'school', invariance: 'scalar', free: [] },
  };
  const r = await estimateCbLavaan(data, spec, 'casewise', 'ML');
  const [g1, g2] = r.groups!.results.map((x) => x.tech4!);
  expect(g2.names).toEqual(['visual', 'textual', 'speed']);
  const [V, T, S] = [0, 1, 2];
  const d = ref.defined;
  const close = (mine: number | null | undefined, x: { est: number; se: number }, est: number) => {
    expect(est).toBeCloseTo(x.est, 4);
    expect(mine!).toBeCloseTo(x.se, 4);
  };
  close(g2.covSe![S][S], d.var_speed, g2.cov[S][S]);
  close(g2.covSe![V][S], d.cov_visual_speed, g2.cov[V][S]);
  close(g2.covSe![S][T], d.cov_textual_speed, g2.cov[S][T]);
  close(g2.corSe![S][V], d.cor_visual_speed, g2.cor[S][V]);
  close(g2.meanSe![S], d.mean_speed, g2.mean![S]);
  close(g2.meanSe![V], ref.mean_visual, g2.mean![V]);
  close(g1.covSe![S][S], d.var_speed_1, g1.cov[S][S]);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) expect(g2.cov[i][j]).toBeCloseTo(ref.covLv['2'][i][j], 4);
  // The first group's latent means are held at 0 (scalar invariance): no standard error; a correlation's diagonal neither.
  expect(g1.mean).toEqual([0, 0, 0]);
  expect(g1.meanSe).toEqual([null, null, null]);
  expect(g2.corSe![V][V]).toBeNull();
  expect(g2.cor[V][V]).toBeCloseTo(1, 12);
}, 600_000);

it('no mean structure: covariances only; observed variables only: no table', async () => {
  const spec: ModelSpec = {
    constructs: [f('visual', ['x1', 'x2', 'x3']), f('textual', ['x4', 'x5', 'x6'])],
    paths: [{ from: 'visual', to: 'textual' }],
  };
  const r = await estimateCbLavaan(data, spec, 'casewise', 'ML');
  expect(r.tech4!.mean).toBeUndefined();
  expect(r.tech4!.cov[1][1]).toBeGreaterThan(0);
  expect(r.tech4!.covSe![0][1]).toBeGreaterThan(0);
}, 600_000);
