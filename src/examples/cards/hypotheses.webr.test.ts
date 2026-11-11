// The examples of cards/hypotheses.ts, each run through its card (the card's own run(), the rengine call the app makes)
// on the example's data, settings and diagram, against the package's own documented code run natively
// (scripts/validation/hypotheses.R → src/engine/__fixtures__/hypotheses.json): restriktor's tutorial SEM example and
// bain's vignette latent regression, both with set.seed(100). lavaan's estimates differ by ~1e-6 relative between webR
// and desktop R (WebAssembly floating point), so values derived from them are compared to 1e-5; the printed values of
// the documentation to their printed digits. Run with WEBR_TESTS=1.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Dataset } from '../../engine/types';
import { DEFAULT_SETTINGS } from '../../model/project';
import { analysisType } from '../../analyses/registry';
import type { AnalysisCtx } from '../../analyses/types';
import { rCall, type RPackage } from '../../rengine/bridge';
import type { HypResult } from '../../rengine/hypotheses';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { exampleModel, exampleSettings, PACKAGE_EXAMPLES, panelPreset } from '../packages';
import { against, example as exampleCheck, near, same } from '../../validation/record';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

/** 1e-5 relative to the size of the value (absolute below 1). */
const tol = (want: number) => 1e-5 * Math.max(1, Math.abs(want));
const REF = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'engine', '__fixtures__', 'hypotheses.json'), 'utf8'),
);

async function open(id: string, packages: string[]) {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  exampleCheck(id, { title: ex.title, method: 'CB-SEM', packages, definition: ex });
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>(
    'ps_dataset',
    { package: ex.data.package, name: ex.data.name, na: [] },
    ex.data.package as RPackage,
  );
  const data: Dataset = {
    names: raw.names,
    cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))),
  };
  const ctx: AnalysisCtx = {
    data,
    info: null,
    settings: exampleSettings(DEFAULT_SETTINGS, ex.settings),
    pls: null,
    projectName: ex.title,
    model: exampleModel(ex),
  };
  const t = analysisType(ex.panel!.kind)!;
  const options = t.parseOptions({ ...t.defaults(ctx), ...panelPreset(ex.panel!) })!;
  expect(t.blocked(options as never, ctx), `${id}: the card is ready to run`).toBeNull();
  return { options, run: () => t.run(options as never, ctx, () => {}) as Promise<HypResult> };
}

it('restriktor-poldem-gorica: the tutorial’s SEM example, abs(beta_dem65_dem60) > abs(beta_dem65_ind60) against its complement', async () => {
  const { run } = await open('restriktor-poldem-gorica', ['lavaan', 'restriktor']);
  const r = await run();
  against({
    label:
      'restriktor, vignette("Tutorial_GORICA_restriktor_lavaan"), SEM example: its code run natively (scripts/validation/hypotheses.R; the same values from semTools::goricaSEM and from goric() on the estimates and their covariance matrix)',
    level: 'native',
    url: 'https://cran.r-project.org/web/packages/restriktor/vignettes/Tutorial_GORICA_restriktor_lavaan.html',
  });
  const g = r.gorica!,
    ref = REF.tutorial;
  same('models', g.models.join(', '), 'H1, complement');
  near('log-likelihood (H1)', g.loglik[0], ref.loglik[0], tol(ref.loglik[0]));
  near('log-likelihood (complement)', g.loglik[1], ref.loglik[1], tol(ref.loglik[1]));
  near('penalty (H1)', g.penalty[0], ref.penalty[0], 1e-8);
  near('GORICA (H1)', g.gorica[0], ref.gorica[0], tol(ref.gorica[0]));
  near('GORICA (complement)', g.gorica[1], ref.gorica[1], tol(ref.gorica[1]));
  near('GORICA weight (H1)', g.weights[0], ref.weights[0], 1e-8);
  near('GORICA (H1), as the tutorial prints it', g.gorica[0], -5.697, 0.0005);
  for (const e of r.estimates)
    near(`standardised ${e.label}`, e.est!, REF.estimates[e.label], tol(REF.estimates[e.label]));
  same('standardised', String(r.standardized), 'true');
}, 600_000);

it('bain-sesame-latent: the vignette’s three hypotheses on the standardised latent regression', async () => {
  const { run } = await open('bain-sesame-latent', ['lavaan', 'bain']);
  const r = await run();
  against({
    label:
      'bain, vignette("Introduction_to_bain"), latent regression of sesamesim: its code run natively (scripts/validation/hypotheses.R)',
    level: 'native',
    url: 'https://cran.r-project.org/web/packages/bain/vignettes/Introduction_to_bain.html',
  });
  const b = r.bain!,
    ref = REF.bain;
  same('rows', b.rows.join(', '), ref.rows.join(', '));
  for (const i of [0, 1, 2]) {
    near(`fit (H${i + 1})`, b.fit[i]!, ref.fit[i], tol(ref.fit[i]));
    near(`complexity (H${i + 1})`, b.com[i]!, ref.com[i], tol(ref.com[i]));
    near(`BF vs unconstrained (H${i + 1})`, b.bfu[i]!, ref.bfu[i], tol(ref.bfu[i]));
    near(`BF vs complement (H${i + 1})`, b.bfc[i]!, ref.bfc[i], tol(ref.bfc[i]));
    near(`PMP a (H${i + 1})`, b.pmpa[i]!, ref.pmpa[i], tol(ref.pmpa[i]));
    near(`PMP c (H${i + 1})`, b.pmpc[i]!, ref.pmpc[i], tol(ref.pmpc[i]));
  }
  near('PMP b (Hu)', b.pmpb[3]!, ref.pmpb[3], tol(ref.pmpb[3]));
  near('BF H1 vs H2', b.matrix[0][1]!, ref.matrix[0][1], tol(ref.matrix[0][1]));
  near('BF vs unconstrained (H1), as the vignette prints it', b.bfu[0]!, 150.871, 0.0005);
  expect(r.gorica).toBeNull();
}, 600_000);
