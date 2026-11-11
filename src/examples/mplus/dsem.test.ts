// Mplus's Bayesian multilevel and DSEM examples on the DSEM card: the model the card reads from each example's syntax
// has Mplus's free parameters (as many as Mplus counts, every one it prints), and the run recorded by
// dsem.native.test.ts (the card's R code in desktop R, Stan) is within Monte Carlo error of the Mplus output (dsemkit.ts).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dsemAnalysis, dsemModel } from '../../analyses/dsem';
import type { DsemSpec } from '../../analyses/dsemSyntax';
import { DESKTOP_ONLY, R_PACKAGES } from '../../rengine/bridge';
import { useCompute } from '../../rengine/compute';
import {
  compareWithMplus,
  DSEM_EXAMPLES,
  dsemExample,
  dsemExampleRequest,
  readRecorded,
} from './dsemkit';
import { MPLUS } from './testkit';
import { PACKAGE_EXAMPLES } from '../packages';
import { against, example as exampleCheck, near } from '../../validation/record';

/** Free parameters: a block's variances and covariances count one each, less its fixed variances. */
export const freeParameters = (spec: DsemSpec) =>
  spec.params.reduce(
    (s, p) =>
      s +
      (p.type === 'block'
        ? (p.fixed.length * (p.fixed.length + 1)) / 2 - p.fixed.filter((v) => v !== null).length
        : 1),
    0,
  );
const key = (r: { block: string; lhs: string; op: string; rhs: string }) =>
  `${r.block}|${r.lhs.toLowerCase()}|${r.op}|${r.rhs.toLowerCase()}`;
const swap = (r: { block: string; lhs: string; op: string; rhs: string }) =>
  `${r.block}|${r.rhs.toLowerCase()}|${r.op}|${r.lhs.toLowerCase()}`;

describe('the examples’ models are Mplus’s', () => {
  it.each(DSEM_EXAMPLES.map((e) => [e.key]))(
    '%s: Mplus’s number of free parameters, each printed parameter reported',
    (k) => {
      const { ctx, options } = dsemExample(k);
      const { spec } = dsemModel(options, ctx);
      expect(freeParameters(spec)).toBe(MPLUS[k].fit.npar);
      const mine = new Set(spec.report.map(key));
      for (const p of MPLUS[k].estimates)
        if (p.se > 0)
          expect(mine.has(key(p)) || (p.op === '~~' && mine.has(swap(p))), `${k}: ${key(p)}`).toBe(
            true,
          );
      // and nothing Mplus does not print
      const printed = new Set(MPLUS[k].estimates.flatMap((p) => [key(p), swap(p)]));
      for (const r of spec.report)
        if (!('v' in r.c))
          expect(printed.has(key(r)), `${k}: ${key(r)} is not in Mplus's output`).toBe(true);
    },
  );
});

describe('the examples open the card ready to run', () => {
  it.each(DSEM_EXAMPLES.map((e) => [e.key]))('%s', (k) => {
    const { ctx, options } = dsemExample(k);
    expect(dsemAnalysis.parseOptions(options)).toEqual(options);
    useCompute.setState({ backend: 'browser' } as never);
    expect(dsemAnalysis.blocked(options, ctx)).toMatch(/desktop R/);
    useCompute.setState({ backend: 'helper' } as never);
    expect(dsemAnalysis.blocked(options, ctx)).toBeNull();
    const req = dsemExampleRequest(k) as { spec: DsemSpec; chains: number };
    expect(req.chains).toBe(options.chains);
  });
  it('rstan is a desktop-only package the helper installs', () => {
    expect(DESKTOP_ONLY.has('rstan')).toBe(true);
    expect(R_PACKAGES.rstan).toContain('rstan');
    expect(
      readFileSync(join(__dirname, '..', '..', '..', 'helper', 'r', 'packages.txt'), 'utf8').split(
        '\n',
      ),
    ).toContain('rstan');
  });
});

const recorded = readRecorded();
describe('the recorded desktop runs against Mplus', () => {
  it.each(DSEM_EXAMPLES.map((e) => [e.key]))(
    '%s: converged, and within Monte Carlo error of every printed parameter',
    (k) => {
      const r = recorded[k];
      expect(
        r,
        `${k}: run NATIVE_R_TESTS=1 npx vitest run src/examples/mplus/dsem.native`,
      ).toBeDefined();
      expect(r.result.converged).toBe(true);
      expect(r.result.maxRhat!).toBeLessThan(1.05);
      expect(compareWithMplus(k, r.result)).toBe(MPLUS[k].estimates.filter((p) => p.se > 0).length);
    },
  );
});

// The card's own example: lme4's ?lmer model on the DSEM card, the recorded desktop run against lmer (REML).
describe('the card’s example (lme4 ?lmer, sleepstudy) against lmer', () => {
  const k = 'rstan-dsem-sleepstudy';
  it('opens the card ready to run: a random intercept and slope that covary', () => {
    const { ctx, options } = dsemExample(k);
    useCompute.setState({ backend: 'helper' } as never);
    expect(dsemAnalysis.blocked(options, ctx)).toBeNull();
    const { spec } = dsemModel(options, ctx);
    expect(freeParameters(spec)).toBe(6);
    expect(spec.report.map((r) => `${r.lhs} ${r.op} ${r.rhs}`)).toEqual([
      'Reaction ~~ Reaction',
      'Reaction ~~ s',
      's ~1 ',
      'Reaction ~1 ',
      'Reaction ~~ Reaction',
      's ~~ s',
    ]);
  });
  it('the recorded run: fixed effects at lmer’s estimates, the variances above them (flat priors, 18 subjects)', () => {
    const r = recorded[k];
    expect(
      r,
      `${k}: run NATIVE_R_TESTS=1 npx vitest run src/examples/mplus/dsem.native`,
    ).toBeDefined();
    expect(r.result.converged).toBe(true);
    const get = (lhs: string, op: string, rhs: string, block: string) =>
      r.result.parameters.find(
        (p) => p.lhs === lhs && p.op === op && p.rhs === rhs && p.block === block,
      )!;
    const ex = PACKAGE_EXAMPLES.find((e) => e.id === k)!;
    exampleCheck(k, { title: ex.title, method: 'Bayesian', packages: ['rstan'], definition: ex });
    against({
      label: 'lme4 1.1, lmer(Reaction ~ Days + (Days | Subject), sleepstudy) (REML) in desktop R',
      url: 'https://rdrr.io/cran/lme4/man/lmer.html',
      level: 'native',
    });
    // lmer(Reaction ~ Days + (Days | Subject), sleepstudy): 251.405 (SE 6.825), 10.467 (1.546); variances 612.10, 35.07, covariance 9.60, residual 654.94.
    near(
      'posterior median of the mean intercept, against lmer’s estimate (within 0.15 of its SE)',
      get('Reaction', '~1', '', 'Between Level').median,
      251.405,
      0.15 * 6.825,
    );
    near(
      'posterior median of the mean slope of Days, against lmer’s estimate (within 0.15 of its SE)',
      get('s', '~1', '', 'Between Level').median,
      10.467,
      0.15 * 1.546,
    );
    near(
      'posterior median of the residual variance, against lmer’s (within 5%)',
      get('Reaction', '~~', 'Reaction', 'Within Level').median,
      654.94,
      0.05 * 654.94,
    );
    for (const [p, se] of [
      [get('Reaction', '~1', '', 'Between Level'), 6.825],
      [get('s', '~1', '', 'Between Level'), 1.546],
    ] as const) {
      expect(p.sd / se).toBeGreaterThan(1.05);
      expect(p.sd / se).toBeLessThan(1.45);
    }
    expect(
      Math.abs(get('Reaction', '~~', 'Reaction', 'Within Level').median / 654.94 - 1),
    ).toBeLessThan(0.05);
    expect(get('Reaction', '~~', 'Reaction', 'Between Level').median).toBeGreaterThan(612.1);
    expect(get('s', '~~', 's', 'Between Level').median).toBeGreaterThan(35.07);
  });
});
