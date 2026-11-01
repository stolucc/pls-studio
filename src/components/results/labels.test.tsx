// What the result tabs say about how things were computed: standard-error
// labels, the PLS algorithm card, second-order notes, bootstrap and
// moderation notes, and when overall fit is not reported.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BootstrapResult, PlsResult } from '../../engine/types';
import type { CbEstimate, CbResult } from '../../engine/cbsem';
import { CbTab, seLabel } from './CbTabs';
import { PlsTab } from './PlsTabs';

const pls = (over: Partial<PlsResult> = {}): PlsResult => ({
  n: 100, iterations: 5, converged: true, constructs: ['A', 'B'], indicators: [{ name: 'a1', construct: 0 }, { name: 'b1', construct: 1 }],
  weights: [1, 1], loadings: [1, 1], pathCoef: [[0, 0.5], [0, 0]], hasPath: [[false, true], [false, false]], totalEffects: [[0, 0.5], [0, 0]], indirectEffects: [[0, 0], [0, 0]],
  rSquared: [null, 0.25], adjRSquared: [null, 0.24], constructCor: [[1, 0.5], [0.5, 1]], quality: [{ alpha: 1, rhoC: 1, rhoA: 1, ave: 1 }, { alpha: 1, rhoC: 1, rhoA: 1, ave: 1 }],
  htmt: [[null, null], [0.3, null]], htmt2: [[null, null], [0.3, null]], fit: { estimated: { srmr: 0.05, dULS: 0.1, dG: 0.1 }, saturated: { srmr: 0.05, dULS: 0.1, dG: 0.1 } },
  consistent: false, types: ['factor', 'factor'], moderations: [], fSquare: [[null, 0.3], [null, null]], vifInner: [[null, 1], [null, null]], vifOuter: [1, 1],
  scores: [Float64Array.from([0]), Float64Array.from([0])], droppedRows: 0, warnings: [], engine: { package: 'cSEM', version: '0.6' }, ...over,
} as unknown as PlsResult);
const html = (tab: Parameters<typeof PlsTab>[0]['tab'], r: PlsResult, boot: BootstrapResult | null = null) => renderToStaticMarkup(<PlsTab tab={tab} pls={r} boot={boot} fitTest={null} />);

describe('standard-error labels follow how lavaan computed them', () => {
  it('names cluster-robust, robust, bootstrap and standard errors, and falls back to the estimator', () => {
    expect(seLabel({ estimator: 'ML', seType: 'robust.cluster' })).toBe('Cluster-robust SE');
    expect(seLabel({ estimator: 'MLR', seType: 'robust.cluster.sem' })).toBe('Cluster-robust SE');
    expect(seLabel({ estimator: 'ML', seType: 'robust.huber.white' })).toBe('Robust SE');
    expect(seLabel({ estimator: 'MLM', seType: 'robust.sem' })).toBe('Robust SE');
    expect(seLabel({ estimator: 'ML', seType: 'bootstrap' })).toBe('Bootstrap SE');
    expect(seLabel({ estimator: 'MLM', seType: 'standard' })).toBe('Std. error');
    expect(seLabel({ estimator: 'MLM' })).toBe('Robust SE');
    expect(seLabel({ estimator: 'ML' })).toBe('Std. error');
  });
});

describe('PLS tabs say what was computed', () => {
  it('names the weighting approach on the overview', () => {
    expect(html('overview', pls())).toContain('>PLS<');
    expect(html('overview', pls({ consistent: true }))).toContain('>PLSc<');
    expect(html('overview', pls({ approach: 'GSCA' }))).toContain('>GSCA<');
    expect(html('overview', pls({ approach: 'unit' }))).toContain('>Sum scores<');
  });
  it('explains an absent overall fit by its cause', () => {
    const na = { estimated: { srmr: NaN, dULS: NaN, dG: NaN }, saturated: { srmr: NaN, dULS: NaN, dG: NaN } };
    expect(html('fit', pls({ fit: na, hocApproach: 'repeated' }))).toContain('repeated indicators');
    expect(html('fit', pls({ fit: na, hocApproach: 'two_stage' }))).toContain('two-stage second-order models');
    expect(html('fit', pls({ fit: na, moderations: [{ from: 'A', moderator: 'B', to: 'B', construct: 2 }] }))).toContain('interaction terms');
    expect(html('fit', pls({ fit: na }))).toContain('not available for this model');
    expect(html('fit', pls())).toContain('Test of overall model fit');
  });
  it('describes the second-order approach of the result', () => {
    const ho = [{ construct: 1, component: 0, loading: 0.9, weight: 0.5 }];
    expect(html('outer', pls({ higherOrder: ho, hocApproach: 'two_stage' }))).toContain('Two-stage approach (disjoint)');
    expect(html('outer', pls({ higherOrder: ho, hocApproach: 'embedded' }))).toContain('embedded two-stage');
    expect(html('outer', pls({ higherOrder: ho, hocApproach: 'repeated' }))).toContain('Repeated indicators');
  });
  it('states the bootstrap test and interval kind', () => {
    const boot = (over: Partial<BootstrapResult>): BootstrapResult => ({ samples: 500, failed: 0, confidence: 0.95, stats: [{ key: 'path:A:B', group: 'path', label: 'A → B', original: 0.5, mean: 0.5, sd: 0.1, t: 5, p: 0.001, ciLow: 0.3, ciHigh: 0.7 }], ...over } as BootstrapResult);
    expect(html('bootstrap', pls(), boot({}))).toContain('Two-tailed t test');
    expect(html('bootstrap', pls(), boot({}))).toContain('percentile confidence intervals');
    expect(html('bootstrap', pls(), boot({ tails: 1, interval: 'bca' }))).toContain('One-tailed t test');
    expect(html('bootstrap', pls(), boot({ tails: 1, interval: 'bca' }))).toContain('bias-corrected and accelerated (BCa) intervals');
  });
  it('shows each moderation’s interaction approach', () => {
    const r = pls({ constructs: ['A', 'B', 'Y', 'A × B'], moderations: [{ from: 'A', moderator: 'B', to: 'Y', construct: 3, method: 'orthogonal' }],
      pathCoef: [[0, 0, 0.3, 0], [0, 0, 0.2, 0], [0, 0, 0, 0], [0, 0, 0.1, 0]], fSquare: [[null, null, 0.1, null], [null, null, 0.1, null], [null, null, null, null], [null, null, 0.01, null]] });
    const out = html('moderation', r);
    expect(out).toContain('orthogonalising');
    expect(out).toContain('Orthogonalising: products of indicators');
    const two = html('moderation', pls({ ...r, moderations: [{ from: 'A', moderator: 'B', to: 'Y', construct: 3, method: 'two_stage' }] }));
    expect(two).toContain('Two-stage approach (Henseler');
  });
});

describe('groups side by side', () => {
  const est = (lhs: string, op: '=~' | '~' | '~~', rhs: string, e: number, kind = 'loading'): CbEstimate => ({ kind: kind as never, lhs, op, rhs, est: e, se: 0.1, z: e / 0.1, p: 0.01, std: e });
  const group = (k: number): CbResult => ({
    estimator: 'ML', n: 100 + k, iterations: 10, converged: true, constructs: ['F', 'G'], indicators: [{ name: 'x1', construct: 0 }, { name: 'x2', construct: 0 }, { name: 'y1', construct: 1 }],
    estimates: [est('F', '=~', 'x1', 1, 'fixed-loading'), est('F', '=~', 'x2', 0.5), est('G', '~', 'F', 0.3 + 0.2 * k, 'path'), est('F', '~~', 'F', 1 + k, 'lvvar')],
    fit: { chisq: 10, df: 4, pvalue: 0.04, cfi: 0.95, tli: 0.9, rmsea: 0.05, rmseaLow: 0, rmseaHigh: 0.1, rmseaP: 0.5, srmr: 0.04, npar: 10, baselineChisq: 100, baselineDf: 6, logl: -1, aic: 2, bic: 3 },
    r2Indicators: [0.5, 0.25, 1], r2Constructs: [null, 0.09 + 0.1 * k], stdLoadings: [1, 0.5, 1], stdPaths: [[0, 0.3], [0, 0]], hasPath: [[false, true], [false, false]], stdTotal: [[0, 0.3 + 0.2 * k], [0, 0]], stdIndirect: [[0, 0], [0, 0]],
    lvCor: [[1, 0.3], [0.3, 1]], reliability: [{ cr: 0.8, ave: 0.6 }, { cr: 1, ave: 1 }], residualCor: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], htmt: [[null, null], [0.2, null]], htmt2: [[null, null], [0.2, null]], vcov: null,
    moderations: [], warnings: [], droppedRows: 0, engine: { package: 'lavaan', version: '0.6' },
  } as unknown as CbResult);
  const groups = { labels: ['1', '2'], results: [group(0), group(1)], score: [{ param: 'F =~ x2', groups: ['1', '2'], x2: 5.2, df: 1, p: 0.022 }] };
  const cb: CbResult = { ...group(0), groups, groupIndex: 0 };
  const html = (tab: Parameters<typeof import('./CbTabs').CbTab>[0]['tab']) => renderToStaticMarkup(<CbTab tab={tab} cb={cb} boot={null} compare />);
  it('shows one column set per group, the difference, and the score test of an equality constraint', () => {
    const paths = html('paths');
    expect(paths).toContain('Regressions by group');
    expect(paths).toContain('Estimate (1)'); expect(paths).toContain('Estimate (2)'); expect(paths).toContain('Δ (2 − 1)');
    expect(paths).toContain('0.200');  // 0.5 − 0.3
    expect(paths).toContain('free per group');
    expect(paths).toContain('R² by group');
    const loads = html('loadings');
    expect(loads).toContain('held equal; score test p 0.022');
    expect(loads).toContain('Marker loadings are fixed to 1');
    const vars = html('variances');
    expect(vars).toContain('Factor (co)variances and disturbances by group');
    expect(vars).toContain('1.000');
  });
  it('keeps the whole-model tabs and stacks the others per group', () => {
    expect(html('fit')).toContain('Fit statistics');
    const disc = html('discriminant');
    expect(disc).toContain('Group 1'); expect(disc).toContain('Group 2');
    expect((disc.match(/Fornell–Larcker/g) ?? []).length).toBe(2);
    expect(renderToStaticMarkup(<CbTab tab="paths" cb={cb} boot={null} />)).not.toContain('Regressions by group');
  });
});
