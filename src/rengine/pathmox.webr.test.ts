// PATHMOX in webR against genpathmox in desktop R (scripts/validation/
// pathmox.R): the help page's csibank example with ordered age and
// education. Native cSEM 0.6.1, webR 0.7.1. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ModelSpec } from '../engine/types';
import { categoriesOf } from '../io';
import { rCall } from './bridge';
import { pathmoxR, pathmoxScriptR, type PathmoxSegment } from './segment';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'pathmox', 'reference.json'), 'utf8'));
const it_ = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);
const spec: ModelSpec = {
  constructs: [{ name: 'QUAL', type: 'composite', mode: 'B', indicators: it_('qual', 7) }, { name: 'IMAG', type: 'factor', mode: 'A', indicators: it_('imag', 6) },
    { name: 'VAL', type: 'factor', mode: 'A', indicators: it_('val', 4) }, { name: 'SAT', type: 'factor', mode: 'A', indicators: it_('sat', 3) }, { name: 'LOY', type: 'factor', mode: 'A', indicators: it_('loy', 3) }],
  paths: [{ from: 'QUAL', to: 'VAL' }, { from: 'IMAG', to: 'SAT' }, { from: 'QUAL', to: 'SAT' }, { from: 'VAL', to: 'SAT' }, { from: 'IMAG', to: 'LOY' }, { from: 'SAT', to: 'LOY' }],
};

it('the csibank tree equals genpathmox', async () => {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: 'genpathmox', name: 'csibank', na: [] }, 'genpathmox');
  const data = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
  const cat = data.categories!;
  const ordered = (col: string, order: string[]): PathmoxSegment => ({ column: col, labels: cat[col], ordered: true, order: order.map((l) => cat[col].indexOf(l) + 1) });
  const segments: PathmoxSegment[] = [{ column: 'Gender', labels: cat.Gender, ordered: false },
    ordered('Age', ['<=25', '26-35', '36-45', '46-55', '56-65', '>=66']), ordered('Education', ['Unfinished', 'Elementary', 'Highschool', 'Undergrad', 'Graduated']),
    { column: 'Occupation', labels: cat.Occupation, ordered: false }, { column: 'Region', labels: cat.Region, ordered: false }];
  const options = { scheme: 'path' as const, consistent: true, tolerance: 1e-7, maxIter: 300, missing: 'casewise' as const };
  const r = await pathmoxR(data, spec, options, { segments, alpha: 0.05, depth: 2, size: 0.1 });
  expect(r.nodes.map((n) => n.size)).toEqual(ref.sizes);
  expect(r.nodes.slice(1).map((n) => n.category)).toEqual(ref.categories.slice(1));
  r.splits.forEach((s, i) => expect(s.f).toBeCloseTo(ref.splitF[i], 3));
  for (const imp of r.importance) expect(imp.ranking).toBeCloseTo(ref.importance[imp.variable], 6);
  r.terminal.rows.forEach((row, i) => row.values.forEach((v, j) => expect(v).toBeCloseTo(ref.terminal[i][j], 3)));
  expect(r.terminal.rows[0].name).toBe('QUAL->VAL');
  expect(await pathmoxScriptR(data, spec, options, { segments, alpha: 0.05, depth: 2, size: 0.1 })).toContain('pmx <- pls.pathmox(');
}, 900_000);
