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

const data = parseCsv(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'multigroup', 'hs_school.csv'), 'utf8')).dataset;
const f = (name: string, indicators: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators });
const spec: ModelSpec = { constructs: [f('visual', ['x1', 'x2', 'x3']), f('textual', ['x4', 'x5', 'x6']), f('speed', ['x7', 'x8', 'x9'])], paths: [] };

it.each(['regression', 'Bartlett'] as const)('%s scores equal lavPredict', async (method) => {
  const r = await cbScoresR(data, spec, 'casewise', 'ML', method);
  expect(r.names).toEqual(['visual', 'textual', 'speed']);
  expect(r.rows).toEqual(Array.from({ length: 301 }, (_, i) => i + 1));
  const ref = await withR(['jsonlite', 'lavaan'], { common: commonR }, (webR) => callJson(webR, `
    m <- "visual =~ x1 + x2 + x3\\ntextual =~ x4 + x5 + x6\\nspeed =~ x7 + x8 + x9"
    s <- lavaan::lavPredict(lavaan::cfa(m, lavaan::HolzingerSwineford1939), method = "${method}")
    ps_json(lapply(1:3, function(j) unname(s[1:5, j])))`, null)) as number[][];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 5; i++) expect(r.scores[j][i]).toBeCloseTo(ref[j][i], 6);
}, 900_000);

it('rows left out get no score; groups keep their rows', async () => {
  const holes = { ...data, cols: data.cols.map((c, j) => (data.names[j] === 'x1' ? c.map((v, i) => (i === 2 || i === 10 ? NaN : v)) : c)) };
  const r = await cbScoresR(holes, spec, 'casewise', 'ML', 'regression');
  expect(r.rows).toHaveLength(299);
  expect(r.rows).not.toContain(3);
  const d = scoreColumns(holes, r.names, r.rows, r.scores);
  expect(d.names.slice(-3)).toEqual(['visual_score', 'textual_score', 'speed_score']);
  expect(Number.isNaN(d.cols[d.names.indexOf('visual_score')][2])).toBe(true);
  expect(d.cols[d.names.indexOf('visual_score')][3]).toBeCloseTo(r.scores[0][2], 12);
  const g = await cbScoresR(data, { ...spec, multigroup: { column: 'school', invariance: 'metric', free: [] } }, 'casewise', 'ML', 'regression');
  expect([...g.rows].sort((a, b) => a - b)).toEqual(Array.from({ length: 301 }, (_, i) => i + 1));
}, 900_000);
