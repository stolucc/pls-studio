// The Brown (2015) examples: valid projects, matrices from his companion files,
// and the built-in engine's chi-squares equal to native lavaan's (brown.json).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from '../engine/cbsem';
import { DEFAULT_SETTINGS, toSpec, validateModel } from '../model/project';
import {
  makeBrownCopingExample,
  makeBrownMtmmExample,
  makeBrownNeExample,
  makeBrownReliabilityExample,
  makeBrownStressExample,
  makeBrownTauExample,
  NE_S,
  STRESS_S,
} from './brown';

type Ref = Record<string, { chisq: number; df: number }>;
const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'brown.json'), 'utf8'),
) as Ref;
const every = {
  ne: makeBrownNeExample(DEFAULT_SETTINGS),
  tau: makeBrownTauExample(DEFAULT_SETTINGS),
  mtmm: makeBrownMtmmExample(DEFAULT_SETTINGS),
  coping: makeBrownCopingExample(DEFAULT_SETTINGS),
  reliability: makeBrownReliabilityExample(DEFAULT_SETTINGS),
  stress: makeBrownStressExample(DEFAULT_SETTINGS),
};

describe('Brown (2015) examples', () => {
  it('the matrices are the companion files’ correlations scaled by the standard deviations', () => {
    expect(NE_S[0][0]).toBeCloseTo(5.7 ** 2, 9);
    expect(NE_S[4][0]).toBeCloseTo(-0.351 * 6.0 * 5.7, 9);
    expect(STRESS_S[8][6]).toBeCloseTo(0.448 * 1.2 * 1.2, 9);
  });
  it('every example is a valid CB-SEM project with the fixture’s degrees of freedom and chi-square under the built-in engine', () => {
    for (const [k, ex] of Object.entries(every)) {
      expect(
        validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error'),
        k,
      ).toEqual([]);
      // (the stress model's free second-order loadings are lavaan's: the built-in engine is refused, checked in webR)
      if (k === 'stress') {
        expect(
          validateModel(ex.model, ex.data, { ...ex.settings, engine: 'builtin' }).some(
            (i) => i.level === 'error' && /estimated by lavaan/.test(i.message),
          ),
        ).toBe(true);
        continue;
      }
      const cb = estimateCb(ex.data, toSpec(ex.model), 'casewise', 'ML');
      expect(cb.fit.df, k).toBe(ref[k].df);
      expect(cb.fit.chisq, k).toBeCloseTo(ref[k].chisq, 2);
    }
  });
  it('the specifications: tau equivalence by fixed loadings, the MTMM errors, two second-order factors, a formative construct with a fixed cause', () => {
    expect(every.tau.model.constructs[0].fixedLoadings).toEqual({ X2: 1, X3: 1 });
    expect(ref.tau.df - ref.tauFree.df).toBe(2);
    expect(every.mtmm.model.correlations!.filter((k) => k.kind === 'indicator').length).toBe(9);
    expect(
      every.coping.model.constructs.filter((c) => c.components?.length).map((c) => c.name),
    ).toEqual(['ProblemFocused', 'EmotionFocused']);
    const stress = every.stress.model;
    expect(stress.constructs.filter((c) => c.covariate).map((c) => c.name)).toEqual([
      'X1',
      'X2',
      'X3',
    ]);
    expect(stress.paths.map((p) => p.fixed)).toEqual([1, undefined, undefined]);
    expect(stress.constructs.find((c) => c.name === 'Stress')!.components!.length).toBe(2);
    // Brown's input frees both second-order loadings (STRESS BY SATIS* OPTIM): the scale comes from X1@1 only.
    expect(stress.constructs.find((c) => c.name === 'Stress')!.markerFree).toBe(true);
    expect(toSpec(stress).constructs.find((c) => c.name === 'Stress')!.markerFree).toBe(true);
  });
});
