// Informative hypotheses (R/hypotheses.R) against restriktor, semTools and bain called directly in desktop R
// (scripts/validation/hypotheses.R → src/engine/__fixtures__/hypotheses.json): semTools' ?goricaSEM example on the
// app's diagram, several hypotheses with a linear combination against the unconstrained hypothesis, bain on
// unstandardised paths with fraction 2, the exported script, and hypotheses that are not the app's grammar refused in R.
// The penalties and Bayes factors are simulated with the seed; lavaan's estimates differ by ~1e-6 relative between
// webR and desktop R (WebAssembly floating point), hence 1e-5 on what derives from them. Run with WEBR_TESTS=1.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { makeCovariancesExplicit, toSpec } from '../model/project';
import { parseLavaanSyntax } from '../model/syntax';
import { rCall, rMessage } from './bridge';
import type { CbCall } from './cbExtras';
import { cbRequest } from './lavaan';
import { hypothesesR, hypothesesScriptR, type HypRequest, type HypResult } from './hypotheses';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';
import { near } from '../validation/record';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const REF = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'hypotheses.json'), 'utf8'));
type G = { models: string[]; loglik: number[]; penalty: number[]; gorica: number[]; weights: number[]; ratio: number[][] };
type B = { rows: string[]; fit: (number | string)[]; com: (number | string)[]; bfu: (number | string)[]; bfc: (number | string)[]; pmpa: (number | string)[]; pmpb: (number | string)[]; pmpc: (number | string)[]; matrix: number[][] };
/** Recorded (validation/record.ts), relative to the size of the value. */
const rel = (what: string, got: number | null, want: number, tol: number) => near(what, got ?? NaN, want, tol * Math.max(1, Math.abs(want)));

function sameGorica(g: HypResult['gorica'], ref: G) {
  expect(g).not.toBeNull();
  expect(g!.models).toEqual(ref.models);
  ref.models.forEach((m, i) => {
    rel(`${m} log-likelihood`, g!.loglik[i], ref.loglik[i], 1e-5);
    rel(`${m} penalty`, g!.penalty[i], ref.penalty[i], 1e-5);
    rel(`${m} GORICA`, g!.gorica[i], ref.gorica[i], 1e-5);
    rel(`${m} weight`, g!.weights[i], ref.weights[i], 1e-5);
  });
}
function sameBain(b: HypResult['bain'], ref: B) {
  expect(b).not.toBeNull();
  expect(b!.rows).toEqual(ref.rows);
  for (const k of ['fit', 'com', 'bfu', 'bfc', 'pmpa', 'pmpb', 'pmpc'] as const) ref[k].forEach((v, i) => { if (typeof v === 'number') rel(`${ref.rows[i]} ${k}`, b![k][i], v, 1e-5); else expect(b![k][i], `${ref.rows[i]} ${k}`).toBeNull(); });
  ref.matrix.forEach((row, i) => row.forEach((v, j) => rel(`BF ${ref.rows[i]} vs ${ref.rows[j]}`, b!.matrix[i][j], v, 1e-5)));
}

async function load(pkg: 'lavaan' | 'bain', name: string): Promise<Dataset> {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: pkg, name, na: [] }, pkg);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
}
const call = (data: Dataset, syntax: string): CbCall => ({ data, spec: toSpec(makeCovariancesExplicit(parseLavaanSyntax(syntax).model)), missing: 'casewise', estimator: 'ML', interaction: 'product' });
const GS = ['ind60 =~ x1 + x2 + x3', 'dem60 =~ y1 + a1*y2 + b1*y3 + c1*y4', 'dem65 =~ y5 + a2*y6 + b2*y7 + c2*y8', 'dem60 ~ ind60', 'dem65 ~ ind60 + dem60',
  'y1 ~~ y5', 'y2 ~~ y4', 'y2 ~~ y6', 'y3 ~~ y7', 'y4 ~~ y8', 'y6 ~~ y8'].join('\n');
const SESAME = ['A =~ Ab + Al + Af + An + Ar + Ac', 'B =~ Bb + Bl + Bf + Bn + Br + Bc', 'A ~ b_B*B + b_age*age + b_peabody*peabody'].join('\n');
const req = (o: Partial<HypRequest>): HypRequest => ({ text: '', method: 'gorica', comparison: 'complement', standardized: false, fraction: 1, seed: 100, ...o });

describe('informative hypotheses (restriktor, bain)', () => {
  it('GORICA: semTools’ ?goricaSEM example (a1 > a2, b1 > b2, c1 > c2 against the complement)', async () => {
    const c = call(await load('lavaan', 'PoliticalDemocracy'), GS);
    const r = await hypothesesR(c, req({ text: 'a1 > a2 & b1 > b2 & c1 > c2' }));
    sameGorica(r.gorica, REF.goricaSEM);
    expect(r.bain).toBeNull();
    expect(r.estimates.map((e) => e.label).sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'c1', 'c2']);
    expect(r.estimates.find((e) => e.label === 'a1')!.what).toBe('dem60 → y2');
    expect(r.engine.package).toBe('restriktor');
  }, 600_000);

  it('GORICA: several hypotheses, one a linear combination, against the unconstrained hypothesis', async () => {
    const c = call(await load('lavaan', 'PoliticalDemocracy'), GS);
    const r = await hypothesesR(c, req({ text: 'a1 > a2; b1 > b2; c1 > c2\na1 = a2 & b1 = b2\n2*a1 - a2 > 1.5', comparison: 'unconstrained' }));
    sameGorica(r.gorica, REF.several);
    REF.several.ratio.forEach((row: number[], i: number) => row.forEach((v, j) => rel(`ratio ${i} ${j}`, r.gorica!.ratio[i][j], v, 1e-5)));
  }, 600_000);

  it('bain: unstandardised paths, fraction 2; both methods in one run', async () => {
    const c = call(await load('bain', 'sesamesim'), SESAME);
    const r = await hypothesesR(c, req({ text: 'b_B > b_peabody > b_age\nb_B > 0 & b_peabody = 0', method: 'both', comparison: 'unconstrained', fraction: 2 }));
    sameBain(r.bain, REF.bainUnstd);
    expect(r.gorica!.models).toEqual(['H1', 'H2', 'unconstrained']);
    expect(r.bain!.fraction).toBe(2);
  }, 600_000);

  it('exports the script it runs, and refuses hypotheses outside the grammar in R', async () => {
    const c = call(await load('bain', 'sesamesim'), SESAME);
    const script = await hypothesesScriptR(c, req({ text: 'b_B > b_peabody = 0', method: 'both', comparison: 'unconstrained', standardized: true }));
    expect(script).toContain('goric(fit, hypotheses = hypotheses, comparison = "unconstrained", type = "gorica", standardized = TRUE)');
    expect(script).toContain('bain(fit, "b_B > b_peabody & b_peabody = 0", fraction = 1, standardize = TRUE)');
    expect(script).toContain('set.seed(100)');
    const base = cbRequest(c.data, c.spec, c.missing, c.estimator, c.interaction);
    for (const bad of ['b_B > 0"); system("id', 'b_B > exp(1)', 'b_B > 0 > 1', 'b_B >= 0', 'abs(b_B, 1) > 0']) {
      const e = await rCall('ps_cb_hypotheses', { ...base, hyp: { hypotheses: [{ constraints: [bad] }], method: 'gorica', comparison: 'complement', standardized: false, fraction: 1, seed: 1 } }, 'restriktor').catch((x) => x);
      expect(rMessage(e), bad).toMatch(/Invalid hypothesis in the request/);
    }
    // a label that is not a free parameter of the model: R says which
    const e = await hypothesesR(c, req({ text: 'b_B > zz' })).catch((x) => x);
    expect(rMessage(e)).toMatch(/Not free labelled parameters of the model: zz/);
  }, 600_000);
});
