// The analysis plan against PROCESS: the same indirect paths, and an index
// of moderated mediation exactly where PROCESS reports one, of the same kind.

import { describe, expect, it } from 'vitest';
import { indexFor, indirectPaths, planFor } from './plan';
import { materialise, template } from './templates';

interface Reference {
  model: number;
  mediators: string[];
  w: boolean;
  z: boolean;
  indirect: { path: string[] }[];
  indices: { kind: string; path: string[] }[];
}

const fixtures = import.meta.glob<Reference>('./__fixtures__/reference/model*.json', {
  eager: true,
  import: 'default',
});
const references = Object.values(fixtures).sort((a, b) => a.model - b.model);
const graphOf = (r: Reference) =>
  materialise(template(r.model)!, {
    x: 'x',
    y: 'y',
    m: r.mediators,
    w: r.w ? 'w' : undefined,
    z: r.z ? 'z' : undefined,
  });

const KIND: Record<string, string> = {
  'Index of moderated mediation': 'mm',
  'Indices of partial moderated mediation': 'partial',
  'Index of moderated moderated mediation': 'mmm',
  'Indices of conditional moderated mediation by W': 'mmm',
};

describe('conditional process plan', () => {
  // Model 74 (XMINT) reports counterfactual effects instead of indirect paths.
  const withPaths = references.filter((r) => r.indirect.length > 0);

  it.each(withPaths.map((r) => [r.model, r] as const))(
    'model %i: indirect paths and indices as PROCESS',
    (_, r) => {
      const g = graphOf(r);
      const key = (p: string[]) => p.join('>');
      expect(indirectPaths(g).map(key).sort()).toEqual(r.indirect.map((i) => key(i.path)).sort());
      for (const path of indirectPaths(g)) {
        const theirs = [
          ...new Set(r.indices.filter((i) => key(i.path) === key(path)).map((i) => KIND[i.kind])),
        ];
        expect(theirs.every(Boolean), `unknown index kind in ${r.indices.map((i) => i.kind)}`).toBe(
          true,
        );
        expect(indexFor(g, path, ['w', 'z'])?.kind ?? null, key(path)).toBe(theirs[0] ?? null);
      }
    },
  );

  it('plans equations, probing, direct effect and Johnson–Neyman edges', () => {
    const plan = planFor(materialise(template(8)!, { x: 'x', y: 'y', m: ['m'], w: 'w' }), ['age']);
    expect(plan.equations.map((e) => e.outcome)).toEqual(['m', 'y']);
    expect(plan.equations[0].terms).toEqual([['x'], ['w'], ['w', 'x'], ['age']]);
    expect(plan.moderators).toEqual(['w']);
    expect(plan.direct).toEqual({ moderators: ['w'] });
    expect(plan.indirect).toEqual([
      { vars: ['x', 'm', 'y'], moderators: ['w'], index: { kind: 'mm', w: 'w' } },
    ]);
    expect(plan.jn).toEqual([
      { from: 'x', to: 'm', moderator: 'w' },
      { from: 'x', to: 'y', moderator: 'w' },
    ]);
    // A three-way term has no single-moderator Johnson–Neyman region.
    expect(
      planFor(materialise(template(3)!, { x: 'x', y: 'y', m: [], w: 'w', z: 'z' })).jn,
    ).toEqual([]);
  });

  it('orders W before Z as given', () => {
    const g = materialise(template(21)!, { x: 'x', y: 'y', m: ['m'], w: 'b', z: 'a' });
    expect(planFor(g, [], ['b', 'a']).indirect[0].index).toEqual({ kind: 'mmm', w: 'b', z: 'a' });
    expect(planFor(g, [], ['b', 'a']).moderators).toEqual(['b', 'a']);
  });
});
