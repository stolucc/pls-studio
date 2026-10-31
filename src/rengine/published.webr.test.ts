// Published results: values printed in sources independent of this code and of
// its fixture pipeline, reproduced by the app's engines on the same data. The
// fixtures in src/engine/__fixtures__ come from native R runs by the same
// author; these numbers were printed by other people with other software.
//
//   Hair, Hult, Ringle, Sarstedt, Danks & Ray (2021), Partial Least Squares
//   Structural Equation Modeling (PLS-SEM) Using R (Springer, open access,
//   doi:10.1007/978-3-030-80519-7): the corporate reputation models on
//   corp_rep_data (N = 344, -99 missing, mean replacement), chapters 4 and 6.
//   The same models and data are the SmartPLS case study of the authors'
//   Primer on PLS-SEM.
//
//   Monecke & Leisch (2012), semPLS: Structural Equation Modeling Using Partial
//   Least Squares, Journal of Statistical Software 48(3), pp. 16-17
//   (doi:10.18637/jss.v048.i03): the ECSI model on mobi (N = 250), Mode A,
//   centroid scheme, path coefficients and loadings. (Tenenhaus et al. 2005,
//   Fig. 2, fitted the same model to unstandardised indicators, which the app
//   does not do; plspm with scaled = FALSE reproduces that figure.)
//
// Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { estimatePls } from '../engine/pls';
import type { Dataset, ModelSpec, PlsOptions, PlsResult } from '../engine/types';
import { exampleModel, PACKAGE_EXAMPLES } from '../examples/packages';
import { toSpec } from '../model/project';
import { rCall } from './bridge';
import { estimatePlsR, type PlsPackage } from './pls';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

async function load(pkg: 'seminr', name: string, na: number[] = []): Promise<Dataset> {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: pkg, name, na }, pkg);
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
}

type Engine = PlsPackage | 'built-in';
const ENGINES: Engine[] = ['seminr', 'cSEM', 'built-in'];
async function estimate(engine: Engine, data: Dataset, spec: ModelSpec, options: PlsOptions): Promise<PlsResult> {
  return engine === 'built-in' ? estimatePls(data, spec, options) : estimatePlsR(data, spec, options, engine);
}
const options = (scheme: PlsOptions['scheme']): PlsOptions => ({ scheme, consistent: false, missing: 'mean', tolerance: 1e-9, maxIter: 1000 });

/** Printed to three decimals: the estimate must round to the printed value. */
const printed = (actual: number | null | undefined, expected: number, what: string) => expect(actual, what).toBeCloseTo(expected, 3);

function checks(r: PlsResult) {
  const at = (n: string) => { const i = r.constructs.indexOf(n); if (i < 0) throw new Error(`no construct ${n}`); return i; };
  const ind = (n: string) => { const i = r.indicators.findIndex((x) => x.name === n); if (i < 0) throw new Error(`no indicator ${n}`); return i; };
  return {
    at,
    paths: (p: Record<string, number>) => { for (const [k, b] of Object.entries(p)) { const [f, t] = k.split(' -> '); printed(r.pathCoef[at(f)][at(t)], b, k); } },
    r2: (p: Record<string, number>) => { for (const [k, v] of Object.entries(p)) printed(r.rSquared[at(k)], v, `R² ${k}`); },
    total: (p: Record<string, number>) => { for (const [k, b] of Object.entries(p)) { const [f, t] = k.split(' -> '); printed(r.totalEffects[at(f)][at(t)], b, `total ${k}`); } },
    fSquare: (p: Record<string, number>) => { for (const [k, b] of Object.entries(p)) { const [f, t] = k.split(' -> '); printed(r.fSquare[at(f)][at(t)], b, `f² ${k}`); } },
    loadings: (p: Record<string, number>) => { for (const [k, v] of Object.entries(p)) printed(r.loadings[ind(k)], v, `loading ${k}`); },
    quality: (p: Record<string, { alpha: number; rhoA: number; rhoC: number; sqrtAve: number }>) => {
      for (const [k, q] of Object.entries(p)) {
        const got = r.quality[at(k)];
        printed(got.alpha, q.alpha, `α ${k}`); printed(got.rhoA, q.rhoA, `ρA ${k}`); printed(got.rhoC, q.rhoC, `ρC ${k}`); printed(Math.sqrt(got.ave), q.sqrtAve, `√AVE ${k}`);
      }
    },
    cor: (p: Record<string, number>) => { for (const [k, v] of Object.entries(p)) { const [a, b] = k.split(' ~ '); printed(r.constructCor[at(a)][at(b)], v, `cor ${k}`); } },
  };
}

describe('Hair et al. (2021), PLS-SEM Using R: corporate reputation', () => {
  let data: Dataset;
  beforeAll(async () => { data = await load('seminr', 'corp_rep_data', [-99]); });

  // Chapter 3-4: the simple model (Fig. 3.2), reflective COMP, LIKE and CUSL, single-item CUSA.
  const simple: ModelSpec = {
    constructs: [
      { name: 'COMP', mode: 'A', indicators: ['comp_1', 'comp_2', 'comp_3'] }, { name: 'LIKE', mode: 'A', indicators: ['like_1', 'like_2', 'like_3'] },
      { name: 'CUSA', mode: 'A', indicators: ['cusa'] }, { name: 'CUSL', mode: 'A', indicators: ['cusl_1', 'cusl_2', 'cusl_3'] },
    ],
    paths: [{ from: 'COMP', to: 'CUSA' }, { from: 'COMP', to: 'CUSL' }, { from: 'LIKE', to: 'CUSA' }, { from: 'LIKE', to: 'CUSL' }, { from: 'CUSA', to: 'CUSL' }],
  };

  describe.each(ENGINES)('simple model, %s', (engine) => {
    it('reproduces the reliability, validity and loading values of chapter 4', async () => {
      const r = await estimate(engine, data, simple, options('path'));
      expect(r.n).toBe(344);
      const c = checks(r);
      // Section 4.6, Fig. 4.5: "rhoA values of 0.832 (COMP), 0.839 (CUSL), and 0.836 (LIKE) ... Cronbach's alpha (0.776 for COMP,
      // 0.831 for CUSL, and 0.831 for LIKE) and the composite reliability rhoc (0.865 for COMP, 0.899 for CUSL, and 0.899 for LIKE)";
      // Fig. 4.7: "the square roots of the AVEs ... COMP (0.825), CUSL (0.865), and LIKE (0.864)".
      c.quality({ COMP: { alpha: 0.776, rhoA: 0.832, rhoC: 0.865, sqrtAve: 0.825 }, CUSL: { alpha: 0.831, rhoA: 0.839, rhoC: 0.899, sqrtAve: 0.865 }, LIKE: { alpha: 0.831, rhoA: 0.836, rhoC: 0.899, sqrtAve: 0.864 } });
      // Fig. 4.7: COMP's correlations "0.645, 0.436, and 0.450" with LIKE, CUSA and CUSL.
      c.cor({ 'COMP ~ LIKE': 0.645, 'COMP ~ CUSA': 0.436, 'COMP ~ CUSL': 0.450 });
      // Section 4.6: "comp_2 (loading, 0.798) ... cusl_2 (loading, 0.917)".
      c.loadings({ comp_2: 0.798, cusl_2: 0.917 });
    }, 600_000);
  });

  // Chapters 5-6: the extended model (Fig. 5.3), the app's "Corporate reputation (PLS-SEM primer)" example.
  describe.each(ENGINES)('extended model, %s', (engine) => {
    it('reproduces the path coefficients, R², total effects and f² of chapter 6', async () => {
      const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'seminr-corprep')!;
      const spec = toSpec(exampleModel(ex));
      expect(spec.constructs.filter((k) => k.mode === 'B').map((k) => k.name)).toEqual(['QUAL', 'PERF', 'CSOR', 'ATTR']);
      const r = await estimate(engine, data, spec, options('path'));
      expect(r.n).toBe(344);
      const c = checks(r);
      // Section 6.6, Fig. 6.5 (original estimates named in the text) and section 7.6 (COMP -> CUSL 0.006, LIKE -> CUSL 0.344).
      c.paths({ 'QUAL -> COMP': 0.430, 'QUAL -> LIKE': 0.380, 'CSOR -> COMP': 0.059, 'CSOR -> LIKE': 0.178, 'LIKE -> CUSA': 0.436, 'LIKE -> CUSL': 0.344, 'CUSA -> CUSL': 0.505, 'COMP -> CUSL': 0.006 });
      // Fig. 6.7: "The R2 values of COMP (0.631), CUSL (0.562), and LIKE (0.558) ... CUSA (0.292)".
      c.r2({ COMP: 0.631, CUSL: 0.562, LIKE: 0.558, CUSA: 0.292 });
      // Fig. 6.6: "QUAL has the strongest total effect on CUSL (0.248), followed by CSOR (0.105), ATTR (0.101), and PERF (0.089)".
      c.total({ 'QUAL -> CUSL': 0.248, 'CSOR -> CUSL': 0.105, 'ATTR -> CUSL': 0.101, 'PERF -> CUSL': 0.089 });
      // Fig. 6.8: "LIKE has a medium effect size of 0.159 on CUSA and of 0.138 on CUSL ... COMP has no effect on CUSA (0.018) or CUSL (0.000)".
      c.fSquare({ 'LIKE -> CUSA': 0.159, 'LIKE -> CUSL': 0.138, 'COMP -> CUSA': 0.018, 'COMP -> CUSL': 0.000 });
    }, 600_000);
  });
});

describe('Monecke & Leisch (2012), semPLS: ECSI on mobi', () => {
  // The app's "Mobile phone satisfaction (ECSI)" example (seminr's Mode A model), with the paper's centroid scheme.
  // seminr offers only the path and factorial schemes, so it is not run here.
  describe.each(ENGINES.filter((e) => e !== 'seminr'))('%s', (engine) => {
    it('reproduces the printed path coefficients and loadings (pp. 16-17)', async () => {
      const data = await load('seminr', 'mobi');
      const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'seminr-mobi')!;
      const spec = toSpec(exampleModel(ex));
      const r = await estimate(engine, data, spec, options('centroid'));
      expect(r.n).toBe(250);
      const c = checks(r);
      c.paths({
        'Image -> Expectation': 0.505, 'Expectation -> Quality': 0.557, 'Expectation -> Value': 0.051, 'Quality -> Value': 0.557,
        'Image -> Satisfaction': 0.179, 'Expectation -> Satisfaction': 0.064, 'Quality -> Satisfaction': 0.513, 'Value -> Satisfaction': 0.192,
        'Satisfaction -> Complaints': 0.526, 'Image -> Loyalty': 0.195, 'Satisfaction -> Loyalty': 0.483, 'Complaints -> Loyalty': 0.071,
      });
      c.loadings({
        IMAG1: 0.743, IMAG2: 0.601, IMAG3: 0.578, IMAG4: 0.768, IMAG5: 0.744, CUEX1: 0.771, CUEX2: 0.687, CUEX3: 0.612,
        PERQ1: 0.803, PERQ2: 0.637, PERQ3: 0.784, PERQ4: 0.769, PERQ5: 0.756, PERQ6: 0.775, PERQ7: 0.779, PERV1: 0.904, PERV2: 0.938,
        CUSA1: 0.799, CUSA2: 0.846, CUSA3: 0.852, CUSCO: 1.000, CUSL1: 0.814, CUSL2: 0.219, CUSL3: 0.917,
      });
    }, 600_000);
  });
});
