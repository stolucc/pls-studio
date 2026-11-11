// The GLMM card's negative binomial and zero-inflated negative binomial families against GLMMadaptive run natively
// (scripts/validation/glmm.R) on its vignette's simulated data: fixed effects, the zero part, the random-intercept
// variance, the dispersion and the log-likelihood. (Poisson, ZIP and binomial: examples mplus-ex6.6, ex6.7, glmmadaptive-cbpp.)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { glmmR, type GlmmFamily, type GlmmInput } from './glmm';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const FX = join(__dirname, '..', 'engine', '__fixtures__', 'glmm');
const data = parseCsv(readFileSync(join(FX, 'zinb.csv'), 'utf8')).dataset;
type Coef = { term: string; est: number; se: number };
const ref = JSON.parse(readFileSync(join(FX, 'reference.json'), 'utf8')) as Record<
  'negbin' | 'zinb',
  { fixed: Coef[]; zero: Coef[] | null; D: number; logPhi: number; logLik: number; aic: number }
>;
/** GLMMadaptive's names as the card's. */
const term = (t: string) => (t === '(Intercept)' ? 'Intercept' : t);
const input = (family: GlmmFamily, outcome: string): GlmmInput => ({
  layout: 'long',
  outcome,
  cluster: 'id',
  occasions: [],
  times: [],
  predictors: ['female', 'time'],
  categorical: [],
  slopes: [],
  family,
  ziPredictors: family === 'zinb' ? ['female'] : [],
  ziRandom: false,
  quadrature: 11,
  robust: false,
});

describe('GLMM card (GLMMadaptive)', () => {
  it.each([
    ['negbin', 'negative binomial', 'nb'],
    ['zinb', 'zero-inflated negative binomial', 'y'],
  ] as const)(
    '%s: the %s model equals GLMMadaptive natively',
    async (family, _what, outcome) => {
      const r = await glmmR(data, input(family, outcome));
      const want = ref[family];
      expect(r.converged).toBe(true);
      expect([r.n, r.clusters]).toEqual([800, 100]);
      for (const w of want.fixed) {
        const mine = r.fixed.find((f) => f.term === term(w.term));
        expect(mine, `${w.term} (have ${r.fixed.map((f) => f.term).join(', ')})`).toBeTruthy();
        expect(mine!.est, w.term).toBeCloseTo(w.est, 5);
        expect(mine!.se, `SE of ${w.term}`).toBeCloseTo(w.se, 5);
      }
      if (want.zero)
        for (const w of want.zero) {
          const mine = r.zero?.find((f) => f.term === term(w.term));
          expect(mine, `zero part: ${w.term}`).toBeTruthy();
          expect(mine!.est, `zero part: ${w.term}`).toBeCloseTo(w.est, 5);
          expect(mine!.se, `zero part: SE of ${w.term}`).toBeCloseTo(w.se, 5);
        }
      else expect(r.zero ?? []).toEqual([]);
      expect(r.random[0].est, 'random-intercept variance').toBeCloseTo(want.D, 5);
      expect(r.logPhi!.est, 'log θ').toBeCloseTo(want.logPhi, 5);
      expect(r.logLik, 'log-likelihood').toBeCloseTo(want.logLik, 5);
      expect(r.aic, 'AIC').toBeCloseTo(want.aic, 4);
      expect(r.warnings, r.warnings.join(' | ')).toEqual([]);
    },
    900_000,
  );
});
