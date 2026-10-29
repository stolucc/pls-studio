// Latent-variable conditional process analysis: lavaan::sam + manymome
// Monte Carlo intervals, on manymome's own example (data_sem_mome, model 7
// with all variables latent). Point estimates as in manymome's article
// "Latent Variable Moderated Mediation by SAM". Run with npm run test:webr.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { materialise, template } from '../process/templates';
import { rCall } from './bridge';
import { cpaScriptR, estimateCpaR, type CpaInput } from './cpa';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const items = (p: string) => [1, 2, 3, 4].map((i) => `${p}${i}`);
async function data(): Promise<Dataset> {
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'manymome', name: 'data_sem_mome', na: [] }, 'manymome');
  return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => v ?? NaN)) };
}
const input = (latentW: boolean): CpaInput => ({
  graph: materialise(template(7)!, { x: 'fx', y: 'fy', m: ['fm'], w: 'fw' }), model: 7, order: ['fw'], covariates: [],
  variables: [['fx', 'x'], ['fm', 'm'], ['fy', 'y'], ['fw', 'w']].map(([name, p]) => ({ name, indicators: items(p), latent: name !== 'fw' || latentW })),
  missing: 'casewise', probe: 'percentiles', boot: { samples: 2000, seed: 1 }, confidence: 0.95,
});

describe('latent variables (lavaan::sam)', () => {
  it('reproduces manymome’s SAM example', async () => {
    const res = await estimateCpaR(await data(), input(true));
    expect(res.inference).toBe('montecarlo');
    expect(res.latent.sort()).toEqual(['fm', 'fw', 'fx', 'fy']);
    const fm = res.equations.find((e) => e.outcome === 'fm')!;
    const coef = (vars: string[]) => fm.coefficients.find((k) => [...k.term].sort().join() === [...vars].sort().join())!.est;
    expect(coef(['fx'])).toBeCloseTo(0.398144820, 6);
    expect(coef(['fx', 'fw'])).toBeCloseTo(0.481177763, 6);
    // A latent moderator is probed at its mean and ± 1 SD.
    const rows = res.indirect[0].rows;
    expect(rows.map((r) => r.est)).toEqual([expect.closeTo(-0.002041195, 6), expect.closeTo(0.169078421, 6), expect.closeTo(0.340198037, 6)]);
    for (const r of rows) expect(r.lo).toBeLessThan(r.hi);
    const mm = res.indices.find((i) => i.kind === 'mm')!;
    expect(mm.est).toBeCloseTo(0.481177763 * 0.424665631, 5);
    expect(mm.lo).toBeGreaterThan(0);
    // Johnson–Neyman for the latent moderator, within ± 3 SD.
    expect(res.jn[0]).toMatchObject({ from: 'fx', to: 'fm', moderator: 'fw', latent: true, mean: 0 });
  }, 600_000);

  it('mixes latent variables with a mean-score moderator, and exports the script', async () => {
    const d = await data();
    const res = await estimateCpaR(d, input(false));
    expect(res.latent.sort()).toEqual(['fm', 'fx', 'fy']);
    expect(res.moderators[0].values).toHaveLength(3);
    expect(res.jn[0].latent).toBeFalsy();
    const script = await cpaScriptR(d, input(false));
    expect(script).toContain('fit <- sam(model, data = data, se = "twostep")');
    expect(script).toContain('mc_out <- do_mc(fit, R = 2000, seed = 1');
    expect(script).toContain('data$fw <- rowMeans(data[, c("w1", "w2", "w3", "w4")])');
  }, 600_000);
});
