// The loading triage's re-estimation through the R packages (the Model tab's R path: the
// app's request to cSEM or seminr, the model without one indicator) against plain seminr and
// cSEM calls on the model written out by hand without that indicator
// (scripts/validation/loading_triage.R, desktop R, seminr 2.6.0, cSEM 0.7.1): mobi (ECSI) and
// the corporate reputation model of Hair et al. (2021). Run with
// WEBR_TESTS=1 PS_NATIVE_R=1 npx vitest run --dir src src/measurement/loadingTriage.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toSpec } from '../model/project';
import { estimatePlsR, type PlsPackage } from '../rengine/pls';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { near } from '../validation/record';
import {
  corpRep,
  fixture,
  mobi,
  REFERENCE_OPTIONS,
  type TriageFixture,
  type TriageFixtureRun,
} from './__fixtures__/data';
import { triageItems } from './loadings';
import { reestimateRemovals, type Estimator } from './reestimate';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = fixture<TriageFixture>('loading_triage.json');
// Same package and tolerance as the reference: desktop R agrees to about 1e-10; webR's floating
// point differs from desktop R's by up to about 1e-6 relative after the PLS iterations.
const TOL = 1e-6;

function compare(
  pkg: PlsPackage,
  run: TriageFixtureRun,
  construct: string,
  got: { ave: number; rhoA: number; rhoC: number } | null,
) {
  expect(got, `${pkg} ${construct}`).not.toBeNull();
  const what = `${pkg}, ${run.removed || 'full model'}: ${construct}`;
  if (pkg === 'seminr') {
    const s = run.seminr[construct];
    near(`${what} AVE`, got!.ave, s.ave, TOL);
    near(`${what} ρC`, got!.rhoC, s.rhoC, TOL);
    near(`${what} ρA`, got!.rhoA, s.rhoA, TOL);
  } else {
    // cSEM's own AVE and ρC (assess); the app computes ρA by hand for cSEM (no disattenuation).
    const c = run.cSEM[construct];
    near(`${what} AVE`, got!.ave, c.ave!, TOL);
    near(`${what} ρC`, got!.rhoC, c.rhoC!, TOL);
  }
}

describe.each(['seminr', 'cSEM'] as const)('loading triage through %s', (pkg) => {
  it.each([
    ['mobi (ECSI)', mobi, ref.mobi],
    ['corporate reputation (Hair et al. 2021)', corpRep, ref.corprep],
  ] as const)(
    '%s: the construct re-estimated without each indicator equals a direct run',
    async (_name, load, runs) => {
      const { data, model } = load();
      const estimate: Estimator = (spec) => estimatePlsR(data, spec, REFERENCE_OPTIONS, pkg);
      const full = await estimate(toSpec(model));
      const items = triageItems(model, full);
      for (const item of items.filter(
        (x, i, all) => all.findIndex((y) => y.construct === x.construct) === i,
      ))
        compare(pkg, runs[0], item.construct, item.before);
      const chosen = runs.slice(1).map((r) => items.find((x) => x.indicator === r.removed)!);
      const done = await reestimateRemovals(model, chosen, estimate);
      done.forEach((r, i) => {
        expect(r.error, r.indicator).toBeUndefined();
        compare(pkg, runs[i + 1], chosen[i].construct, r.after);
      });
    },
    600_000,
  );
});
