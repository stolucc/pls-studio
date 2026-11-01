import { describe, expect, it } from 'vitest';
import { momentsOfGroups, pooledMoments } from './moments';

describe('several groups of summary statistics', () => {
  const a = { label: 'a', S: [[1, 0.5], [0.5, 2]], n: 11 };
  const b = { label: 'b', S: [[3, 0], [0, 4]], n: 21 };
  it('pools the matrices with weights N − 1 and adds the Ns', () => {
    const p = pooledMoments([a, b]);
    expect(p.n).toBe(32);
    expect(p.S[0][0]).toBeCloseTo((10 * 1 + 20 * 3) / 30, 12);
    expect(p.S[0][1]).toBeCloseTo((10 * 0.5) / 30, 12);
    expect(p.S[1][1]).toBeCloseTo((10 * 2 + 20 * 4) / 30, 12);
    expect(pooledMoments([a]).S).toEqual(a.S);
    expect(() => pooledMoments([])).toThrow(/No groups/);
  });
  it('pools the means weighted by N when every group has them', () => {
    const p = pooledMoments([{ ...a, means: [1, 2] }, { ...b, means: [4, 5] }]);
    expect(p.means![0]).toBeCloseTo((11 * 1 + 21 * 4) / 32, 12);
    expect(pooledMoments([{ ...a, means: [1, 2] }, b]).means).toBeUndefined();
  });
  it('keeps the groups next to the pooled matrix', () => {
    const m = momentsOfGroups([a, b]);
    expect(m.groups).toEqual([a, b]);
    expect(m.n).toBe(32);
  });
});
