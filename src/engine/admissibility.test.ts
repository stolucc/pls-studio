import { describe, expect, it } from 'vitest';
import {
  checkAdmissibility,
  EIGEN_TOLERANCE,
  parseAdmissibility,
  vcovSpectrum,
  waldInterval,
  type AdmissibilityInfo,
} from './admissibility';
import type { CbEstimate, CbResult } from './cbsem';
import { cbResult } from '../reporting/fixtures';

const est = (
  lhs: string,
  op: CbEstimate['op'],
  rhs: string,
  value: number,
  se: number | null = 0.1,
  std = NaN,
): CbEstimate => ({
  kind: op === '=~' ? 'loading' : 'residual',
  lhs,
  op,
  rhs,
  est: value,
  se,
  z: null,
  p: null,
  std,
});

/** The reporting fixture (two factors, Anxiety → Depression) with some estimates added or replaced. */
const withEstimates = (extra: CbEstimate[], over: Partial<CbResult> = {}): CbResult => {
  const base = cbResult();
  const key = (e: CbEstimate) => `${e.lhs}${e.op}${e.rhs}`;
  const replaced = new Set(extra.map(key));
  return {
    ...base,
    estimates: [...base.estimates.filter((e) => !replaced.has(key(e))), ...extra],
    ...over,
  };
};

const info = (over: Partial<AdmissibilityInfo> = {}): AdmissibilityInfo => ({
  blocks: [{ label: null, matrices: [] }],
  vcovNames: [],
  equalityConstraints: 0,
  ...over,
});

describe('checkAdmissibility: parameters (every engine)', () => {
  it('finds nothing in the reporting fixture', () => {
    const a = checkAdmissibility(cbResult());
    expect(a.status).toBe('admissible');
    expect(a.findings).toEqual([]);
    expect(a.causes).toEqual([]);
  });

  it('grades a negative variance by its Wald 95% interval (Kolenikov & Bollen 2012)', () => {
    const [low, high] = waldInterval(-0.05, 0.02);
    expect(low).toBeCloseTo(-0.05 - 1.959964 * 0.02, 6);
    expect(high).toBeCloseTo(-0.0108007, 6);
    const clear = checkAdmissibility(withEstimates([est('x3', '~~', 'x3', -0.05, 0.02)]));
    expect(clear.status).toBe('serious');
    expect(clear.findings[0]).toMatchObject({
      kind: 'negative-variance',
      severity: 'serious',
      params: ['x3'],
    });
    expect(clear.findings[0].detail).toContain('lies below zero');
    expect(clear.causes[0].id).toBe('misspecification');
    const small = checkAdmissibility(withEstimates([est('x3', '~~', 'x3', -0.05, 0.1)]));
    expect(small.status).toBe('check');
    expect(small.findings[0].detail).toContain('includes zero');
    expect(small.causes[0].id).toBe('sampling');
    // A latent (disturbance) variance is named as such.
    const lv = checkAdmissibility(
      withEstimates([est('Depression', '~~', 'Depression', -0.2, 0.05)]),
    );
    expect(lv.findings[0].title).toContain('latent (or disturbance) variance of Depression');
    // Without a standard error it cannot be judged against sampling error: serious.
    const noSe = checkAdmissibility(withEstimates([est('x3', '~~', 'x3', -0.05, null)]));
    expect(noSe.findings[0].severity).toBe('serious');
  });

  it('flags latent and residual correlations beyond ±1, from the parameters and the implied correlations', () => {
    const resid = checkAdmissibility(
      withEstimates([
        est('x1', '~~', 'x1', 0.4),
        est('x2', '~~', 'x2', 0.25),
        est('x1', '~~', 'x2', 0.35),
      ]),
    );
    const f = resid.findings.find((x) => x.kind === 'correlation')!;
    expect(f.title).toBe('Residual correlation of x1 and x2 beyond ±1');
    expect(f.detail).toContain('r = 1.107');
    expect(resid.causes[0].id).toBe('misspecification');
    const latent = checkAdmissibility(
      withEstimates([], {
        lvCor: [
          [1, 1.02],
          [1.02, 1],
        ],
      }),
    );
    const g = latent.findings.find((x) => x.kind === 'correlation')!;
    expect(g.title).toBe('Implied correlation of Anxiety and Depression beyond ±1');
    expect(latent.status).toBe('serious');
    expect(latent.causes[0].id).toBe('overfactoring');
  });

  it('a standardised loading above 1 alone is to check (Jöreskog 1999); with a negative residual variance it follows that variance', () => {
    const alone = checkAdmissibility(withEstimates([est('Anxiety', '=~', 'x2', 0.9, 0.1, 1.04)]));
    expect(alone.findings[0]).toMatchObject({ kind: 'std-loading', severity: 'check' });
    expect(alone.causes.map((c) => c.id)).toEqual(['loading']);
    const heywood = checkAdmissibility(
      withEstimates([
        est('Anxiety', '=~', 'x2', 0.9, 0.1, 1.04),
        est('x2', '~~', 'x2', -0.05, 0.1),
      ]),
    );
    const loading = heywood.findings.find((x) => x.kind === 'std-loading')!;
    expect(loading.severity).toBe('check');
    expect(loading.detail).toContain('consequence of the negative residual variance');
    expect(heywood.causes.map((c) => c.id)).not.toContain('loading');
  });

  it('non-convergence is serious and comes first', () => {
    const a = checkAdmissibility(withEstimates([], { converged: false }));
    expect(a.status).toBe('serious');
    expect(a.causes[0].id).toBe('nonconvergence');
  });

  it('checks every group, labelled', () => {
    const g1 = withEstimates([est('x3', '~~', 'x3', -0.05, 0.02)]);
    const g2 = cbResult();
    const cb: CbResult = {
      ...g1,
      groups: { labels: ['Girls', 'Boys'], results: [g1, g2], score: [] },
    };
    const a = checkAdmissibility(cb);
    expect(a.findings).toHaveLength(1);
    expect(a.findings[0].block).toBe('Girls');
  });
});

describe('checkAdmissibility: vcov', () => {
  it('a negative eigenvalue beyond rounding is serious, a rounding-level one numerical, and names the parameters', () => {
    const named = (vcov: number[][]) =>
      withEstimates(
        [
          { ...est('Anxiety', '=~', 'x2', 0.9), index: 0 },
          { ...est('Anxiety', '=~', 'x3', 0.5), index: 1 },
        ],
        { vcov },
      );
    // Eigenvalues 0.02 and ~0 (1e-18): rounding-level.
    const almost = checkAdmissibility(
      named([
        [0.01, 0.01],
        [0.01, 0.01 + 1e-18],
      ]),
    );
    expect(almost.status).toBe('numerical');
    expect(almost.findings[0].kind).toBe('vcov');
    expect(almost.findings[0].params.sort()).toEqual(['Anxiety =~ x2', 'Anxiety =~ x3']);
    expect(almost.causes.map((c) => c.id)).toEqual(['numerical']);
    // Eigenvalues 0.03 and −0.01: not positive definite.
    const bad = checkAdmissibility(
      named([
        [0.01, 0.02],
        [0.02, 0.01],
      ]),
    );
    expect(bad.status).toBe('serious');
    expect(bad.causes.map((c) => c.id)).toContain('identification');
    // Positive definite.
    expect(
      checkAdmissibility(
        named([
          [0.01, 0.001],
          [0.001, 0.02],
        ]),
      ).status,
    ).toBe('admissible');
  });

  it('drops one eigenvalue per equality constraint, as lavaan does, and uses R’s parameter names', () => {
    // Two identical parameters (an equality constraint) and a third: eigenvalues 0, 0.02, 0.03.
    const vcov = [
      [0.01, 0.01, 0],
      [0.01, 0.01, 0],
      [0, 0, 0.03],
    ];
    const sp = vcovSpectrum({
      ...cbResult(),
      vcov,
      admissibility: info({ equalityConstraints: 1 }),
    })!;
    expect(sp.dropped).toHaveLength(1);
    expect(Math.abs(sp.dropped[0])).toBeLessThan(1e-15);
    expect(sp.min).toBeCloseTo(0.02, 12);
    expect(sp.max).toBeCloseTo(0.03, 12);
    const a = checkAdmissibility({
      ...cbResult(),
      vcov,
      admissibility: info({ equalityConstraints: 1, vcovNames: ['a', 'b', 'c'] }),
    });
    expect(a.status).toBe('admissible');
    // Without the constraint count the zero eigenvalue is flagged (rounding-level), naming R's parameters.
    const b = checkAdmissibility({
      ...cbResult(),
      vcov,
      admissibility: info({ vcovNames: ['F =~ x2 (1)', 'F =~ x2 (2)', 'c'] }),
    });
    expect(b.findings[0].params.sort()).toEqual(['F =~ x2 (1)', 'F =~ x2 (2)']);
  });
});

describe('checkAdmissibility: model matrices (lavaan)', () => {
  const spectrum = (matrix: string, min: number, max: number, extra = {}) => ({
    matrix,
    size: 3,
    finite: true,
    min,
    max,
    involved: ['A', 'B'],
    negativeDiagonal: [],
    ...extra,
  });

  it('grades eigenvalues against √ε times the largest, per matrix', () => {
    expect(EIGEN_TOLERANCE).toBeCloseTo(1.4901161193847656e-8, 20);
    const a = checkAdmissibility({
      ...cbResult(),
      admissibility: parseAdmissibility({
        blocks: [
          {
            label: 'x',
            matrices: [
              spectrum('sample', 0.3, 4),
              spectrum('implied', 0.3, 4),
              spectrum('latent', -0.05, 1.5),
              // (ψ repeats cov.lv's problem: reported once)
              spectrum('psi', -0.05, 1.5),
              // (θ singular by design: single indicators with error variance 0)
              spectrum('theta', 0, 1.2),
            ],
          },
        ],
        vcovNames: [],
        equalityConstraints: 0,
      }),
    });
    const m = a.findings.filter((f) => f.kind === 'matrix');
    expect(m).toHaveLength(1);
    expect(m[0].title).toContain('latent variables');
    expect(m[0].params).toEqual(['A', 'B']);
    expect(m[0].block).toBeNull(); // one group: no label
    expect(a.causes[0].id).toBe('overfactoring');
  });

  it('a sample matrix that is not positive definite is a data problem; a negative diagonal alone is not reported twice', () => {
    const a = checkAdmissibility({
      ...cbResult(),
      admissibility: info({
        blocks: [
          {
            label: null,
            matrices: [
              spectrum('sample', -1e-3, 4) as never,
              spectrum('theta', -0.04, 1, { involved: ['x3'], negativeDiagonal: ['x3'] }) as never,
              spectrum('implied', 1e-12, 4) as never,
            ],
          },
        ],
      }),
    });
    const m = a.findings.filter((f) => f.kind === 'matrix');
    expect(m.map((f) => f.title)).toEqual([
      'The sample covariance (or polychoric correlation) matrix is not positive definite',
      'The model-implied covariance matrix of the observed variables (Σ̂) is singular (an eigenvalue of zero)',
    ]);
    expect(m.map((f) => f.severity)).toEqual(['serious', 'check']);
    expect(a.causes[0].id).toBe('data');
  });

  it('labels each block with the result’s group names, also in vcov names', () => {
    const g = cbResult();
    const cb: CbResult = {
      ...g,
      vcov: [
        [0.01, 0.01],
        [0.01, 0.01],
      ],
      groups: { labels: ['Girls', 'Boys'], results: [g, g], score: [] },
      admissibility: info({
        blocks: [
          { label: '1', matrices: [spectrum('latent', -0.1, 1) as never] },
          { label: '2', matrices: [] },
        ],
        vcovNames: ['F =~ x2 (1)', 'F =~ x2 (2)'],
      }),
    };
    const a = checkAdmissibility(cb);
    expect(a.findings.find((f) => f.kind === 'matrix')!.block).toBe('Girls');
    expect(a.findings.find((f) => f.kind === 'vcov')!.params.sort()).toEqual([
      'F =~ x2 (Boys)',
      'F =~ x2 (Girls)',
    ]);
  });

  it('reports ordinal pairs with empty cells', () => {
    const a = checkAdmissibility({
      ...cbResult(),
      admissibility: info({
        sparse: [
          {
            pairs: [{ a: 'x1', b: 'x2', cells: 4, empty: 1, sparse: 2, r: 1 }],
            total: 1,
          },
        ],
      }),
    });
    const f = a.findings.find((x) => x.kind === 'sparse')!;
    expect(f.severity).toBe('check');
    expect(f.detail).toContain('x1 × x2 (1 of 4 empty, r = 1.000)');
    expect(f.detail).toContain('Polychoric correlation at ±1: x1 × x2');
    expect(a.causes[0].id).toBe('sparse');
  });
});

describe('parseAdmissibility', () => {
  it('reads R’s output, unboxed single values and missing parts included, and drops unknown matrices', () => {
    const p = parseAdmissibility({
      blocks: {
        label: 'G',
        matrices: [
          {
            matrix: 'latent',
            size: 2,
            finite: true,
            min: -1,
            max: 2,
            involved: 'f1',
            negativeDiagonal: [],
          },
          { matrix: 'bogus', size: 1 },
          { matrix: 'theta', size: 2, finite: false, involved: [], negativeDiagonal: [] },
        ],
      },
      vcovNames: ['a'],
      equalityConstraints: 2,
      sparse: null,
    })!;
    expect(p.blocks).toHaveLength(1);
    expect(p.blocks[0].matrices.map((m) => m.matrix)).toEqual(['latent', 'theta']);
    expect(p.blocks[0].matrices[0].involved).toEqual(['f1']);
    expect(p.blocks[0].matrices[1]).toMatchObject({ finite: false });
    expect(p.equalityConstraints).toBe(2);
    expect(p.sparse).toBeUndefined();
    expect(parseAdmissibility(null)).toBeUndefined();
    // A matrix with missing values is serious.
    const a = checkAdmissibility({ ...cbResult(), admissibility: p });
    expect(a.findings.some((f) => f.title.includes('missing or infinite'))).toBe(true);
  });
});
