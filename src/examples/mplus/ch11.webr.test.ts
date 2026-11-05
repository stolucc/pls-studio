// Mplus User's Guide, chapter 11: the examples in webR against what their Mplus outputs print
// (see testkit.ts). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { growthInput } from '../../analyses/longitudinal';
import { computeColumn } from '../../data/compute';
import type { DataInfo } from '../../model/project';
import { DEFAULT_SETTINGS, toSpec } from '../../model/project';
import { growthR } from '../../rengine/longitudinal';
import { cbScriptLavaan, estimateCbLavaan } from '../../rengine/lavaan';
import { callJson, withR } from '../../rengine/runtime';
import commonR from '../../rengine/R/common.R?raw';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { exampleModel } from '../packages';
import { evidence, example, load, MPLUS, sameFit, samePrinted } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

/** The example's data with its computed columns, and its growth card run as the app runs it. */
async function runCard(key: string) {
  const ex = example(key);
  let data = load(key);
  let info = { fileName: key, rows: data.cols[0].length, missingCells: 0, excluded: [] } as unknown as DataInfo;
  for (const k of ex.computed ?? []) ({ data, info } = computeColumn(data, info, k.name, k.expr));
  const { kind: _k, ...opts } = ex.panel as Extract<NonNullable<typeof ex.panel>, { kind: 'growth' }>;
  const input = growthInput({ ...opts, timeVarying: opts.timeVarying ?? [] }, { settings: { ...DEFAULT_SETTINGS, ...ex.settings }, model: exampleModel(ex) });
  expect(input.missing).toBe('fiml');
  expect(input.information).toBe('observed');
  return { r: await growthR(data, input), data };
}

it('ex11.1: FIML with a saturated missing-data correlate reproduces the Mplus output', async () => {
  evidence('ex11.1', 'Longitudinal', ['lavaan']);
  const { r } = await runCard('ex11.1');
  const want = MPLUS['ex11.1'];
  // Mplus counts the growth model's 9 parameters; its log-likelihood, AIC and BIC include z's 6 (mean, variance, 4 covariances), as lavaan's.
  same('free parameters with the auxiliary part', r.fit.npar!, want.fit.npar! + 6);
  sameFit({ ...r.fit, npar: undefined }, { ...want.fit, npar: undefined });
  expect(r.n).toBe(200);
  samePrinted(r.estimates, want.estimates, 'ex11.1');
}, 600_000);

it('ex11.4: the pattern-mixture model reproduces the Mplus output (one standard error as stated)', async () => {
  evidence('ex11.4', 'Longitudinal', ['lavaan']);
  const { r, data } = await runCard('ex11.4');
  // The dropout dummies as Mplus's DDROPOUT makes them (its descriptive statistics: 3.3%, 3.5%, 5.4%, 4.0%).
  const count = (d: string) => Array.from(data.cols[data.names.indexOf(d)]).reduce((a, v) => a + v, 0);
  expect([1, 2, 3, 4, 5].map((t) => count(`d${t}`))).toEqual([33, 35, 54, 40, 151]);
  const want = MPLUS['ex11.4'];
  sameFit(r.fit, want.fit);
  const shared = (p: { lhs: string; op: string; rhs: string }) => p.lhs === 's' && p.op === '~' && (p.rhs === 'd1' || p.rhs === 'd2');
  samePrinted(r.estimates, want.estimates.filter((p) => !shared(p)), 'ex11.4');
  samePrinted(r.estimates, want.estimates.filter(shared), 'ex11.4 shared slope shift', { ses: false });
  // Mplus prints 0.156; lavaan's observed information (and a numerical Hessian of the likelihood) give 0.160, as the card states.
  for (const d of ['d1', 'd2']) near(`SE of s ~ ${d} (stated)`, r.estimates.find((e) => e.lhs === 's' && e.op === '~' && e.rhs === d)!.se!, 0.160, 0.0006);
}, 600_000);

it('ex11.6: growth on 10 imputed data sets (mice, Bayesian normal regression; lavaan.mi pooling) agrees with Mplus within Monte Carlo error', async () => {
  evidence('ex11.6', 'CB-SEM', ['lavaan', 'mice', 'lavaan.mi']);
  const ex = example('ex11.6');
  const st = { ...DEFAULT_SETTINGS, ...ex.settings };
  const data = load('ex11.6');
  const r = await estimateCbLavaan(data, toSpec(exampleModel(ex)), 'mi', 'ML', 'product', { m: st.miImputations, seed: st.seed, method: st.miMethod, auxiliary: st.miAuxiliary, nominal: st.miNominal });
  expect(r.converged).toBe(true);
  const script = await cbScriptLavaan(data, toSpec(exampleModel(ex)), 'mi', 'ML', 'product', { m: st.miImputations, seed: st.seed, method: st.miMethod, auxiliary: st.miAuxiliary, nominal: st.miNominal });
  expect(script).toContain('defaultMethod = c("norm", "logreg", "polyreg", "polr")');
  expect(script).toMatch(/data\[\[v\]\] <- factor\(data\[\[v\]\]\)/);
  // The between-imputation variance B of each estimate, from an independent run of the same imputation model in the
  // same R: the difference of two pooled estimates over 10 data sets has SD √(2B/10).
  const cols = ['y1', 'y2', 'y3', 'y4', 'x1', 'x2'].map((n) => Array.from(data.cols[data.names.indexOf(n)], (v) => (Number.isNaN(v) ? null : v)));
  const B = await withR(['jsonlite', 'mice', 'lavaan'], { common: commonR }, (webR) => callJson(webR, `
    req <- jsonlite::fromJSON(req, simplifyVector = FALSE)
    d <- as.data.frame(setNames(lapply(req$cols, function(x) as.numeric(unlist(lapply(x, function(v) if (is.null(v)) NA else v)))), c("y1","y2","y3","y4","x1","x2")))
    d$x1 <- factor(d$x1)
    imp <- mice::mice(d, m = 20, seed = 2, printFlag = FALSE, defaultMethod = c("norm", "logreg", "polyreg", "polr"))
    m <- 'i =~ 1*y1 + 1*y2 + 1*y3 + 1*y4\ns =~ 0*y1 + 1*y2 + 2*y3 + 3*y4\ni + s ~ x1 + x2'
    E <- sapply(1:20, function(k) { dd <- mice::complete(imp, k); dd$x1 <- as.numeric(as.character(dd$x1)); p <- lavaan::parameterEstimates(lavaan::growth(m, dd)); setNames(c(p$est, p$se), c(paste(p$lhs, p$op, p$rhs), paste("se", p$lhs, p$op, p$rhs))) })
    ps_json(as.list(apply(E, 1, stats::var)))`, { cols })) as Record<string, number>;
  let n = 0;
  for (const p of MPLUS['ex11.6'].estimates) {
    if (p.se === 0) continue;
    const key = `${p.lhs} ${p.op} ${p.rhs}`, alt = `${p.rhs} ${p.op} ${p.lhs}`;
    const b = B[key] ?? B[alt], bse = B[`se ${key}`] ?? B[`se ${alt}`];
    expect(b, key).toBeDefined();
    const e = r.estimates.find((x) => x.op === p.op && ((x.lhs === p.lhs && x.rhs === p.rhs) || (x.lhs === p.rhs && x.rhs === p.lhs)))!;
    expect(e, key).toBeTruthy();
    // Monte Carlo error of the pooled estimate, plus Mplus's printed rounding.
    near(`${key} (pooled; Mplus by its own imputations)`, e.est, p.est, 3 * Math.sqrt(2 * b / 10) + 0.0005);
    // A pooled SE varies with the imputations mostly through the estimated between variance: T = W + 1.1B, and B
    // estimated from 10 data sets has SD B·√(2/9), so SE = √T has Monte Carlo SD about 1.1·B·√(2/9) / (2·SE) (plus W's, √(B_se/10)).
    near(`SE of ${key}`, e.se!, p.se, 3 * Math.sqrt(2) * (1.1 * b * Math.sqrt(2 / 9) / (2 * p.se) + Math.sqrt(bse / 10)) + 0.0005);
    n++;
  }
  expect(n).toBeGreaterThanOrEqual(13);
}, 900_000);
