// A dichotomous Y (logistic regression) and model 74's counterfactual effects
// through the app's lm / glm bootstrap engine in webR, against PROCESS for R
// (scripts/validation/process_extensions.R). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { materialise, template } from '../process/templates';
import { cpaScriptR, estimateCpaR, type CpaInput } from './cpa';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'process', '__fixtures__', 'reference');
const data = parseCsv(readFileSync(join(DIR, 'data_ext.csv'), 'utf8')).dataset;
const ext = JSON.parse(readFileSync(join(DIR, 'extensions.json'), 'utf8'));
const key = (t: string[]) => [...t].sort().join('*');

const input = (
  model: number,
  roles: { x: string; y: string; w?: string },
  extra: Partial<CpaInput>,
): CpaInput => {
  const names = [roles.x, roles.y, 'm1', 'c1', ...(roles.w ? [roles.w] : [])];
  return {
    graph: materialise(template(model)!, { ...roles, m: ['m1'] }),
    model,
    order: ['w'],
    covariates: ['c1'],
    variables: names.map((n) => ({ name: n, indicators: [n] })),
    missing: 'casewise',
    probe: 'percentiles',
    boot: { samples: 300, seed: 1 },
    confidence: 0.95,
    ...extra,
  };
};

describe('dichotomous Y (logistic regression)', () => {
  it.each([4, 7, 14])(
    'model %i matches PROCESS',
    async (model) => {
      const ref = ext[`binary_model${model}`];
      const r = await estimateCpaR(
        data,
        input(model, { x: 'x', y: 'ybin', ...(model !== 4 ? { w: 'w' } : {}) }, { binaryY: true }),
      );
      for (const [outcome, eq] of Object.entries(
        ref.equations as Record<string, { coef: Record<string, number>; summary: number[] }>,
      )) {
        const mine = r.equations.find((e) => e.outcome === outcome)!;
        for (const [term, b] of Object.entries(eq.coef)) {
          const vars = term === 'constant' ? '' : key(term.split('*'));
          expect(
            mine.coefficients.find((c) => key(c.term) === vars)?.est,
            `${outcome}: ${term}`,
          ).toBeCloseTo(b, 5);
        }
        if (outcome === 'ybin') {
          expect(mine.logistic).toBe(true);
          expect(mine.deviance!).toBeCloseTo(eq.summary[0], 4);
          expect(mine.mcfadden!).toBeCloseTo(eq.summary[4], 5);
        }
      }
      const theirs = ref.indirect.rows as { values: number[] }[];
      const rows = r.indirect[0].rows;
      if (model === 4)
        expect(rows[0].est).toBeCloseTo(theirs.find((x) => x.values.length >= 4)!.values[0], 5);
      else
        for (const t of theirs)
          expect(
            rows.find((x) => Math.abs(Object.values(x.at)[0] - t.values[0]) < 1e-6)!.est,
          ).toBeCloseTo(t.values[1], 5);
      if (ref.index?.rows) expect(r.indices[0].est).toBeCloseTo(ref.index.rows[0].values[0], 5);
      expect(r.direct!.rows[0].est).toBeCloseTo(
        ref.direct.rows[0].values[
          ref.direct.header.indexOf('effect') >= 0 ? ref.direct.header.indexOf('effect') : 0
        ],
        5,
      );
    },
    600_000,
  );
});

describe('model 74: counterfactual effects (X by M interaction)', () => {
  it('pure natural direct, controlled direct and total natural indirect effects match PROCESS', async () => {
    const ref = ext.model74;
    const inp = input(74, { x: 'xbin', y: 'y' }, { counterfactual: { xref: 0, xcf: 1 } });
    const r = await estimateCpaR(data, inp);
    const eff = (n: string) => r.counterfactual!.effects.find((e) => e.name === n)!.est;
    expect(eff('pnde')).toBeCloseTo(ref.pnde, 6);
    expect(eff('cde')).toBeCloseTo(ref.cde, 6);
    expect(eff('tnie:m1')).toBeCloseTo(ref.tnie, 6);
    expect(eff('total')).toBeCloseTo(ref.pnde + ref.tnie, 6);
    expect(await cpaScriptR(data, inp)).toContain('refit <- function(d)');
  }, 600_000);
});
