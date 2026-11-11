// Mplus User's Guide, chapter 9: the multilevel examples with random slopes, more levels or groups, in webR against
// what their Mplus outputs print (see testkit.ts). The multilevel regression card (lme4, or nlme for a residual
// variance per occasion or outcome) with Mplus's robust standard errors (MLR, the sandwich over the top-level
// clusters); two-level SEM by lavaan (MLR, observed information). Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { slowIt } from '../../rengine/webrSlow';
import { toSpec } from '../../model/project';
import { estimateCbLavaan } from '../../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../../rengine/webrTestRuntime';
import { near, same } from '../../validation/record';
import { exampleModel } from '../packages';
import { exampleData, runLmm, samePrintedLmm, type Where } from './lmmkit';
import { evidence, example, MPLUS, type Printed, samePrinted } from './testkit';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const within = (p: Printed) => p.block.startsWith('Within');

it('ex9.5: two outcomes stacked with random slopes (nlme, MLR) reproduce the Mplus output', async () => {
  evidence('ex9.5', 'Longitudinal', ['nlme']);
  // (Mplus integrates numerically and stops 0.003 below the maximum: see the card)
  const r = await runLmm('ex9.5', 0.004);
  expect(r.engine.package).toBe('nlme');
  const slope: Record<string, string> = { s1: 'y1: x2', s2: 'y2: y1' };
  const icept = (y: string) => `${y}: Intercept`;
  const where = (p: Printed): Where => {
    if (within(p))
      return p.op === '~~' ? { group: 'Residual', a: p.lhs } : { fixed: `${p.lhs}: ${p.rhs}` };
    if (p.op === '~')
      return { fixed: p.lhs === 's1' ? 'y1: x2w' : p.lhs === 's2' ? 'y2: y1w' : `${p.lhs}: w` };
    if (p.op === '~1') return { fixed: slope[p.lhs] ?? icept(p.lhs) };
    return p.lhs !== p.rhs
      ? { group: 'clus', a: icept(p.lhs), b: icept(p.rhs) }
      : { group: 'clus', a: slope[p.lhs] ?? icept(p.lhs) };
  };
  samePrintedLmm('ex9.5', r, where, {
    tol: 0.0025,
    seTol: 0.0015,
    // the between-cluster variance of y2, along the flat direction where Mplus stopped (0.207 against 0.214)
    wide: (p) =>
      !within(p) && p.lhs === 'y2' && p.rhs === 'y2' ? { tol: 0.008, seTol: 0.004 } : null,
  });
  near(
    'between variance of y2 (nlme, as on the card)',
    r.random.find((v) => v.group === 'clus' && v.a === 'y2: Intercept' && !v.b)!.variance,
    0.207,
    0.0005,
  );
}, 600_000);

it('ex9.14: two-level growth with a random slope of a time-varying covariate (wide data, lme4, MLR) reproduces the Mplus estimates and standard errors', async () => {
  evidence('ex9.14', 'Longitudinal', ['lme4']);
  // (Mplus integrates over the random slope with 10 points per dimension: its log-likelihood is an approximation)
  const r = await runLmm('ex9.14', 0.07);
  near(
    'log-likelihood (the maximum; at Mplus’s printed estimates −3616.365)',
    r.logLik,
    -3616.364,
    0.001,
  );
  const where = (p: Printed): Where => {
    if (within(p)) {
      if (p.op === '~') return { fixed: p.lhs === 'iw' ? 'x' : 'time × x' };
      if (/^y\d$/.test(p.lhs)) return { group: 'Residual', a: null };
      if (p.lhs !== p.rhs) return { group: 'Person', a: 'Intercept', b: 'time' };
      return { group: 'Person', a: p.lhs === 'iw' ? 'Intercept' : p.lhs === 'sw' ? 'time' : 'a' };
    }
    const name: Record<string, string> = { ib: 'Intercept', sb: 'time', s: 'a' };
    if (p.op === '~')
      return { fixed: p.lhs === 'ib' ? 'w' : p.lhs === 'sb' ? 'time × w' : 'a × w' };
    if (p.op === '~1') return { fixed: name[p.lhs] };
    return p.lhs !== p.rhs
      ? { group: 'clus', a: 'Intercept', b: 'time' }
      : { group: 'clus', a: name[p.lhs] };
  };
  // (the between-cluster intercept variance and covariance differ most, 0.414 against 0.411)
  samePrintedLmm('ex9.14', r, where, {
    tol: 0.002,
    seTol: 0.001,
    wide: (p) =>
      !within(p) && p.op === '~~' && p.lhs !== 's' && p.rhs !== 'sb'
        ? { tol: 0.0035, seTol: 0.0015 }
        : null,
  });
}, 600_000);

it('ex9.20: three-level regression with random slopes at two levels (lme4, MLR) reproduces the Mplus output', async () => {
  evidence('ex9.20', 'Longitudinal', ['lme4']);
  const r = await runLmm('ex9.20');
  expect(r.levels).toEqual([
    { name: 'level2', units: 1500 },
    { name: 'level3', units: 50 },
  ]);
  const term: Record<string, string> = { y: 'Intercept', s1: 'x', s2: 'w', s12: 'xw' };
  const onz: Record<string, string> = { y: 'z', s1: 'xz', s2: 'wz', s12: 'xwz' };
  const where = (p: Printed): Where => {
    if (within(p)) return { group: 'Residual', a: null };
    const g = p.block.includes('LEVEL2') ? 'level2' : 'level3';
    if (p.op === '~') return { fixed: onz[p.lhs] };
    if (p.op === '~1') return { fixed: term[p.lhs] };
    return p.lhs !== p.rhs
      ? { group: g, a: term[p.lhs], b: term[p.rhs] }
      : { group: g, a: term[p.lhs] };
  };
  samePrintedLmm('ex9.20', r, where);
}, 600_000);

// (slow: minutes in webR; run with WEBR_SLOW, as npm run validate:evidence does)
slowIt(
  'ex9.23: three-level growth with residual variances per occasion (wide data, nlme, MLR) reproduces the Mplus estimates and standard errors',
  async () => {
    evidence('ex9.23', 'Longitudinal', ['nlme']);
    // (Mplus prints a log-likelihood 0.055 above the maximum: see the card)
    const r = await runLmm('ex9.23', 0.12);
    near(
      'log-likelihood (the maximum; at Mplus’s printed estimates −56044.83)',
      r.logLik,
      -56044.824,
      0.001,
    );
    expect(r.engine.package).toBe('nlme');
    const where = (p: Printed): Where => {
      const g = within(p) ? 'Person' : p.block.includes('LEVEL2') ? 'level2' : 'level3';
      if (p.op === '~') return { fixed: (p.lhs.startsWith('i') ? '' : 'time × ') + p.rhs };
      if (p.op === '~1') return { fixed: p.lhs.startsWith('i') ? 'Intercept' : 'time' };
      if (/^y\d$/.test(p.lhs)) return { group: within(p) ? 'Residual' : g, a: p.lhs };
      return p.lhs !== p.rhs
        ? { group: g, a: 'Intercept', b: 'time' }
        : { group: g, a: p.lhs.startsWith('i') ? 'Intercept' : 'time' };
    };
    // (the level-2 intercept variance: 0.439 against 0.440)
    samePrintedLmm('ex9.23', r, where, { tol: 0.0015 });
  },
  900_000,
);

it.each([['ex9.11'], ['ex9.12']])(
  '%s: lavaan’s two-level SEM (MLR) reproduces the Mplus output',
  async (key) => {
    const ex = example(key);
    evidence(key, 'CB-SEM', ['lavaan']);
    const spec = toSpec(exampleModel(ex));
    expect(spec.multilevel).toMatchObject({ column: 'clus', between: 'model' });
    expect(spec.information).toBe('observed');
    const r = await estimateCbLavaan(exampleData(key), spec, 'casewise', 'MLR', 'product');
    expect(r.converged).toBe(true);
    const want = MPLUS[key];
    same('free parameters', r.fit.npar, want.fit.npar!);
    same('df', r.fit.df, want.fit.df!);
    const level = (p: Printed) => (within(p) ? 0 : 1);
    if (key === 'ex9.11') {
      expect(r.groups?.labels.length).toBe(4);
      near('log-likelihood', r.fit.logl!, want.fit.logl!, 0.002);
      near('AIC', r.fit.aic!, want.fit.aic!, 0.004);
      near('BIC', r.fit.bic!, want.fit.bic!, 0.004);
      // Blocks: g1 within, g1 between, g2 within, g2 between. Within clusters every estimate and (Mplus's sandwich over
      // all clusters) standard error; between clusters the flat likelihood, within the differences the card states.
      for (const g of [1, 2])
        for (const l of [0, 1]) {
          const printed = want.estimates.filter((p) => p.group === g && level(p) === l);
          samePrinted(
            r.groups!.results[2 * (g - 1) + l].estimates,
            printed,
            `${key} group ${g} level ${l + 1}`,
            l === 0 ? { tol: 0.0025, seTol: 0.0016 } : { tol: 0.03, seTol: 0.075 },
          );
        }
      near(
        'between fb1 BY y2 (lavaan, as on the card)',
        r.groups!.results[1].estimates.find(
          (e) => e.op === '=~' && e.lhs === 'fb1' && e.rhs === 'y2',
        )!.est,
        1.405,
        0.0015,
      );
    } else {
      // Mplus stops 0.030 below the maximum, at its looser convergence criterion (lme4 reaches −6531.521 as well).
      near('log-likelihood (Mplus −6531.551)', r.fit.logl!, -6531.521, 0.001);
      near('AIC', r.fit.aic!, want.fit.aic!, 0.062);
      near('BIC', r.fit.bic!, want.fit.bic!, 0.062);
      for (const l of [0, 1])
        samePrinted(
          r.groups!.results[l].estimates,
          want.estimates.filter((p) => level(p) === l),
          `${key} level ${l + 1}`,
        );
    }
  },
  600_000,
);
