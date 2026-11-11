// The EQS manual examples: valid CB-SEM projects on the matrices its example
// inputs print (their fit against native lavaan and EQS is in the webR test).

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec, validateModel } from '../model/project';
import {
  BAGOZZI_S,
  HEADSTART_GROUPS,
  makeBagozziExample,
  makeHeadStartExample,
  makeHeadStartGroupsExample,
  makeOlssonExample,
  makeWertsExample,
  OLSSON_GROUPS,
  WERTS_GROUPS,
} from './eqs';

const every = {
  bagozzi: makeBagozziExample(DEFAULT_SETTINGS),
  werts: makeWertsExample(DEFAULT_SETTINGS),
  headStart: makeHeadStartExample(DEFAULT_SETTINGS),
  headStartGroups: makeHeadStartGroupsExample(DEFAULT_SETTINGS),
  olsson: makeOlssonExample(DEFAULT_SETTINGS),
};

describe('EQS manual examples', () => {
  it('carry the printed data', () => {
    expect(BAGOZZI_S[7][0]).toBeCloseTo(-0.357 * 3.65 * 2.09, 9);
    expect(WERTS_GROUPS.map((g) => [g.n, g.S[3][3]])).toEqual([
      [865, 32.295],
      [900, 35.403],
    ]);
    expect(HEADSTART_GROUPS.map((g) => [g.label, g.n, g.means[4]])).toEqual([
      ['Head Start', 148, 19.672],
      ['Control', 155, 20.415],
    ]);
    expect(OLSSON_GROUPS.map((g) => [g.n, g.means[2]])).toEqual([
      [105, 20.4],
      [108, 25.667],
    ]);
  });
  it('every example is a valid CB-SEM project, laid out, fitted with N − 1 by lavaan as EQS', () => {
    for (const [k, ex] of Object.entries(every)) {
      expect(
        validateModel(ex.model, ex.data, ex.settings).filter((i) => i.level === 'error'),
        k,
      ).toEqual([]);
      expect(ex.settings, k).toMatchObject({ method: 'cbsem', estimator: 'ML', engine: 'r' });
      expect(ex.model.likelihood, k).toBe('wishart');
      expect(
        new Set(ex.model.constructs.map((c) => `${c.x},${c.y}`)).size,
        `${k}: constructs overlap`,
      ).toBe(ex.model.constructs.length);
    }
    expect(every.werts.model.multigroup).toMatchObject({
      invariance: 'metric',
      structural: ['lv.variances', 'lv.covariances'],
      meanStructure: false,
    });
    expect(every.headStartGroups.model.multigroup).toMatchObject({
      invariance: 'scalar',
      structural: ['regressions'],
    });
    expect(every.olsson.model.multigroup).toMatchObject({
      invariance: 'scalar',
      structural: ['regressions'],
    });
    // Bagozzi: performance is an error-free single indicator with two predictors, and it predicts job satisfaction.
    const spec = toSpec(every.bagozzi.model);
    expect(
      spec.paths
        .filter((p) => p.to === 'perform')
        .map((p) => p.from)
        .sort(),
    ).toEqual(['Self-esteem', 'verbalIQ']);
    expect(spec.paths.filter((p) => p.from === 'perform').map((p) => p.to)).toEqual([
      'Job satisfaction',
    ]);
    expect(spec.constructs.find((c) => c.name === 'perform')!.freeError).toBeUndefined();
  });
});
