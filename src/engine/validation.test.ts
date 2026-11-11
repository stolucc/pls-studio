// Validation suite: every JSON case in __fixtures__/validation was produced by
// an established R package (lavaan, seminr, cSEM, plspm) via
// scripts/validation/generate.R. Each is re-estimated here and compared value
// by value. A field present in the reference but missing from our output fails.

import { describe, expect, it } from 'vitest';
import { estimateCb, type CbEstimator } from './cbsem';
import { ipma } from './ipma';
import { mcIndirect } from './mcci';
import { estimateMiiv } from './miiv';
import { estimatePls } from './pls';
import {
  cases,
  checkCbResult,
  checkIpmaResult,
  checkMiivResult,
  checkPls,
  close,
  loadData,
  toSpec,
  type RawCase,
} from './validationHarness';

const checkCb = (c: RawCase) =>
  checkCbResult(
    c,
    estimateCb(loadData(c), toSpec(c), 'casewise', c.options.estimator as CbEstimator),
  );

const checkIpma = (c: RawCase) => {
  const o = c.options as {
    target: string;
    rescale: boolean;
    min?: number | null;
    max?: number | null;
  };
  checkIpmaResult(
    c,
    ipma(
      loadData(c),
      toSpec(c),
      { scheme: 'path', consistent: false, missing: 'mean', tolerance: 1e-12, maxIter: 2000 },
      { target: o.target, rescale: o.rescale, min: o.min ?? undefined, max: o.max ?? undefined },
    ),
  );
};

/** Monte Carlo CIs are random on both sides: limits must agree within 1% of the interval width. */
function checkMcci(c: RawCase) {
  const cb = estimateCb(loadData(c), toSpec(c), 'casewise', c.options.estimator as CbEstimator);
  const res = mcIndirect(cb, c.options.draws as number, 12345, 0.95);
  for (const ref of (
    c.expected as {
      indirect: { from: string; to: string; est: number; ciLow: number; ciHigh: number }[];
    }
  ).indirect) {
    const mine = res.find((x) => x.from === ref.from && x.to === ref.to)!;
    expect(mine, `${ref.from}→${ref.to}`).toBeDefined();
    close(mine.est, ref.est, 1e-5, `indirect ${ref.from}→${ref.to}`);
    const tol = c.tolerance * (ref.ciHigh - ref.ciLow);
    expect(Math.abs(mine.ciLow - ref.ciLow), `ci low: ${mine.ciLow} vs ${ref.ciLow}`).toBeLessThan(
      tol,
    );
    expect(
      Math.abs(mine.ciHigh - ref.ciHigh),
      `ci high: ${mine.ciHigh} vs ${ref.ciHigh}`,
    ).toBeLessThan(tol);
  }
}

function checkHtmt(c: RawCase) {
  const res = estimateCb(loadData(c), toSpec(c));
  for (const key of ['htmt', 'htmt2'] as const) {
    for (const h of (c.expected as Record<string, { a: string; b: string; v: number }[]>)[key]) {
      const a = res.constructs.indexOf(h.a),
        b = res.constructs.indexOf(h.b);
      close(a > b ? res[key][a][b] : res[key][b][a], h.v, c.tolerance, `${key} ${h.a}-${h.b}`);
    }
  }
}

const checkMiiv = (c: RawCase) => checkMiivResult(c, estimateMiiv(loadData(c), toSpec(c)));

describe.each(cases)('$name ($source)', (c) => {
  it('matches the reference estimates', () => {
    if (c.kind === 'miiv') {
      checkMiiv(c);
    } else if (c.kind === 'htmt') {
      checkHtmt(c);
    } else if (c.kind === 'mcci') {
      checkMcci(c);
    } else if (c.kind === 'ipma') {
      checkIpma(c);
    } else if (c.kind === 'pls') {
      const o = c.options as {
        scheme: 'path' | 'factor' | 'centroid';
        consistent: boolean;
        missing: 'mean' | 'casewise';
      };
      const res = estimatePls(loadData(c), toSpec(c), { ...o, tolerance: 1e-12, maxIter: 2000 });
      expect(res.converged).toBe(true);
      checkPls(c, res);
    } else {
      checkCb(c);
    }
  });
});

it('the corpus covers every package and estimator', () => {
  expect(new Set(cases.map((c) => c.source))).toEqual(
    new Set(['seminr', 'plspm', 'cSEM', 'lavaan', 'semTools', 'MIIVsem']),
  );
  expect(new Set(cases.filter((c) => c.kind === 'cb').map((c) => c.options.estimator))).toEqual(
    new Set(['ML', 'MLM', 'MLMV', 'MLR', 'GLS', 'ULS']),
  );
});
