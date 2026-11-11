// The example of cards/apim.ts run through its card (the card's own run(), the rengine call the app makes) on the
// shipped data, against dySEM's scriptAPIM syntax fitted natively (scripts/validation/apim.R →
// src/engine/__fixtures__/apim.json); and the diagram "Draw on canvas" makes, fitted as the Model tab fits it, has
// the same χ² and df and the same k as the card, for both kinds of dyads. Estimates from lavaan's optimiser on
// differently ordered but equivalent syntax agree to about 1e-5 relative (webR adds ~1e-6): compared to 1e-4.
// Run with WEBR_TESTS=1.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { apimModel } from '../../model/apim';
import { analysisType } from '../../analyses/registry';
import type { ApimOptions } from '../../analyses/apim';
import type { AnalysisCtx } from '../../analyses/types';
import type { ApimResult } from '../../rengine/apim';
import { estimateCbLavaan } from '../../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { exampleSettings, PACKAGE_EXAMPLES, panelPreset } from '../packages';
import { exampleTestData } from '../testData';
import { against, example as exampleCheck, near, same } from '../../validation/record';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const REF = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'engine', '__fixtures__', 'apim.json'), 'utf8'),
);
const tol = (want: number) => 1e-4 * Math.max(1, Math.abs(want));
const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'lavaan-apim-commitment')!;

function ctxOf(): AnalysisCtx {
  return {
    data: exampleTestData(ex),
    info: null,
    settings: exampleSettings(DEFAULT_SETTINGS, ex.settings),
    pls: null,
    projectName: ex.title,
  };
}

async function runCard(ctx: AnalysisCtx, over: Partial<ApimOptions> = {}) {
  const t = analysisType('apim')!;
  const options = {
    ...t.parseOptions({ ...t.defaults(ctx), ...panelPreset(ex.panel!) })!,
    ...over,
  };
  expect(t.blocked(options, ctx), 'the card is ready to run').toBeNull();
  return {
    options: options as ApimOptions,
    r: (await t.run(options, ctx, () => {})) as ApimResult,
  };
}

it('lavaan-apim-commitment: dySEM’s latent APIM on commitmentM, distinguishable, with the test of distinguishability', async () => {
  exampleCheck(ex.id, { title: ex.title, method: 'CB-SEM', packages: ['lavaan'], definition: ex });
  const { r } = await runCard(ctxOf());
  against({
    label:
      'dySEM 1.4.1, ?scriptAPIM on ?commitmentM: its syntax fitted natively by lavaan (scripts/validation/apim.R)',
    level: 'native',
    url: 'https://rdrr.io/cran/dySEM/man/scriptAPIM.html',
  });
  const ref = REF.latent.dist;
  same('N (complete couples)', r.n, ref.n);
  near('χ²', r.fit.chisq!, ref.fit.chisq, tol(ref.fit.chisq));
  same('df', r.fit.df!, ref.fit.df);
  for (const e of [...r.effects, ...r.k])
    near(e.label, e.est!, ref.params[e.label].est, tol(ref.params[e.label].est));
  near(
    'test of distinguishability: χ²',
    r.test.chisqDiff!,
    REF.latent.test.chisqDiff,
    tol(REF.latent.test.chisqDiff),
  );
  same('test of distinguishability: df', r.test.dfDiff!, 16);
}, 600_000);

it('the drawn diagram is the card’s model: the same fit and k, for both kinds of dyads', async () => {
  const ctx = ctxOf();
  for (const dyads of ['distinguishable', 'indistinguishable'] as const) {
    const { options, r } = await runCard(ctx, { dyads });
    const model = apimModel(options);
    const fit = await estimateCbLavaan(ctx.data!, toSpec(model), 'casewise', 'ML');
    near(`${dyads}: χ² of the drawn model`, fit.fit.chisq, r.fit.chisq!, tol(r.fit.chisq!));
    same(`${dyads}: df of the drawn model`, fit.fit.df, r.fit.df!);
    for (const k of r.k) {
      const drawn = fit.estimates.find(
        (e) => e.kind === 'defined' && (e.label === k.label || e.lhs === k.label),
      )!;
      near(`${dyads}: ${k.label} of the drawn model`, drawn.est, k.est!, tol(k.est!));
    }
  }
}, 900_000);
