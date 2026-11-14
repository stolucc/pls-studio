// The guided invariance card's verdicts (guidedInvarianceLogic.ts): Chen's (2007) cut-offs, the ordinal rule led by
// the scaled Δχ² test (Sass, Schmitt & Marsh 2014), the overall guidance and the notes on fit indices.

import { describe, expect, it } from 'vitest';
import type { GuidedStep } from '../rengine/invariance';
import {
  anchorsPerFactor,
  chenCutoffs,
  chenFlags,
  describeCandidate,
  fitNotes,
  guidance,
  passes,
  stepTitle,
  stepVerdict,
} from './guidedInvarianceLogic';

const step = (over: Partial<GuidedStep>): GuidedStep => ({
  step: 'metric',
  converged: true,
  freed: [],
  candidates: [],
  chisq: 100,
  df: 50,
  cfi: 0.95,
  rmsea: 0.05,
  srmr: 0.05,
  cfiChange: 0,
  rmseaChange: 0,
  srmrChange: 0,
  chisqDiff: 5,
  dfDiff: 6,
  p: 0.5,
  ...over,
});
const configural = step({
  step: 'configural',
  cfiChange: undefined,
  rmseaChange: undefined,
  srmrChange: undefined,
  chisqDiff: undefined,
  dfDiff: undefined,
  p: undefined,
});

describe('Chen’s cut-offs', () => {
  it('uses .030 for SRMR with loadings and .010 for intercepts, thresholds and residuals', () => {
    expect(chenCutoffs('metric')).toEqual({ cfi: -0.01, rmsea: 0.015, srmr: 0.03 });
    expect(chenCutoffs('scalar').srmr).toBe(0.01);
    expect(chenCutoffs('thresholds').srmr).toBe(0.01);
    expect(chenCutoffs('strict').srmr).toBe(0.01);
  });
  it('needs the CFI drop together with RMSEA or SRMR', () => {
    expect(chenFlags(step({ cfiChange: -0.01, rmseaChange: 0.015 }))).toEqual({
      cfi: true,
      chen: true,
    });
    expect(chenFlags(step({ cfiChange: -0.01, srmrChange: 0.03 })).chen).toBe(true);
    expect(chenFlags(step({ cfiChange: -0.01, srmrChange: 0.029 })).chen).toBe(false);
    expect(chenFlags(step({ step: 'scalar', cfiChange: -0.01, srmrChange: 0.01 })).chen).toBe(true);
    expect(chenFlags(step({ cfiChange: -0.009, rmseaChange: 0.05 }))).toEqual({
      cfi: false,
      chen: false,
    });
  });
});

describe('step verdicts, continuous items', () => {
  it('the configural model is the baseline, an unconverged model is not estimated', () => {
    expect(stepVerdict(configural, false).verdict).toBe('reference');
    expect(stepVerdict(step({ converged: false }), false).verdict).toBe('failedToFit');
    expect(stepVerdict(step({ p: undefined }), false).verdict).toBe('failedToFit');
  });
  it('holds when neither the test nor CFI objects', () => {
    expect(stepVerdict(step({ p: 0.3, cfiChange: -0.002 }), false).verdict).toBe('holds');
  });
  it('holds by the fit indices when only the test is significant (large samples)', () => {
    const v = stepVerdict(step({ p: 0.001, cfiChange: -0.004 }), false);
    expect(v.verdict).toBe('holds');
    expect(v.why).toMatch(/large samples/);
  });
  it('fails when Chen’s criteria are met', () => {
    expect(
      stepVerdict(step({ p: 0.001, cfiChange: -0.02, rmseaChange: 0.02 }), false).verdict,
    ).toBe('fails');
  });
  it('is unclear when CFI drops but RMSEA and SRMR do not', () => {
    expect(
      stepVerdict(step({ p: 0.001, cfiChange: -0.02, rmseaChange: 0.001 }), false).verdict,
    ).toBe('mixed');
    expect(stepVerdict(step({ p: 0.2, cfiChange: -0.02 }), false).verdict).toBe('mixed');
  });
  it('a step equivalent to the one before is not a test', () => {
    expect(stepVerdict(step({ step: 'thresholds', equivalent: true }), true).verdict).toBe(
      'equivalent',
    );
  });
});

describe('step verdicts, ordinal items (the scaled Δχ² test leads)', () => {
  it('holds when the scaled test is not significant, whatever CFI does', () => {
    expect(stepVerdict(step({ p: 0.2, cfiChange: -0.03, rmseaChange: 0.03 }), true).verdict).toBe(
      'holds',
    );
  });
  it('is unclear when the test is significant but CFI barely changes', () => {
    const v = stepVerdict(step({ p: 0.01, cfiChange: -0.003 }), true);
    expect(v.verdict).toBe('mixed');
    expect(v.why).toMatch(/Sass, Schmitt & Marsh 2014/);
  });
  it('fails when the test is significant and CFI drops by .010', () => {
    expect(stepVerdict(step({ p: 0.01, cfiChange: -0.01 }), true).verdict).toBe('fails');
  });
});

describe('guidance', () => {
  it('goes through when every step holds and lets the means be compared', () => {
    const r = {
      ordinal: false,
      steps: [configural, step({ step: 'metric' }), step({ step: 'scalar' })],
    };
    const g = guidance(r, true);
    expect(g).toMatchObject({ stuckAt: null, reached: 'scalar', meansOk: true });
    expect(g.next).toMatch(/latent means can be compared/);
    expect(guidance(r, false).meansOk).toBe(false);
  });
  it('stops at the first failing step and names its largest score test', () => {
    const scalar = step({
      step: 'scalar',
      p: 0.0001,
      cfiChange: -0.03,
      rmseaChange: 0.03,
      candidates: [{ kind: 'intercept', item: 'x3', x2: 20, df: 1, p: 1e-5, test: 'score' }],
    });
    const g = guidance({ ordinal: false, steps: [configural, step({}), scalar] }, true);
    expect(g).toMatchObject({ stuckAt: 2, reached: 'metric', meansOk: false });
    expect(g.next).toContain('the intercept of x3');
    expect(g.next).toContain('substantive reason');
  });
  it('says when a model did not converge and when nothing is left to free', () => {
    const g = guidance({ ordinal: true, steps: [configural, step({ converged: false })] }, true);
    expect(g.next).toMatch(/did not converge/);
    const bad = step({ p: 0.001, cfiChange: -0.05, rmseaChange: 0.05 });
    expect(guidance({ ordinal: false, steps: [configural, bad] }, true).next).toMatch(
      /no parameter left/,
    );
  });
  it('keeps the means comparable when only the strict step fails', () => {
    const strict = step({ step: 'strict', p: 0.001, cfiChange: -0.05, rmseaChange: 0.05 });
    const g = guidance(
      { ordinal: false, steps: [configural, step({}), step({ step: 'scalar' }), strict] },
      true,
    );
    expect(g).toMatchObject({ stuckAt: 3, meansOk: true });
    expect(g.next).toMatch(/can still be compared/);
  });
  it('passes the steps that do not block the sequence', () => {
    expect(['holds', 'equivalent', 'reference'].every((v) => passes(v as never))).toBe(true);
    expect(['mixed', 'fails', 'failedToFit'].some((v) => passes(v as never))).toBe(false);
  });
});

describe('partial invariance anchors (Byrne, Shavelson & Muthén 1989)', () => {
  it('counts the items whose loading and intercept are both still equal; residuals do not count', () => {
    const fs = [
      { name: 'A', indicators: ['a1', 'a2', 'a3'] },
      { name: 'B', indicators: ['b1', 'b2'] },
    ];
    const freed = [
      { item: 'a1', kind: 'loading' },
      { item: 'a1', kind: 'intercept' },
      { item: 'b2', kind: 'threshold' },
      { item: 'a2', kind: 'residual' },
    ];
    expect(anchorsPerFactor(fs, freed)).toEqual([
      { factor: 'A', anchors: 2 },
      { factor: 'B', anchors: 1 },
    ]);
  });
});

describe('wording', () => {
  it('names steps and parameters', () => {
    expect(stepTitle('metric', true)).toBe('Metric (thresholds + loadings)');
    expect(stepTitle('metric', false)).toBe('Metric (loadings)');
    expect(describeCandidate({ kind: 'loading', item: 'x2', factor: 'F' })).toBe(
      'the loading of x2 on F',
    );
    expect(describeCandidate({ kind: 'threshold', item: 'u3', threshold: 2 })).toBe(
      'threshold 2 of u3',
    );
    expect(describeCandidate({ kind: 'residual', item: 'u3' })).toBe('the residual variance of u3');
  });
});

describe('fit notes', () => {
  it('warns when the robust indices are missing and when CFI or RMSEA improve with constraints', () => {
    const steps = [
      { ...configural, cfiKind: 'scaled' as const },
      step({ cfiChange: 0.002, rmseaChange: -0.01, cfiKind: 'scaled' }),
    ];
    const notes = fitNotes({ estimator: 'WLSMV', steps });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/no robust CFI/);
    expect(notes[1]).toMatch(/improves at metric/);
  });
  it('says nothing for ML, or for robust indices that worsen', () => {
    const steps = [{ ...configural, cfiKind: 'robust' as const }, step({ cfiChange: -0.001 })];
    expect(fitNotes({ estimator: 'MLR', steps })).toEqual([]);
    expect(fitNotes({ estimator: 'ML', steps: [configural, step({ cfiChange: 0.01 })] })).toEqual(
      [],
    );
  });
});
