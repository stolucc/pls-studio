// Mplus's Bayesian SEM examples (3.18, 5.31, 5.32, 5.33, 11.7): the run recorded by bsem.native.test.ts (the card's
// R code in desktop R, blavaan and Stan) against the Mplus output, without R: every free parameter Mplus prints,
// its posterior median and SD within Monte Carlo error (bsemkit.ts), and the card's options as the examples open it.

import { describe, expect, it } from 'vitest';
import { bsemAnalysis } from '../../analyses/bsem';
import { useCompute } from '../../rengine/compute';
import { MPLUS } from './testkit';
import {
  BSEM_EXAMPLES,
  bsemExample,
  bsemExampleRequest,
  compareWithMplus,
  readRecorded,
} from './bsemkit';

const recorded = readRecorded();

describe('the recorded desktop runs against Mplus', () => {
  it.each(BSEM_EXAMPLES.map((e) => [e.key]))(
    '%s: converged, and within Monte Carlo error of every printed parameter',
    (key) => {
      const r = recorded[key];
      expect(
        r,
        `${key}: run NATIVE_R_TESTS=1 npx vitest run src/examples/mplus/bsem.native`,
      ).toBeDefined();
      expect(r.result.converged).toBe(true);
      expect(r.result.maxRhat).toBeLessThan(1.05);
      expect(r.result.priors).toBe('mplus');
      expect(compareWithMplus(key, r.result)).toBe(
        MPLUS[key].estimates.filter((p) => p.se > 0).length,
      );
    },
  );

  it('3.18: the indirect effect over the moderator (Mplus LOOP, PLOT): b·(γ1 + γ2·mod) from −2 to 2', () => {
    const l = recorded['ex3.18'].result.loop!;
    expect(l.x).toHaveLength(41);
    const b = recorded['ex3.18'].result.parameters.find((p) => p.label === 'b')!;
    const g1 = recorded['ex3.18'].result.parameters.find((p) => p.label === 'gamma1')!;
    // At mod = 0 the indirect effect is b·γ1: its median near the product of the medians (both well away from 0 here).
    expect(l.median[20]).toBeCloseTo(b.median! * g1.median!, 1);
    // γ2 < 0 (−0.18): the indirect effect falls with the moderator.
    expect(l.median[40]).toBeLessThan(l.median[0]);
  });

  it('11.7: plausible values of the factors as Mplus summarises them (means within Monte Carlo error)', () => {
    const pv = recorded['ex11.7'].result.plausible!;
    expect(pv.draws).toBe(20);
    expect(pv.cases).toBe(500);
    // SUMMARIES OF PLAUSIBLE VALUES: the means of F1, F2, F3, I, S over 500 × 20 draws, and the cases' SDs averaged.
    const mplus: Record<string, [number, number]> = {
      f1: [-0.008, 0.612],
      f2: [0.966, 0.619],
      f3: [1.898, 0.741],
      i: [-0.001, 0.563],
      s: [0.959, 0.247],
    };
    for (const [k, [mean, sd]] of Object.entries(mplus)) {
      const j = pv.factors.indexOf(k);
      expect(j, k).toBeGreaterThanOrEqual(0);
      // (a mean over cases moves with the posterior of the factor means: within 0.4 posterior SD of s's mean, 0.061 × 0.4 × 2 = 0.05)
      expect(Math.abs(pv.mean[j] - mean), `mean of ${k}`).toBeLessThan(0.08);
      expect(Math.abs(pv.meanSd[j] - sd) / sd, `mean SD of ${k}`).toBeLessThan(0.15);
    }
  });
});

describe('the examples open the card ready to run', () => {
  it.each(BSEM_EXAMPLES.map((e) => [e.key]))('%s', (key) => {
    const { ctx, options } = bsemExample(key);
    useCompute.setState({ backend: 'helper' } as never);
    expect(bsemAnalysis.parseOptions(options)).toEqual(options);
    expect(bsemAnalysis.blocked(options, ctx)).toBeNull();
    const req = bsemExampleRequest(key) as Record<string, unknown>;
    expect(req.priors).toBe('mplus');
  });
});
