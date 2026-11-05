// Mplus User's Guide, chapter 9: the multilevel examples in webR against what their Mplus outputs print
// (see testkit.ts). Two-level SEM by lavaan (MLR, observed information: Mplus's TYPE = TWOLEVEL defaults);
// random slopes by lme4 (ML), whose estimates and log-likelihood are Mplus's and whose standard errors are
// model-based where Mplus's are robust (MLR): those are checked against the values the cards state.
// Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { computeColumn } from '../../data/compute';
import type { Dataset } from '../../engine/types';
import type { DataInfo } from '../../model/project';
import { toSpec } from '../../model/project';
import { estimateCbLavaan } from '../../rengine/lavaan';
import { lmmR, type LmmInput } from '../../rengine/mixed';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { exampleModel } from '../packages';
import { remoteTestData } from '../testData';
import { evidence, example, load, MPLUS, type Printed, sameFit, samePrinted, TOL } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

/** The example's data with its computed columns (Mplus's DEFINE / CENTER), as opening it gives. */
function data(key: string): Dataset {
  const ex = example(key);
  let d = load(key);
  let info: DataInfo = { fileName: `${key}.dat`, rows: d.cols[0].length, missingCells: 0, excluded: [] };
  for (const k of ex.computed ?? []) ({ data: d, info } = computeColumn(d, info, k.name, k.expr));
  return d;
}
const level = (block: string) => (block.startsWith('Within') ? 0 : 1);

it.each([['ex9.1a'], ['ex9.1b'], ['ex9.6']])('%s: lavaan’s two-level SEM (MLR) reproduces the Mplus output', async (key) => {
  const ex = example(key);
  evidence(key, 'CB-SEM', ['lavaan']);
  const spec = toSpec(exampleModel(ex));
  expect(spec.multilevel).toMatchObject({ column: 'clus', between: 'model' });
  expect(spec.information).toBe('observed');
  const r = await estimateCbLavaan(data(key), spec, 'casewise', 'MLR', 'product');
  expect(r.converged).toBe(true);
  expect(r.groups?.labels).toEqual(['Within', 'Between']);
  const want = MPLUS[key];
  // (x is the computed, grand-mean-centred xc in 9.1a and 9.1b)
  const printed = want.estimates.map((p) => ({ ...p, rhs: p.rhs === 'x' && key !== 'ex9.6' ? 'xc' : p.rhs }));
  if (key === 'ex9.6') {
    // Mplus's χ² rests on its unrestricted model, fitted at a looser criterion (documented on the card).
    sameFit(r.fit, { npar: want.fit.npar, logl: want.fit.logl, aic: want.fit.aic, bic: want.fit.bic, df: want.fit.df });
    near('χ² (lavaan, unscaled; Mplus 3.862 from its log-likelihoods)', r.fit.chisq, 3.918, 0.001);
    near('χ² (lavaan, scaled; Mplus 5.081)', r.fit.chisqScaled!, 4.067, 0.001);
  } else sameFit(r.fit, want.fit);
  if (key === 'ex9.1b') {
    // The between slopes and betac: Mplus stopped short of the maximum (χ² 0.001 on 0 df), documented on the card.
    const between = (p: Printed) => level(p.block) === 1 && p.op === '~' && (p.rhs === 'w' || p.rhs === 'xc');
    for (const l of [0, 1]) samePrinted(r.groups!.results[l].estimates, printed.filter((p) => level(p.block) === l && !between(p) && p.lhs !== 'betac'), `${key} level ${l + 1}`);
    samePrinted(r.groups!.results[1].estimates, printed.filter(between), `${key} between slopes`, { tol: 0.005, seTol: 0.001 });
    const betac = r.groups!.results[0].estimates.find((e) => e.kind === 'defined' && e.lhs === 'betac')!;
    const p = want.estimates.find((x) => x.lhs === 'betac')!;
    near('betac := gamma01 − gamma10', betac.est, p.est, 0.005);
    near('SE of betac', betac.se!, p.se, 0.001);
    for (const [label, have, value] of [['w', 'w', 0.383], ['x', 'xc', 1.192]] as const)
      near(`between y on ${label} (lavaan, as on the card)`, r.groups!.results[1].estimates.find((e) => e.op === '~' && e.lhs === 'y' && e.rhs === have)!.est, value, 0.0005);
    near('betac (lavaan, as on the card)', betac.est, 0.412, 0.0005);
  } else for (const l of [0, 1]) samePrinted(r.groups!.results[l].estimates, printed.filter((p) => level(p.block) === l), `${key} level ${l + 1}`);
}, 600_000);

/** Where each parameter Mplus prints sits in lme4's output: a fixed effect, or a variance component. */
type Where = { fixed: string } | { group: string; a: string | null; b: string | null };
const LME4: Record<string, { input: () => LmmInput; where: (p: Printed) => Where; ses: number[] }> = {
  'ex9.2a': {
    input: () => panel('ex9.2a'),
    where: (p) => {
      if (level(p.block) === 0) return { group: 'Residual', a: null, b: null };
      if (p.op === '~1') return { fixed: p.lhs === 'y' ? 'Intercept' : 'xc' };
      if (p.op === '~') return { fixed: p.lhs === 'y' ? p.rhs : p.rhs === 'w' ? 'xcw' : 'xcxm' };
      return p.lhs !== p.rhs ? { group: 'clus', a: 'Intercept', b: 'xc' } : { group: 'clus', a: p.lhs === 'y' ? 'Intercept' : 'xc', b: null };
    },
    // Intercept, xc, w, xm, xcw, xcxm: lme4's model-based standard errors, as the card states them.
    ses: [0.096, 0.074, 0.131, 0.182, 0.100, 0.137],
  },
  'ex9.16': {
    input: () => panel('ex9.16'),
    where: (p) => {
      if (level(p.block) === 0) return p.op === '~' ? { fixed: p.rhs } : { group: 'Residual', a: null, b: null };
      if (p.op === '~1') return { fixed: p.lhs === 'y' ? 'Intercept' : 'time' };
      if (p.op === '~') return { fixed: p.lhs === 'y' ? p.rhs : p.rhs === 'x1' ? 'tx1' : 'tx2' };
      return p.lhs !== p.rhs ? { group: 'person', a: 'Intercept', b: 'time' } : { group: 'person', a: p.lhs === 'y' ? 'Intercept' : 'time', b: null };
    },
    // Intercept, time, a3, x1, x2, tx1, tx2.
    ses: [0.055, 0.025, 0.021, 0.054, 0.056, 0.025, 0.026],
  },
};
LME4['ex9.2b'] = { ...LME4['ex9.2a'], input: () => panel('ex9.2b') };
function panel(key: string): LmmInput {
  const p = example(key).panel;
  if (p?.kind !== 'lmm') throw new Error(`${key} has no lmm card`);
  const { kind: _k, ...input } = p;
  return input;
}

it.each([['ex9.2a'], ['ex9.2b'], ['ex9.16']])('%s: lme4 (ML) reproduces the Mplus log-likelihood and every estimate', async (key) => {
  evidence(key, 'Longitudinal', ['lme4']);
  const c = LME4[key];
  const r = await lmmR(data(key), c.input());
  expect(r.reml).toBe(false);
  const want = MPLUS[key];
  near('log-likelihood', r.logLik, want.fit.logl!, 0.002);
  near('AIC', r.aic, want.fit.aic!, 0.002);
  near('BIC', r.bic, want.fit.bic!, 0.002);
  same('free parameters (fixed effects and variance components)', r.fixed.length + r.random.length, want.fit.npar!);
  // Every parameter Mplus prints, at its place in lme4's output (Mplus's standard errors are MLR's; lme4's are
  // model-based, the card gives both).
  for (const p of want.estimates) {
    const w = c.where(p);
    const est = 'fixed' in w ? r.fixed.find((f) => f.term === w.fixed)?.est : r.random.find((v) => v.group === w.group && v.a === w.a && v.b === w.b)?.variance;
    const label = `${p.block.split(' ')[0].toLowerCase()} ${p.lhs} ${p.op} ${p.rhs}`.trim();
    expect(est, `${key}: ${label}`).toBeDefined();
    near(label, est!, p.est, TOL);
  }
  r.fixed.forEach((f, i) => near(`SE of ${f.term} (lme4, as on the card)`, f.se, c.ses[i], 0.0005));
}, 600_000);

it('ex9.16: the long data are the wide data reshaped as Mplus’s DATA WIDETOLONG does', () => {
  const { reshape: _r, ...asDownloaded } = example('ex9.16').data.remote!;
  const wide = remoteTestData(asDownloaded);
  const long = data('ex9.16');
  const col = (d: Dataset, n: string) => d.cols[d.names.indexOf(n)];
  expect(col(long, 'y').length).toBe(4 * col(wide, 'x1').length);
  for (let i = 0; i < col(wide, 'x1').length; i++) for (let t = 0; t < 4; t++) {
    const r = 4 * i + t;
    expect([col(long, 'person')[r], col(long, 'time')[r]]).toEqual([i + 1, t]);
    expect([col(long, 'y')[r], col(long, 'a3')[r], col(long, 'x1')[r], col(long, 'x2')[r]])
      .toEqual([col(wide, `y1${t + 1}`)[i], col(wide, `a3${t + 1}`)[i], col(wide, 'x1')[i], col(wide, 'x2')[i]]);
  }
});
