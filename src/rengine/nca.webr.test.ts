// Necessary condition analysis in webR against the NCA package in desktop R
// (scripts/validation/nca.R; NCA itself cannot load in the browser's R):
// effect sizes, permutation p-values, accuracy, the CR-FDH line and the
// bottleneck tables on NCA's own example. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { bottleneckText, ncaR, ncaScriptR } from './nca';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'nca', 'reference.json'), 'utf8'));
const data = parseCsv(readFileSync(join(__dirname, '..', '..', 'public', 'examples', 'nca', 'nca_example.csv'), 'utf8')).dataset;

it('equals the NCA package (CE-FDH, CR-FDH, permutation test, bottlenecks)', async () => {
  const r = await ncaR(data, ['Individualism', 'Risk taking'], 'Innovation performance', 100);
  ref.conditions.forEach((c: any, j: number) => {
    const o = r.conditions[j];
    expect(o.x).toBe(c.x);
    expect(o.ceFdh).toBeCloseTo(c.ce, 6);
    expect(o.crFdh).toBeCloseTo(c.cr, 6);
    expect(o.p!.ce_fdh).toBeCloseTo(c.pce, 10);
    expect(o.p!.cr_fdh).toBeCloseTo(c.pcr, 10);
    expect(o.accuracy!).toBeCloseTo(c.accuracy, 6);
    expect(o.slope!).toBeCloseTo(c.slope, 5);
    expect(o.intercept!).toBeCloseTo(c.intercept, 5);
    expect(o.bottleneck.map((b) => bottleneckText(b.crFdh))).toEqual(c.bottleneckCr);
    expect(o.bottleneck.map((b) => bottleneckText(b.ceFdh))).toEqual(c.bottleneckCe);
  });
  expect(await ncaScriptR(data, ['Individualism'], 'Innovation performance', 100)).toContain('nca_peers <- function(x, y)');
}, 900_000);
