// A multicategorical X (PROCESS mcx = 1-4) through the app's codes and
// manymome in webR, against PROCESS for R (scripts/validation/process_extensions.R).
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { dummies, type XCoding } from '../process/categorical';
import { materialise, template } from '../process/templates';
import { estimateCpaR, type CpaInput } from './cpa';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'process', '__fixtures__', 'reference');
const data = parseCsv(readFileSync(join(DIR, 'data_ext.csv'), 'utf8')).dataset;
const ext = JSON.parse(readFileSync(join(DIR, 'extensions.json'), 'utf8'));
const CODING: XCoding[] = ['indicator', 'sequential', 'helmert', 'effect'];
const input = (model: number, coding: XCoding): CpaInput => {
  const roles = { x: 'xcat', y: 'y', m: ['m1'], ...(model === 7 ? { w: 'w' } : {}) };
  const names = ['xcat', 'y', 'm1', 'c1', ...(model === 7 ? ['w'] : [])];
  return {
    graph: materialise(template(model)!, roles),
    model,
    order: ['w'],
    covariates: ['c1'],
    variables: names.map((n) => ({ name: n, indicators: [n] })),
    categorical: dummies('xcat', data.cols[data.names.indexOf('xcat')], coding),
    missing: 'casewise',
    probe: 'percentiles',
    boot: { samples: 200, seed: 1 },
    confidence: 0.95,
  };
};
const code = (label: string) => label.replace(/^X(\d)$/, 'xcat D$1');
const key = (t: string[]) => [...t].sort().join('*');

it.each([1, 2, 3, 4])(
  'model 4, mcx = %i: coefficients, relative direct and indirect effects as PROCESS',
  async (mcx) => {
    const ref = ext[`mcx${mcx}_model4`];
    const r = await estimateCpaR(data, input(4, CODING[mcx - 1]));
    for (const [outcome, eq] of Object.entries(
      ref.equations as Record<string, { coef: Record<string, number> }>,
    )) {
      for (const [term, b] of Object.entries(eq.coef)) {
        const vars = term === 'constant' ? '' : key(term.split('*').map(code));
        expect(
          r.equations
            .find((e) => e.outcome === outcome)!
            .coefficients.find((c) => key(c.term) === vars)?.est,
          `${outcome}: ${term}`,
        ).toBeCloseTo(b, 6);
      }
    }
    for (const row of ref.direct.rows.filter((x: { values: number[] }) => x.values.length)) {
      expect(r.directs.find((d) => d.x === code(row.label))!.rows[0].est).toBeCloseTo(
        row.values[0],
        6,
      );
    }
    for (const row of ref.indirect.rows)
      expect(r.indirect.find((p) => p.path[0] === code(row.label))!.rows[0].est).toBeCloseTo(
        row.values[0],
        6,
      );
    expect(r.coding!.table).toHaveLength(3);
  },
  600_000,
);

it('model 7, indicator coding: relative conditional indirect effects and indices as PROCESS', async () => {
  const ref = ext.mcx1_model7;
  const r = await estimateCpaR(data, input(7, 'indicator'));
  for (const row of ref.indirect.rows) {
    const p = r.indirect.find((x) => x.path[0] === code(row.label))!;
    expect(p.rows.find((x) => Math.abs(x.at.w - row.values[0]) < 1e-6)!.est).toBeCloseTo(
      row.values[1],
      6,
    );
  }
  const idx = r.indices.filter((i) => i.kind === 'mm');
  ref.index.forEach((t: { rows: { values: number[] }[] }, j: number) =>
    expect(idx[j].est).toBeCloseTo(t.rows[0].values[0], 6),
  );
}, 600_000);
