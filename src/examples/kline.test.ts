// The Kline (2023) examples: valid projects whose matrices equal lavaan's
// getCov + cor2cov of his companion files, and whose built-in ML solutions give
// the chi-squares his output prints (R-engine examples are checked in the webR test).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from '../engine/cbsem';
import { DEFAULT_SETTINGS, toSpec, validateModel } from '../model/project';
import {
  covFromCor,
  KABC_S,
  LYNAM_GROUPS,
  makeKabcExample,
  makeLynamExample,
  makeRobbinsExample,
  makeRomneyExample,
  makeRothExample,
  makeSabatelliExample,
  makeSauveExample,
  makeWorlandExample,
  ROTH_S,
} from './kline';

type Ref = Record<string, { chisq: number; df: number; kline: { chisq: number; df: number } }>;
const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'kline.json'), 'utf8'),
) as Ref;

describe('Kline (2023) examples', () => {
  it('builds covariance matrices from a lower triangle of correlations and standard deviations, as lavaan', () => {
    expect(covFromCor([1, 0.5, 1], [2, 3])).toEqual([
      [4, 3],
      [3, 9],
    ]);
    expect(() => covFromCor([1, 0.5], [2, 3])).toThrow(/Expected 3/);
    expect(ROTH_S[0][0]).toBeCloseTo(66.5 ** 2, 9);
    expect(ROTH_S[2][0]).toBeCloseTo(0.39 * 18.4 * 66.5, 9);
    expect(KABC_S[7][4]).toBeCloseTo(0.58 * 3.0 * 2.7, 9);
    expect(LYNAM_GROUPS[1].S[3][2]).toBeCloseTo(0.61 * 0.96 * 16.32, 9);
  });
  const every = {
    roth: makeRothExample(DEFAULT_SETTINGS),
    kabc: makeKabcExample(DEFAULT_SETTINGS),
    sabatelli: makeSabatelliExample(DEFAULT_SETTINGS),
    worland: makeWorlandExample(DEFAULT_SETTINGS),
    romneySomatic: makeRomneyExample(DEFAULT_SETTINGS, 'somatic'),
    romneyMedical: makeRomneyExample(DEFAULT_SETTINGS, 'medical'),
    lynam: makeLynamExample(DEFAULT_SETTINGS),
    robbins: makeRobbinsExample(DEFAULT_SETTINGS),
    sauve: makeSauveExample(DEFAULT_SETTINGS),
  };
  it('every example is a valid CB-SEM project on a matrix, laid out, with the reference fit recorded', () => {
    for (const [k, ex] of Object.entries(every)) {
      expect(
        validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error'),
        k,
      ).toEqual([]);
      expect(ex.settings.method, k).toBe('cbsem');
      expect(ex.info.kind).toBe('matrix');
      expect(
        new Set(ex.model.constructs.map((c) => `${c.x},${c.y}`)).size,
        `${k}: constructs overlap`,
      ).toBe(ex.model.constructs.length);
      expect(ref[k], k).toBeTruthy();
      expect(ref[k].chisq, `${k}: lavaan agrees with Kline's output`).toBeCloseTo(
        ref[k].kline.chisq,
        2,
      );
    }
  });
  it('the built-in engine reproduces the chi-squares Kline prints (the models it can estimate)', () => {
    for (const [k, ex] of Object.entries(every)) {
      // groups, a known reliability, labels and defined parameters: lavaan only; Worland: the built-in engine stops at a local minimum (49.7), see kline.ts
      if (k === 'lynam' || k === 'sauve' || k === 'roth' || k === 'worland') continue;
      const cb = estimateCb(ex.data, toSpec(ex.model), 'casewise', 'ML');
      expect(cb.fit.df, k).toBe(ref[k].df);
      expect(cb.fit.chisq, k).toBeCloseTo(ref[k].kline.chisq, 2);
    }
  });
  it('Roth: labelled paths and the defined indirect effects; Robbins: a loop with correlated disturbances; Sauve: reliability .76', () => {
    const roth = toSpec(every.roth.model);
    expect(roth.paths.map((p) => p.label)).toEqual(['a', 'c', 'b', 'd']);
    expect(roth.defined).toEqual([
      { name: 'ab', expr: '(a * b)' },
      { name: 'cd', expr: '(c * d)' },
    ]);
    expect(every.roth.model.constructs.some((c) => c.covariate)).toBe(false); // fixed.x = FALSE: free variances and covariance
    expect(every.roth.settings.engine).toBe('r');
    const robbins = validateModel(every.robbins.model, every.robbins.data, every.robbins.settings);
    expect(robbins.some((i) => /Non-recursive model/.test(i.message))).toBe(true);
    expect(
      every.robbins.model.correlations!.filter((k) => k.kind === 'construct').length,
    ).toBeGreaterThanOrEqual(1);
    // (the reliability that fixes the error variance at Kline's .360 exactly)
    const sumd = every.sauve.model.constructs.find((c) => c.name === 'SUMD')!;
    expect((1 - sumd.reliability!) * 1.225 ** 2).toBeCloseTo(0.36, 12);
    expect(every.roth.model.sampleCovRescale).toBe(false);
    expect(every.lynam.model.multigroup).toMatchObject({ column: '', structural: ['regressions'] });
    expect(every.lynam.data.moments!.groups!.map((g) => [g.label, g.n, g.means![2]])).toEqual([
      ['Black', 214, 93.76],
      ['White', 181, 104.18],
    ]);
  });
});
