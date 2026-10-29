// FIMIX-PLS in webR against plain cSEM + flexmix calls in desktop R
// (scripts/validation/fimix.R) on plspm's simdata (two simulated segments).
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { ModelSpec } from '../engine/types';
import { fimixR, fimixScriptR } from './segment';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'engine', '__fixtures__', 'fimix');
const ref = JSON.parse(readFileSync(join(DIR, 'reference.json'), 'utf8'));
const data = parseCsv(readFileSync(join(DIR, 'simdata.csv'), 'utf8')).dataset;
const mv = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `mv${a + i}`);
const spec: ModelSpec = {
  constructs: [{ name: 'Price', type: 'factor', mode: 'A', indicators: mv(1, 5) }, { name: 'Quality', type: 'factor', mode: 'A', indicators: mv(6, 10) }, { name: 'Satisfaction', type: 'factor', mode: 'A', indicators: mv(11, 13) }],
  paths: [{ from: 'Price', to: 'Satisfaction' }, { from: 'Quality', to: 'Satisfaction' }],
};
const options = { scheme: 'path' as const, consistent: false, tolerance: 1e-7, maxIter: 300, missing: 'casewise' as const };

it.each([[true, 'intercepts'], [false, 'noIntercepts']] as const)('intercepts %s: log-likelihoods and segment sizes equal flexmix in desktop R', async (intercepts, key) => {
  const r = await fimixR(data, spec, options, { classes: [1, 2, 3], nrep: 10, seed: 1, intercepts });
  ref[key].forEach((m: { k: number; logLik: number; sizes: number[] }, i: number) => {
    expect(r.models[i].k).toBe(m.k);
    expect(r.models[i].criteria.logLik).toBeCloseTo(m.logLik, 4);
    const sizes = r.models[i].segments.map((s) => Math.round(s.share * r.n)).sort((a, b) => a - b);
    expect(sizes).toEqual(([] as number[]).concat(m.sizes));
  });
  if (intercepts) {
    const best = r.models.reduce((a, b) => (b.criteria.BIC < a.criteria.BIC ? b : a));
    expect(best.k).toBe(2);  // the two simulated segments
  }
}, 900_000);

it('the script uses stepFlexmix on the cSEM scores', async () => {
  const s = await fimixScriptR(data, spec, options, { classes: [1, 2], nrep: 5, seed: 1, intercepts: true });
  expect(s).toContain('scores <- as.data.frame(cSEM::getConstructScores(fit)$Construct_scores)');
  expect(s).toContain('FLXMRglm(Satisfaction ~ Price + Quality)');
}, 900_000);
