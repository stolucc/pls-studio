// CB-SEM factor scores in webR: equal to lavaan::lavPredict on the same model
// in the same session (regression and Bartlett), and placed in the right data
// rows when rows are left out (casewise deletion) or the model has groups.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { ModelSpec } from '../engine/types';
import commonR from './R/common.R?raw';
import { cbScoresR, scoreColumns } from './lavaan';
import { callJson, withR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const data = parseCsv(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'multigroup', 'hs_school.csv'),
    'utf8',
  ),
).dataset;
const f = (name: string, indicators: string[]) => ({
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators,
});
const spec: ModelSpec = {
  constructs: [
    f('visual', ['x1', 'x2', 'x3']),
    f('textual', ['x4', 'x5', 'x6']),
    f('speed', ['x7', 'x8', 'x9']),
  ],
  paths: [],
};

it.each(['regression', 'Bartlett'] as const)(
  '%s scores equal lavPredict',
  async (method) => {
    const r = await cbScoresR(data, spec, 'casewise', 'ML', method);
    expect(r.names).toEqual(['visual', 'textual', 'speed']);
    expect(r.rows).toEqual(Array.from({ length: 301 }, (_, i) => i + 1));
    const ref = (await withR(['jsonlite', 'lavaan'], { common: commonR }, (webR) =>
      callJson(
        webR,
        `
    m <- "visual =~ x1 + x2 + x3\\ntextual =~ x4 + x5 + x6\\nspeed =~ x7 + x8 + x9"
    s <- lavaan::lavPredict(lavaan::cfa(m, lavaan::HolzingerSwineford1939), method = "${method}")
    ps_json(lapply(1:3, function(j) unname(s[1:5, j])))`,
        null,
      ),
    )) as number[][];
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 5; i++) expect(r.scores[j][i]).toBeCloseTo(ref[j][i], 6);
  },
  900_000,
);

it('rows left out get no score; groups keep their rows', async () => {
  const holes = {
    ...data,
    cols: data.cols.map((c, j) =>
      data.names[j] === 'x1' ? c.map((v, i) => (i === 2 || i === 10 ? NaN : v)) : c,
    ),
  };
  const r = await cbScoresR(holes, spec, 'casewise', 'ML', 'regression');
  expect(r.rows).toHaveLength(299);
  expect(r.rows).not.toContain(3);
  const d = scoreColumns(holes, r.names, r.rows, r.scores);
  expect(d.names.slice(-3)).toEqual(['visual_score', 'textual_score', 'speed_score']);
  expect(Number.isNaN(d.cols[d.names.indexOf('visual_score')][2])).toBe(true);
  expect(d.cols[d.names.indexOf('visual_score')][3]).toBeCloseTo(r.scores[0][2], 12);
  const g = await cbScoresR(
    data,
    { ...spec, multigroup: { column: 'school', invariance: 'metric', free: [] } },
    'casewise',
    'ML',
    'regression',
  );
  expect([...g.rows].sort((a, b) => a - b)).toEqual(Array.from({ length: 301 }, (_, i) => i + 1));
}, 900_000);

// Standard errors (lavPredict se = "standard") and plausible values (semTools::plausibleValues).
const lavRef = (code: string) =>
  withR(['jsonlite', 'lavaan', 'semTools'], { common: commonR }, (webR) =>
    callJson(
      webR,
      `
  suppressPackageStartupMessages(library(semTools))
  m <- "visual =~ x1 + x2 + x3\\ntextual =~ x4 + x5 + x6\\nspeed =~ x7 + x8 + x9"
  ${code}`,
      null,
    ),
  );

it('standard errors equal lavPredict’s: one per group with complete data, per case with FIML', async () => {
  const r = await cbScoresR(data, spec, 'casewise', 'ML', 'regression', { se: true });
  const ref =
    (await lavRef(`s <- attr(lavaan::lavPredict(lavaan::cfa(m, lavaan::HolzingerSwineford1939), se = "standard"), "se")[[1]]
    ps_json(unname(s[1, ]))`)) as number[];
  expect(r.se).toHaveLength(3);
  for (let j = 0; j < 3; j++) {
    expect(r.se![j]).toHaveLength(301);
    expect(r.se![j][0]).toBeCloseTo(ref[j], 6);
    expect(r.se![j][300]).toBeCloseTo(ref[j], 6);
  }
  const d = scoreColumns(
    scoreColumns(data, r.names, r.rows, r.scores),
    r.names,
    r.rows,
    r.se!,
    '_se',
  );
  expect(d.names.slice(-6)).toEqual([
    'visual_score',
    'textual_score',
    'speed_score',
    'visual_se',
    'textual_se',
    'speed_se',
  ]);
  // FIML: a case missing x1 knows less about visual, so its score has a larger standard error.
  const holes = {
    ...data,
    cols: data.cols.map((c, j) =>
      data.names[j] === 'x1' ? c.map((v, i) => (i === 2 ? NaN : v)) : c,
    ),
  };
  const b = await cbScoresR(holes, spec, 'fiml', 'ML', 'Bartlett', { se: true });
  expect(b.rows).toHaveLength(301);
  const at = b.rows.indexOf(3),
    other = b.rows.indexOf(4);
  expect(b.se![0][at]).toBeGreaterThan(b.se![0][other]);
  expect(b.se![1][at]).toBeCloseTo(b.se![1][other], 10);
}, 900_000);

it('plausible values equal semTools’s for the same seed', async () => {
  const r = await cbScoresR(data, spec, 'casewise', 'ML', 'plausible', { draws: 3, seed: 42 });
  expect(r.names).toEqual(['visual', 'textual', 'speed']);
  expect(r.draws).toHaveLength(3);
  const ref =
    (await lavRef(`pv <- plausibleValues(lavaan::cfa(m, lavaan::HolzingerSwineford1939), nDraws = 3, seed = 42)
    ps_json(lapply(pv, function(d) unname(d$textual[1:5])))`)) as number[][];
  for (let k = 0; k < 3; k++)
    for (let i = 0; i < 5; i++) expect(r.draws![k][1][i]).toBeCloseTo(ref[k][i], 6);
  expect(r.draws![0][1][0]).not.toBeCloseTo(r.draws![1][1][0], 3);
}, 900_000);

it('plausible values scatter around the regression scores by their standard errors, in the right rows with groups', async () => {
  // Rows interleaved across the two schools, so that a row mix-up would show.
  const order = Array.from({ length: 301 }, (_, i) => i).sort(
    (a, b) => ((a * 7919) % 301) - ((b * 7919) % 301),
  );
  const mixed = { ...data, cols: data.cols.map((c) => Float64Array.from(order, (i) => c[i])) };
  const g = { ...spec, multigroup: { column: 'school', invariance: 'metric' as const, free: [] } };
  const pv = await cbScoresR(mixed, g, 'casewise', 'ML', 'plausible', { draws: 100, seed: 7 });
  const reg = await cbScoresR(mixed, g, 'casewise', 'ML', 'regression', { se: true });
  const byRow = (rows: number[], v: number[]) => {
    const out = new Array<number>(302).fill(NaN);
    rows.forEach((r, i) => {
      out[r] = v[i];
    });
    return out;
  };
  for (let j = 0; j < 3; j++) {
    const score = byRow(reg.rows, reg.scores[j]),
      se = byRow(reg.rows, reg.se![j]);
    const draws = pv.draws!.map((d) => byRow(pv.rows, d[j]));
    let off = 0,
      ratio = 0;
    for (let r = 1; r <= 301; r++) {
      const x = draws.map((d) => d[r]);
      const mean = x.reduce((a, b) => a + b, 0) / x.length;
      const sd = Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / (x.length - 1));
      off += Math.abs(mean - score[r]) / se[r];
      ratio += sd / se[r];
    }
    // (the mean of 100 draws is off by about 0.1 SE on average; the SD within about 7%)
    expect(off / 301).toBeLessThan(0.15);
    expect(ratio / 301).toBeGreaterThan(0.93);
    expect(ratio / 301).toBeLessThan(1.07);
  }
}, 900_000);

it('plausible values are refused with FIML and with ordinal indicators', async () => {
  await expect(cbScoresR(data, spec, 'fiml', 'ML', 'plausible')).rejects.toThrow(
    /need complete cases/,
  );
  await expect(
    cbScoresR(data, { ...spec, ordered: ['x1', 'x2', 'x3'] }, 'casewise', 'WLSMV', 'plausible'),
  ).rejects.toThrow(/continuous indicators only/);
}, 900_000);
