// The cross-lagged panel card's two between-person parts on one dataset (cards/model.ts: nls-riclpm, nls-lcmsr): the
// RI-CLPM and the latent curve model with structured residuals (LCM-SR; Curran, Howard, Bainter, Lane & McGinley 2014)
// on the National Longitudinal Survey of Young Women, 1969–1977, each run through its card as the app opens it and
// compared with desktop lavaan, and the LCM-SR's log-likelihood with an OpenMx RAM model written independently
// (scripts/validation/lcmsr.R → src/engine/__fixtures__/lcmsr/reference.json). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { RiclpmResult } from '../../rengine/longitudinal';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near, same } from '../../validation/record';
import { open } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type RefEstimate = { lhs: string; op: string; rhs: string; est: number; se: number | null };
type RefFit = { fit: Record<string, number>; estimates: RefEstimate[] };
const REF = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', 'engine', '__fixtures__', 'lcmsr', 'reference.json'),
    'utf8',
  ),
) as Record<string, RefFit> & {
  n: number;
  lavaan: string;
  OpenMx: string;
  openmxLcmsrEqual: { logl: number; lagged: Record<'a' | 'b' | 'c' | 'd', number> };
};

/** Every estimate of the reference with a standard error, its estimate and standard error in the card's result. */
function compareEstimates(r: RiclpmResult, ref: RefFit) {
  for (const e of ref.estimates.filter((x) => x.se)) {
    const m = r.estimates.find((x) => x.lhs === e.lhs && x.op === e.op && x.rhs === e.rhs);
    expect(m, `${e.lhs} ${e.op} ${e.rhs}`).toBeTruthy();
    near(`${e.lhs} ${e.op} ${e.rhs}`, m!.est, e.est, 1e-4);
    near(`SE of ${e.lhs} ${e.op} ${e.rhs}`, m!.se!, e.se!, 1e-4);
  }
}
const lagged = (r: RiclpmResult, lhs: string, rhs: string) =>
  r.estimates.find((e) => e.op === '~' && e.lhs === lhs && e.rhs === rhs)!;

it('nls-riclpm: the RI-CLPM on the NLS Young Women, equal lagged effects', async () => {
  const { run } = await open('nls-riclpm', 'Longitudinal', ['lavaan']);
  const r = await run<RiclpmResult>();
  against({
    label: `scripts/validation/lcmsr.R: the RI-CLPM in desktop lavaan ${REF.lavaan}`,
    level: 'native',
  });
  same('women', r.n, REF.n);
  same('between-person part', r.between, 'intercepts');
  near('χ²', r.fit.chisq!, REF.riclpmEqual.fit.chisq, 0.001);
  same('df', r.fit.df!, REF.riclpmEqual.fit.df);
  compareEstimates(r, REF.riclpmEqual);
  // (hours predict later wages here: z above 4)
  const hw = lagged(r, 'wx2', 'wy1');
  expect(hw.est / hw.se!).toBeGreaterThan(4);
}, 600_000);

it('nls-lcmsr: the LCM-SR on the same data, against the RI-CLPM, lavaan and OpenMx', async () => {
  const { run } = await open('nls-lcmsr', 'Longitudinal', ['lavaan']);
  const r = await run<RiclpmResult>();
  against({
    label: `scripts/validation/lcmsr.R: the LCM-SR in desktop lavaan ${REF.lavaan}`,
    level: 'native',
    url: 'https://doi.org/10.1037/a0035297',
  });
  same('between-person part', r.between, 'growth');
  near('χ²', r.fit.chisq!, REF.lcmsrEqual.fit.chisq, 0.001);
  same('df', r.fit.df!, REF.lcmsrEqual.fit.df);
  compareEstimates(r, REF.lcmsrEqual);
  near('RI-CLPM χ² (the comparison)', r.riclpmFit!.chisq!, REF.riclpmEqual.fit.chisq, 0.001);
  against({
    label: `scripts/validation/lcmsr.R: the LCM-SR as an OpenMx ${REF.OpenMx} RAM model, written independently`,
    level: 'native',
  });
  near('log-likelihood', r.fit.logl!, REF.openmxLcmsrEqual.logl, 0.001);
  near('wage → wage', lagged(r, 'wx2', 'wx1').est, REF.openmxLcmsrEqual.lagged.a, 1e-4);
  near('hours → wage', lagged(r, 'wx2', 'wy1').est, REF.openmxLcmsrEqual.lagged.b, 1e-4);
  near('wage → hours', lagged(r, 'wy2', 'wx1').est, REF.openmxLcmsrEqual.lagged.c, 1e-4);
  near('hours → hours', lagged(r, 'wy2', 'wy1').est, REF.openmxLcmsrEqual.lagged.d, 1e-4);
  // (the point of the pair: with growth separated out, hours no longer predict later wages, and both criteria favour it)
  const hw = lagged(r, 'wx2', 'wy1');
  expect(Math.abs(hw.est / hw.se!)).toBeLessThan(1.96);
  expect(r.fit.aic!).toBeLessThan(r.riclpmFit!.aic!);
  expect(r.fit.bic!).toBeLessThan(r.riclpmFit!.bic!);
}, 600_000);
