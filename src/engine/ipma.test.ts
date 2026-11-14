// IPMA is not defined for models with interaction terms: a three-way interaction gets the same
// clear message as a two-way one (it used to fail with a TypeError).

import { describe, expect, it } from 'vitest';
import { ipma } from './ipma';
import { mulberry32 } from './stats';
import type { Dataset, ModelSpec } from './types';

function data(): Dataset {
  const rnd = mulberry32(5);
  const g = () => {
    const u = rnd() || 1e-9;
    const v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const names: string[] = [];
  const cols: Float64Array[] = [];
  for (const c of ['x', 'm', 'w', 'y'])
    for (let k = 0; k < 2; k++) {
      names.push(`${c}${k}`);
      cols.push(Float64Array.from({ length: 150 }, g));
    }
  return { names, cols };
}

const block = (name: string, prefix: string) => ({
  name,
  mode: 'A' as const,
  indicators: [`${prefix}0`, `${prefix}1`],
});
const constructs = [block('X', 'x'), block('M', 'm'), block('W', 'w'), block('Y', 'y')];

describe('IPMA with interaction terms', () => {
  it('refuses a three-way interaction with a clear message', () => {
    const spec: ModelSpec = {
      constructs,
      paths: [{ from: 'X', to: 'Y' }],
      threeWay: [{ from: 'X', moderator: 'M', moderator2: 'W', to: 'Y' }],
    };
    expect(() => ipma(data(), spec, {}, { target: 'Y', rescale: true })).toThrow(
      'IPMA is not defined for models with interaction or copula terms.',
    );
  });

  it('still runs without terms', () => {
    const spec: ModelSpec = {
      constructs: constructs.filter((k) => k.name !== 'W'),
      paths: [
        { from: 'X', to: 'Y' },
        { from: 'M', to: 'Y' },
      ],
    };
    expect(ipma(data(), spec, {}, { target: 'Y', rescale: true }).target).toBe('Y');
  });
});
