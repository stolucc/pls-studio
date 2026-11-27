// The basis set of a path model (dsep.ts): which pairs make claims, what each is conditioned on, and which models
// have no basis set of this kind. The tests in the data: examples/cards/dsep.webr.test.ts against piecewiseSEM.

import { describe, expect, it } from 'vitest';
import { basisSet, dsepProblem } from './dsep';
import type { ModelState } from './project';

const obs = (name: string) => ({
  id: name,
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: [name],
  x: 0,
  y: 0,
  side: 'left' as const,
});
const model = (names: string[], paths: [string, string][], over: Partial<ModelState> = {}) =>
  ({
    constructs: names.map(obs),
    paths: paths.map(([from, to], i) => ({ id: `p${i}`, from, to })),
    moderations: [],
    ...over,
  }) as ModelState;

// Bollen's union sentiment model (packages.ts: bollen-union-dsep)
const union = model(
  ['age', 'yrsmill', 'deferenc', 'laboract', 'unionsen'],
  [
    ['age', 'deferenc'],
    ['age', 'laboract'],
    ['deferenc', 'laboract'],
    ['deferenc', 'unionsen'],
    ['laboract', 'unionsen'],
    ['yrsmill', 'unionsen'],
  ],
);

describe('the basis set of a path model', () => {
  it('claims one independence per unjoined pair, given the parents of both', () => {
    expect(dsepProblem(union)).toBeNull();
    expect(basisSet(union)).toEqual([
      { x: 'age', y: 'unionsen', given: ['yrsmill', 'deferenc', 'laboract'] },
      { x: 'yrsmill', y: 'deferenc', given: ['age'] },
      { x: 'yrsmill', y: 'laboract', given: ['age', 'deferenc'] },
    ]);
  });

  it('orders each pair causally, whatever the drawing’s order', () => {
    const chain = model(
      ['c', 'b', 'a'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    );
    expect(basisSet(chain)).toEqual([{ x: 'a', y: 'c', given: ['b'] }]);
  });

  it('two exogenous variables make a claim only when their covariance is fixed at zero', () => {
    const fork = model(
      ['x1', 'x2', 'y'],
      [
        ['x1', 'y'],
        ['x2', 'y'],
      ],
    );
    expect(basisSet(fork)).toEqual([]);
    const zero = {
      ...fork,
      correlations: [{ id: 'r', kind: 'construct' as const, a: 'x1', b: 'x2', zero: true }],
    };
    expect(basisSet(zero)).toEqual([{ x: 'x1', y: 'x2', given: [] }]);
  });

  it('has none for latent factors, correlated disturbances, cycles, moderation or groups', () => {
    const latent = { ...union, constructs: [{ ...obs('f'), indicators: ['a', 'b'] }] };
    expect(dsepProblem(latent)).toMatch(/single observed variable/);
    const disturbances = {
      ...union,
      correlations: [{ id: 'r', kind: 'construct' as const, a: 'laboract', b: 'unionsen' }],
    };
    expect(dsepProblem(disturbances)).toMatch(/correlated disturbances/);
    const cycle = model(
      ['a', 'b'],
      [
        ['a', 'b'],
        ['b', 'a'],
      ],
    );
    expect(dsepProblem(cycle)).toMatch(/cycle/);
    expect(basisSet(cycle)).toEqual([]);
    expect(dsepProblem({ ...union, moderations: [{} as never] })).toMatch(/moderation/);
    expect(dsepProblem({ ...union, multigroup: {} as never })).toMatch(/groups/);
    // (exogenous covariances are no problem)
    const exo = {
      ...union,
      correlations: [{ id: 'r', kind: 'construct' as const, a: 'age', b: 'yrsmill' }],
    };
    expect(dsepProblem(exo)).toBeNull();
  });
});
