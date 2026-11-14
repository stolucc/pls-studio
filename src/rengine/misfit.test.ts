import { describe, expect, it } from 'vitest';
import {
  DECISION_LABEL,
  judgeMis,
  miPower,
  misfitWithGroupNames,
  parseMisfit,
  poorFitIndices,
  sarisDecision,
  sizeOfInterest,
  type MisfitMi,
} from './misfit';

describe('power of the MI test (non-central χ²(1))', () => {
  it('equals R’s 1 - pchisq(qchisq(.95, 1), 1, ncp = MI (δ / SEPC)²)', () => {
    // Reference values from R 4.5: f <- function(mi, sepc, d) 1 - pchisq(qchisq(.95, 1), 1, ncp = mi * (d / sepc)^2)
    expect(miPower(10, 0.2, 0.1)).toBeCloseTo(0.352608082444702, 12);
    expect(miPower(10, 0.05, 0.1)).toBeCloseTo(0.999993631968596, 12);
    expect(miPower(2, 0.5, 0.4)).toBeCloseTo(0.204663631071038, 12);
    expect(miPower(1, 0.02, 0.1)).toBeCloseTo(0.998817250703504, 12);
    expect(miPower(36.411, 0.515, 0.4)).toBeCloseTo(0.996801990358985, 12);
  });

  it('is the same for a negative SEPC and undefined for a zero one', () => {
    expect(miPower(10, -0.2, 0.1)).toBeCloseTo(miPower(10, 0.2, 0.1), 14);
    expect(miPower(10, 0, 0.1)).toBeNaN();
    expect(miPower(Number.NaN, 0.2, 0.1)).toBeNaN();
  });
});

describe('the decision rule (Saris, Satorra & van der Veld 2009, as semTools)', () => {
  it('significant MI with low power: misspecified', () => {
    expect(sarisDecision(10, 0.2, 0.1)).toBe('M');
  });
  it('significant MI with high power: judged by the size of the SEPC', () => {
    expect(sarisDecision(36.411, 0.515, 0.4)).toBe('EPC:M');
    expect(sarisDecision(36.411, -0.515, 0.4)).toBe('EPC:M');
    expect(sarisDecision(10, 0.05, 0.1)).toBe('EPC:NM');
  });
  it('non-significant MI: no misspecification with high power, inconclusive with low', () => {
    expect(sarisDecision(1, 0.02, 0.1)).toBe('NM');
    expect(sarisDecision(2, 0.5, 0.4)).toBe('I');
  });
  it('the MI must exceed 3.84 (χ²(1) at α = .05) to count as significant', () => {
    expect(sarisDecision(3.84, 0.5, 0.4)).toBe('I');
    expect(sarisDecision(3.85, 0.5, 0.4)).toBe('M');
  });
  it('has no decision without an SEPC', () => {
    expect(sarisDecision(10, 0, 0.1)).toBeNull();
  });
  it('uses .4 for loadings and .1 for covariances and paths', () => {
    expect(sizeOfInterest('=~')).toBe(0.4);
    expect(sizeOfInterest('~~')).toBe(0.1);
    expect(sizeOfInterest('~')).toBe(0.1);
  });
  it('labels every decision in plain words', () => {
    expect(DECISION_LABEL.M.text).toBe('Likely misspecified');
    expect(DECISION_LABEL['EPC:M'].cls).toBe('bad');
    expect(DECISION_LABEL['EPC:NM'].text).toMatch(/no change needed/);
    expect(DECISION_LABEL.NM.cls).toBe('good');
    expect(DECISION_LABEL.I.text).toMatch(/power/);
  });
});

describe('judgeMis', () => {
  const rows: MisfitMi[] = [
    { lhs: 'visual', op: '=~', rhs: 'x9', mi: 36.411, epc: 0.577, sepc: 0.515 },
    { lhs: 'x7', op: '~~', rhs: 'x8', mi: 34.145, epc: 0.536, sepc: 0.859 },
    { lhs: 'x4', op: '~~', rhs: 'x6', mi: 6.22, epc: -0.235, sepc: -0.646 },
  ];
  it('ranks by |SEPC|, not by MI, and judges each row', () => {
    const j = judgeMis(rows);
    expect(j.map((m) => `${m.lhs}${m.op}${m.rhs}`)).toEqual(['x7~~x8', 'x4~~x6', 'visual=~x9']);
    expect(j[2].delta).toBe(0.4);
    expect(j[2].decision).toBe('EPC:M');
    expect(j[0].power).toBeGreaterThan(0);
  });
  it('keeps the given order for equal |SEPC| (a stable sort)', () => {
    const tie: MisfitMi[] = [
      { lhs: 'a', op: '~~', rhs: 'b', mi: 1, epc: 1, sepc: 0.3 },
      { lhs: 'c', op: '~~', rhs: 'd', mi: 9, epc: 1, sepc: -0.3 },
    ];
    expect(judgeMis(tie).map((m) => m.lhs)).toEqual(['a', 'c']);
  });
});

describe('parseMisfit', () => {
  it('keeps well-formed rows and drops the rest', () => {
    const r = parseMisfit({
      mi: [
        { lhs: 'x7', op: '~~', rhs: 'x8', mi: 34.1, epc: 0.5, sepc: 0.86, group: 'Pasteur' },
        { lhs: 'x1', op: '~1', rhs: '', mi: 3, epc: 1, sepc: 1 },
        { lhs: 'x2', op: '~~', rhs: 'x3', mi: null, epc: 1, sepc: 1 },
      ],
      miCount: 54,
      residuals: [{ group: 'Pasteur', pairs: [{ a: 'x1', b: 'x9', r: 0.2, z: 4.1 }] }],
      code: ['mi_all <- modindices(fit)'],
    })!;
    expect(r.mi).toHaveLength(1);
    expect(r.mi[0].group).toBe('Pasteur');
    expect(r.miCount).toBe(54);
    expect(r.residuals[0].pairs[0]).toEqual({ a: 'x1', b: 'x9', r: 0.2, z: 4.1 });
    expect(r.code).toEqual(['mi_all <- modindices(fit)']);
  });
  it('reads a single object as a list of one (R’s auto-unboxing) and a missing z as null', () => {
    const r = parseMisfit({
      mi: { lhs: 'a', op: '=~', rhs: 'b', mi: 5, epc: 1, sepc: 0.5 },
      residuals: { pairs: { a: 'b', b: 'c', r: 0.1 } },
      code: 'x',
    })!;
    expect(r.mi).toHaveLength(1);
    expect(r.miCount).toBe(1);
    expect(r.residuals[0].pairs[0].z).toBeNull();
  });
  it('passes lavaan’s error on', () => {
    expect(parseMisfit({ error: 'no df', code: ['x'] })).toEqual({
      mi: [],
      miCount: 0,
      residuals: [],
      code: ['x'],
      error: 'no df',
    });
    expect(parseMisfit(null)).toBeUndefined();
  });
  it('renames groups', () => {
    const r = misfitWithGroupNames(
      {
        mi: [{ lhs: 'a', op: '~~', rhs: 'b', mi: 1, epc: 1, sepc: 1, group: '1' }],
        miCount: 1,
        residuals: [{ group: '1', pairs: [] }],
        code: [],
      },
      (g) => (g === '1' ? 'Girls' : g),
    );
    expect(r.mi[0].group).toBe('Girls');
    expect(r.residuals[0].group).toBe('Girls');
  });
});

describe('poorFitIndices (Hu & Bentler 1999 guideline cutoffs)', () => {
  it('flags CFI below .95, RMSEA above .06 and SRMR above .08', () => {
    expect(poorFitIndices({ cfi: 0.931, rmsea: 0.092, srmr: 0.065 })).toEqual(['CFI', 'RMSEA']);
    expect(poorFitIndices({ cfi: 0.96, rmsea: 0.05, srmr: 0.09 })).toEqual(['SRMR']);
    expect(poorFitIndices({ cfi: 0.95, rmsea: 0.06, srmr: 0.08 })).toEqual([]);
    expect(poorFitIndices({ cfi: Number.NaN, rmsea: Number.NaN, srmr: Number.NaN })).toEqual([]);
  });
});
