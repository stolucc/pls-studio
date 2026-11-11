// The partial correlation card equals ppcor called directly in desktop R (scripts/validation/regression_extras.R):
// the help page's pcor() and spcor() matrices of its y.data (each pair controlling for the others) with Pearson,
// Spearman and Kendall, and pairs of ?swiss controlling for chosen variables.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { PACKAGE_EXAMPLES, panelPreset } from '../examples/packages';
import { exampleTestData } from '../examples/testData';
import { against, example, near } from '../validation/record';
import { rCall } from './bridge';
import { PCOR_METHODS, pcorR, pcorScriptR, type PcorInput } from './pcor';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'regression', 'extras.json'),
    'utf8',
  ),
);
const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'ppcor-help')!;
const yData = exampleTestData(ex)!;
const VARS = ['hl', 'disp', 'deg', 'BC'];
// (the card's PCOR_METHODS written out, so the evidence manifest finds each by name)
const METHODS = ['pearson', 'spearman', 'kendall'] as const;

describe('partial correlations (ppcor)', () => {
  it('covers every method of the card', () => {
    expect(METHODS).toEqual(PCOR_METHODS);
  });

  it.each(METHODS)(
    '%s: each pair controlling for the others equals pcor() and spcor() of the help page',
    async (method) => {
      const r = await pcorR(yData, { vars: VARS, controls: [], method });
      const want = ref.pcorHelp[method];
      // (closed forms on ten cases: 1e-8 between webR and desktop R)
      for (const p of r.pairs) {
        const i = VARS.indexOf(p.a);
        const j = VARS.indexOf(p.b);
        expect(p.given).toEqual(VARS.filter((v) => v !== p.a && v !== p.b));
        expect(p.partial.r, `${p.a}–${p.b}: partial`).toBeCloseTo(want.partial[i][j], 8);
        expect(p.partial.p, `${p.a}–${p.b}: partial p`).toBeCloseTo(want.partial_p[i][j], 8);
        expect(p.partial.stat, `${p.a}–${p.b}: statistic`).toBeCloseTo(want.partial_stat[i][j], 6);
        expect(p.semiAB.r, `${p.a} with ${p.b}: semi-partial`).toBeCloseTo(want.semi[i][j], 8);
        expect(p.semiBA.r, `${p.b} with ${p.a}: semi-partial`).toBeCloseTo(want.semi[j][i], 8);
        expect(p.semiAB.p, `${p.a} with ${p.b}: semi-partial p`).toBeCloseTo(want.semi_p[i][j], 8);
      }
    },
  );

  it.each(METHODS)(
    '%s: pairs controlling for chosen variables equal pcor.test and spcor.test',
    async (method) => {
      const raw = await rCall<{ names: string[]; cols: number[][] }>(
        'ps_dataset',
        { package: 'datasets', name: 'swiss', na: [] },
        'ppcor',
      );
      const swiss: Dataset = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c)) };
      const input: PcorInput = {
        vars: ['Fertility', 'Agriculture', 'Examination'],
        controls: ['Education', 'Catholic'],
        method,
      };
      const r = await pcorR(swiss, input);
      const want = ref.pcorControlled[method] as {
        a: string;
        b: string;
        partial: number;
        partial_p: number;
        semi_ab: number;
        semi_ba: number;
      }[];
      expect(r.pairs.length).toBe(want.length);
      r.pairs.forEach((p, i) => {
        expect([p.a, p.b]).toEqual([want[i].a, want[i].b]);
        expect(p.given).toEqual(['Education', 'Catholic']);
        expect(p.partial.r, `${p.a}–${p.b}: partial`).toBeCloseTo(want[i].partial, 8);
        expect(p.partial.p, `${p.a}–${p.b}: partial p`).toBeCloseTo(want[i].partial_p, 8);
        expect(p.semiAB.r, `${p.a} with ${p.b}: semi-partial`).toBeCloseTo(want[i].semi_ab, 8);
        expect(p.semiBA.r, `${p.b} with ${p.a}: semi-partial`).toBeCloseTo(want[i].semi_ba, 8);
      });
      if (method === 'pearson') {
        const script = await pcorScriptR(swiss, input);
        expect(script).toContain('library(ppcor)');
        expect(script).toContain('controls <- c("Education", "Catholic")');
      }
    },
  );

  it('rejects requests outside the whitelist', async () => {
    await expect(
      pcorR(yData, { vars: VARS, controls: [], method: 'evil' as never }),
    ).rejects.toThrow(/method/);
    await expect(
      pcorR(yData, { vars: ['hl', 'disp'], controls: [], method: 'pearson' }),
    ).rejects.toThrow(/three variables/);
    await expect(
      pcorR(yData, { vars: ['hl', 'disp'], controls: ['hl'], method: 'pearson' }),
    ).rejects.toThrow(/control variable/);
  });
});

// The home-screen example: the help page's pcor(y.data) and spcor.test(hl, disp, deg + BC).
it('the ppcor example’s card equals the help page run natively', async () => {
  example('ppcor-help', {
    title: ex.title,
    method: 'Basic statistics',
    packages: ['ppcor'],
    definition: ex,
  });
  against({
    label:
      'the help pages’ pcor() and spcor() in desktop R, scripts/validation/regression_extras.R',
    script: 'scripts/validation/regression_extras.R',
    level: 'native',
  });
  const r = await pcorR(yData, panelPreset(ex.panel!) as unknown as PcorInput);
  const want = ref.pcorHelp.pearson;
  for (const p of r.pairs) {
    const i = VARS.indexOf(p.a);
    const j = VARS.indexOf(p.b);
    near(`${p.a}–${p.b}: partial r`, p.partial.r, want.partial[i][j], 1e-8);
    near(`${p.a} with ${p.b}: semi-partial r`, p.semiAB.r, want.semi[i][j], 1e-8);
  }
});
