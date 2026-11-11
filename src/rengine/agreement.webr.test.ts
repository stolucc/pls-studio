// The reliability card's measurement-error and agreement statistics (R/tests.R, R/agreement.R)
// against direct calls to psych, irr and irrCAC on the same data
// (scripts/validation/agreement.R). Run natively with WEBR_TESTS=1 PS_NATIVE_R=1.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { near } from '../validation/record';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';
import { reliabilityR } from './tests';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Frame = { names: string[]; cols: number[][]; categories: Record<string, string[]> };
const ref = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'agreement', 'reference.json'),
    'utf8',
  ),
) as Record<string, any>;

/** A reference frame as a dataset (missing values come as null in JSON). */
const data = (f: Frame): Dataset => ({
  names: f.names,
  cols: f.cols.map((c) => Float64Array.from(c, (x) => (x === null ? NaN : x))),
  ...(Object.keys(f.categories ?? {}).length ? { categories: f.categories } : {}),
});

// Closed forms: the same package calls on the same data. 1e-6 relative allows for webR's
// WebAssembly floating point (desktop R agrees to the last digit).
const close = (what: string, a: number | null | undefined, b: number) =>
  near(what, a ?? NaN, b, 1e-6 * Math.max(1, Math.abs(b)));

describe('standard error of measurement', () => {
  it('scale reliability: SD of the scale score × √(1 − α, ω, glb)', async () => {
    const r = await reliabilityR(data(ref.neuroticism), {
      type: 'scale',
      vars: ['N1', 'N2', 'N3', 'N4', 'N5'],
      confidence: 0.95,
    });
    close('SD of the scale score', r.scoreSd, ref.scaleSem.scoreSd);
    close('SEM (α)', r.sem?.alpha, ref.scaleSem.alpha);
    close('SEM (ω)', r.sem?.omega, ref.scaleSem.omega);
    close('SEM (glb)', r.sem?.glb, ref.scaleSem.glb);
  }, 600_000);

  it('intraclass correlations: SD × √(1 − ICC) for single and k raters', async () => {
    const r = await reliabilityR(data(ref.shroutFleiss), {
      type: 'icc',
      vars: ['j1', 'j2', 'j3', 'j4'],
      confidence: 0.95,
    });
    (ref.iccSem.sem as number[]).forEach((x, i) => {
      close(`SEM (${ref.iccSem.type[i]})`, r.icc![i].sem, x);
    });
  }, 600_000);
});

describe('agreement of several raters (irr)', () => {
  it('Fleiss’ kappa of irr’s diagnoses: the raters’ categories compared by label', async () => {
    const r = await reliabilityR(data(ref.diagnoses), {
      type: 'fleiss',
      vars: ['rater1', 'rater2', 'rater3', 'rater4', 'rater5', 'rater6'],
      confidence: 0.95,
    });
    const f = ref.fleiss;
    near('subjects', r.n, 30, 0);
    near('raters', r.raters!, 6, 0);
    close('Fleiss’ κ', r.fleiss!.kappa, f.kappa);
    close('z', r.fleiss!.z, f.z);
    close('Conger’s exact κ', r.fleiss!.exact, f.exact);
    (f.categoryKappa as number[]).forEach((k, i) => {
      const x = r.fleissCategories![i];
      if (x.category !== f.categories[i]) throw new Error(`category ${i}: ${x.category}`);
      close(`κ of ${x.category}`, x.kappa, k);
      close(`z of ${x.category}`, x.z, f.categoryZ[i]);
      // irr prints the categories' kappas to three decimals
      near(`κ of ${x.category} (irr, 3 decimals)`, x.kappa, f.categoryKappa3[i], 5e-4);
    });
  }, 600_000);

  it('Krippendorff’s alpha at each level of measurement, missing ratings kept', async () => {
    const d = data(ref.krippendorff);
    const vars = ['coder1', 'coder2', 'coder3', 'coder4'];
    for (const level of ['nominal', 'ordinal', 'interval', 'ratio'] as const) {
      const r = await reliabilityR(d, {
        type: 'kripp',
        vars,
        confidence: 0.95,
        krippLevel: level,
        bootstrap: 0,
      });
      close(`α (${level})`, r.kripp!.alpha, ref.kripp[level]);
      near(`units (${level})`, r.n, 12, 0);
      near(`pairable values (${level})`, r.kripp!.pairable, ref.krippPairable, 0);
    }
  }, 600_000);

  it('Krippendorff’s alpha: the bootstrap interval over the units, seeded', async () => {
    const b = ref.krippBoot;
    const r = await reliabilityR(data(ref.krippendorff), {
      type: 'kripp',
      vars: ['coder1', 'coder2', 'coder3', 'coder4'],
      confidence: 0.95,
      krippLevel: 'ordinal',
      bootstrap: b.samples,
      seed: b.seed,
    });
    // The same draws (same seed and order of sampling): equal up to floating point.
    close('bootstrap CI lower', r.kripp!.ciLow, b.ci[0]);
    close('bootstrap CI upper', r.kripp!.ciHigh, b.ci[1]);
    close('share below .667', r.kripp!.below667, b.below667);
    close('share below .800', r.kripp!.below800, b.below800);
  }, 600_000);

  it('Kendall’s W of irr’s anxiety, without and with the correction for ties', async () => {
    const r = await reliabilityR(data(ref.anxiety), {
      type: 'kendallw',
      vars: ['rater1', 'rater2', 'rater3'],
      confidence: 0.95,
    });
    const k = ref.kendall;
    const [plain, tied] = r.kendall!;
    close('W', plain.w, k.w);
    close('χ²', plain.chisq, k.chisq);
    close('p', plain.p, k.p);
    close('W corrected for ties', tied.w, k.wt);
    close('χ² corrected for ties', tied.chisq, k.chisqT);
    close('p corrected for ties', tied.p, k.pT);
    near('df', plain.df, 19, 0);
  }, 600_000);
});

describe('Gwet’s AC1 and AC2 (irrCAC)', () => {
  it('cac.raw4raters: AC1 unweighted and AC2 with quadratic weights, missing ratings kept', async () => {
    const d = data(ref.cacRaw4raters);
    for (const weights of ['unweighted', 'quadratic'] as const) {
      const g = ref.gwet[weights];
      const r = await reliabilityR(d, {
        type: 'gwet',
        vars: ['Rater1', 'Rater2', 'Rater3', 'Rater4'],
        confidence: 0.95,
        ...(weights === 'quadratic' ? { gwetWeights: weights } : {}),
      });
      const x = r.gwet!;
      if (x.name !== g.name) throw new Error(`${weights}: ${x.name}`);
      near(`subjects (${weights})`, r.n, 12, 0);
      near(`ratings (${weights})`, x.ratings, g.ratings, 0);
      close(`agreement (${weights})`, x.pa, g.pa);
      close(`chance agreement (${weights})`, x.pe, g.pe);
      close(`${g.name}`, x.value, g.value);
      // irrCAC rounds the coefficient and its standard error to 5 decimals, the interval to 3.
      near(`${g.name} (irrCAC, 5 decimals)`, x.value, g.value5, 5e-6);
      close(`${g.name} SE`, x.se, g.se);
      close(`${g.name} p`, x.p, g.p);
      near(`${g.name} CI lower (irrCAC, 3 decimals)`, x.ciLow, g.ci3[0], 5e-4);
      near(`${g.name} CI upper (irrCAC, 3 decimals)`, x.ciHigh, g.ci3[1], 5e-4);
    }
  }, 600_000);
});
