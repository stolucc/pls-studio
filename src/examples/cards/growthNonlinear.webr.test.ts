// Nonlinear growth on the growth card (cards/model.ts: nls-growth-exponential, nls-growth-quadratic): an exponential
// structured latent curve written as lavaan syntax with nonlinear constraints on the loadings (Browne 1993; Preacher
// & Hancock 2015), and the card's quadratic shape, on the NLS Young Women's log wage 1968–1988, each run as the app
// opens it and compared with desktop lavaan (scripts/validation/growthNonlinear.R →
// src/engine/__fixtures__/growthNonlinear). Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { GrowthResult } from '../../rengine/longitudinal';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { against, near, same } from '../../validation/record';
import { exampleOf, open } from './modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', '..', 'engine', '__fixtures__', 'growthNonlinear');
type Est = { est: number; se: number };
type Fit = { chisq: number; df: number; cfi: number; bic: number };
const REF = JSON.parse(readFileSync(join(DIR, 'reference.json'), 'utf8')) as {
  n: number;
  exponential: { fit: Fit; r: Est; iMean: Est; sMean: Est; sVar: Est; l5: Est };
  quadratic: { fit: Fit; sMean: Est; qMean: Est };
};
const DESKTOP = {
  label: 'scripts/validation/growthNonlinear.R: growth(…, missing = "ml") in desktop lavaan 0.7-3',
  level: 'native' as const,
};
const find = (r: GrowthResult, lhs: string, op: string, rhs = '') =>
  r.estimates.find((e) => e.lhs === lhs && e.op === op && e.rhs === rhs)!;

it('nls-growth-exponential: the exponential latent curve with nonlinear loading constraints', async () => {
  const panel = exampleOf('nls-growth-exponential').panel as { syntax: string };
  same(
    'the syntax recorded in desktop R',
    panel.syntax,
    readFileSync(join(DIR, 'exponential.lav'), 'utf8').trim(),
  );
  const { run } = await open('nls-growth-exponential', 'Longitudinal', ['lavaan']);
  const r = await run<GrowthResult>();
  against(DESKTOP);
  same('women', r.n, REF.n);
  // (an optimiser with nonlinear constraints: ~1e-5 relative between webR and desktop R)
  near('χ²', r.fit.chisq!, REF.exponential.fit.chisq, 1e-5 * REF.exponential.fit.chisq);
  same('df', r.fit.df!, REF.exponential.fit.df);
  const rate = r.estimates.find((e) => e.op === ':=' && e.lhs === 'r')!;
  near('r, the share of each five years’ gain carried on', rate.est, REF.exponential.r.est, 1e-5);
  near('SE of r', rate.se!, REF.exponential.r.se, 1e-5);
  near('mean starting level', find(r, 'i', '~1').est, REF.exponential.iMean.est, 1e-5);
  near('mean gain 1968–1973', find(r, 's', '~1').est, REF.exponential.sMean.est, 1e-5);
  near(
    'variance of the first-year gain',
    find(r, 's', '~~', 's').est,
    REF.exponential.sVar.est,
    1e-6,
  );
  near('loading of 1988', find(r, 's', '=~', 'lnwage88').est, REF.exponential.l5.est, 1e-4);
  // (the 1988 loading obeys its constraint: (1 − r⁴) / (1 − r), four five-year steps)
  near(
    '1988 loading = (1 − r⁴) / (1 − r)',
    find(r, 's', '=~', 'lnwage88').est,
    (1 - rate.est ** 4) / (1 - rate.est),
    1e-6,
  );
}, 600_000);

it('nls-growth-quadratic: the card’s quadratic shape, time in decades', async () => {
  const { run } = await open('nls-growth-quadratic', 'Longitudinal', ['lavaan']);
  const r = await run<GrowthResult>();
  against(DESKTOP);
  near('χ²', r.fit.chisq!, REF.quadratic.fit.chisq, 1e-3);
  same('df', r.fit.df!, REF.quadratic.fit.df);
  near('mean linear slope', find(r, 's', '~1').est, REF.quadratic.sMean.est, 1e-5);
  near('mean quadratic term', find(r, 'q', '~1').est, REF.quadratic.qMean.est, 1e-5);
  expect(r.fit.chisq!).toBeLessThan(REF.exponential.fit.chisq);
}, 600_000);
