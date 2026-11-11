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
