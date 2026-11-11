// The Kline (2023) examples under lavaan in webR against native lavaan on the same
// matrices (scripts/validation/kline.R) and the chi-squares of Kline's output.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { estimateCbLavaan } from '../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { against, example } from '../validation/record';
import { builtinDefinition, sameEstimates, sameFit } from '../validation/textbook';
import {
  makeKabcExample,
  makeLynamExample,
  makeRobbinsExample,
  makeRomneyExample,
  makeRothExample,
  makeSabatelliExample,
  makeSauveExample,
  makeWorlandExample,
} from './kline';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Est = {
  lhs: string;
  op: string;
  rhs: string;
  group: number;
  est: number;
  se: number | null;
  std: number | null;
};
type Ref = Record<
  string,
  {
    chisq: number;
    df: number;
    pvalue: number;
    cfi: number;
    rmsea: number;
    srmr: number;
    estimates: Est[];
    kline: { chisq: number; df: number };
  }
>;
const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'kline.json'), 'utf8'),
) as Ref;
/** Construct names the app gives differently from the reference script. */
const RENAMED: Record<string, Record<string, string>> = {
  sabatelli: { Marital: 'Marital adjustment', FOE: 'Family of origin' },
};
const CASES = {
  roth: makeRothExample,
  kabc: makeKabcExample,
  sabatelli: makeSabatelliExample,
  worland: makeWorlandExample,
  romneySomatic: (s: typeof DEFAULT_SETTINGS) => makeRomneyExample(s, 'somatic'),
  romneyMedical: (s: typeof DEFAULT_SETTINGS) => makeRomneyExample(s, 'medical'),
  lynam: makeLynamExample,
  robbins: makeRobbinsExample,
  sauve: makeSauveExample,
};

/** The examples' ids (src/io.ts). */
const ID: Record<keyof typeof CASES, string> = {
  roth: 'kline-roth',
  kabc: 'kline-kabc',
  sabatelli: 'kline-sabatelli',
  worland: 'kline-worland',
  romneySomatic: 'kline-romney-somatic',
  romneyMedical: 'kline-romney-medical',
  lynam: 'kline-lynam',
  robbins: 'kline-robbins',
  sauve: 'kline-sauve',
};

it.each(Object.keys(CASES))(
  '%s reproduces native lavaan and the chi-square of Kline’s output',
  async (key) => {
    const ex = CASES[key as keyof typeof CASES](DEFAULT_SETTINGS);
    example(ID[key as keyof typeof CASES], {
      title: key,
      method: 'CB-SEM',
      packages: ['lavaan'],
      definition: builtinDefinition(ex),
    });
    const r = await estimateCbLavaan(ex.data, toSpec(ex.model), 'casewise', 'ML', 'product');
    const want = ref[key];
    expect(r.converged, key).toBe(true);
    against({
      label:
        'Kline (2023), Principles and Practice of Structural Equation Modeling, 5th ed.: the chi-square of the book’s output',
      level: 'published',
    });
    expect(r.fit.chisq, 'χ² (Kline)').toBeCloseTo(want.kline.chisq, 2);
    against({
      label: 'desktop lavaan on the same matrices, scripts/validation/kline.R',
      script: 'scripts/validation/kline.R',
      level: 'native',
    });
    sameFit(r.fit, want);
    // Every loading, path, covariance, intercept and defined parameter, by group.
    sameEstimates(r.groups ? r.groups.results : [r], want.estimates, (x) => RENAMED[key]?.[x] ?? x);
    if (key === 'sabatelli')
      expect(r.warnings.join(' ')).toMatch(/negative/i); // the Heywood case
    else expect(r.warnings, key).toEqual([]);
  },
  600_000,
);
