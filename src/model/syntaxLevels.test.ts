// Two-level lavaan syntax (level: 1 / level: 2 blocks): the within level becomes the diagram, the between level is
// kept as written (ModelState.multilevel.betweenModel), and a saved project keeps only well-formed statements.

import { describe, expect, it } from 'vitest';
import { parseBetweenModel, parseModelState, toSpec } from './project';
import { parseLavaanSyntax } from './syntax';

const TWO_LEVEL = `
level: 1
  y ~ g10*x
level: 2
  y ~ w + g01*x
  fb =~ y1 + 0.5*y2 + y3
  y1 ~~ 0*y1
  fb ~ 1
betac := g01 - g10
`;

describe('two-level syntax', () => {
  it('reads the within level as the diagram and keeps the between level as written', () => {
    const { model, warnings } = parseLavaanSyntax(TWO_LEVEL);
    expect(warnings).toEqual([]);
    expect(model.constructs.map((c) => c.name).sort()).toEqual(['x', 'y']);
    expect(model.paths).toHaveLength(1);
    expect(model.paths[0].label).toBe('g10');
    // (defined parameters belong to the whole model, wherever they are written)
    expect(model.defined?.map((d) => [d.name, d.expr])).toEqual([['betac', 'g01 - g10']]);
    expect(model.multilevel).toEqual({
      column: '', between: 'model', betweenModel: [
        { lhs: 'y', op: '~', rhs: [{ name: 'w' }, { name: 'x', label: 'g01' }] },
        { lhs: 'fb', op: '=~', rhs: [{ name: 'y1' }, { name: 'y2', fixed: 0.5 }, { name: 'y3' }] },
        { lhs: 'y1', op: '~~', rhs: [{ name: 'y1', fixed: 0 }] },
        { lhs: 'fb', op: '~1', rhs: [{ name: '1' }] },
      ],
    });
  });

  it('passes the between level to the request; labels used only between clusters count as labels', () => {
    const { model } = parseLavaanSyntax(TWO_LEVEL);
    const spec = toSpec({ ...model, multilevel: { ...model.multilevel!, column: 'clus' } });
    expect(spec.multilevel?.between).toBe('model');
    expect(spec.multilevel?.betweenModel).toHaveLength(4);
    // betac := g01 - g10 is valid: g01 is a label of the between level
    expect(spec.defined).toEqual([{ name: 'betac', expr: '(g01 - g10)' }]);
  });

  it('without level blocks nothing changes; a third level is refused', () => {
    expect(parseLavaanSyntax('y ~ x').model.multilevel).toBeUndefined();
    expect(() => parseLavaanSyntax('level: 1\ny ~ x\nlevel: 3\ny ~ z')).toThrow(/two levels/);
  });

  it('an empty between level is saturated', () => {
    expect(parseLavaanSyntax('level: 1\ny ~ x\nlevel: 2\n').model.multilevel).toEqual({ column: '', between: 'saturated' });
  });
});

describe('a saved between-level model', () => {
  it('keeps well-formed statements only', () => {
    expect(parseBetweenModel([
      { lhs: 'y', op: '~', rhs: [{ name: 'w', label: 'a' }, { name: 'x); system("ls' }] },
      { lhs: 'y', op: '%', rhs: [{ name: 'w' }] },
      { lhs: 'f b', op: '=~', rhs: [{ name: 'y1' }] },
      { lhs: 'y', op: '~1', rhs: [{ name: '1', fixed: 0 }] },
      { lhs: 'y', op: '~~', rhs: [{ name: 'y', fixed: 'x' }] },
      'junk',
    ])).toEqual([
      { lhs: 'y', op: '~', rhs: [{ name: 'w', label: 'a' }] },
      { lhs: 'y', op: '~1', rhs: [{ name: '1', fixed: 0 }] },
      { lhs: 'y', op: '~~', rhs: [{ name: 'y' }] },
    ]);
    expect(parseBetweenModel('nope')).toEqual([]);
  });

  it('falls back to a saturated between level when nothing usable is left', () => {
    const base = { constructs: [], paths: [], moderations: [] };
    expect(parseModelState({ ...base, multilevel: { column: 'clus', between: 'model', betweenModel: [{ lhs: '(', op: '~', rhs: [] }] } }).multilevel)
      .toEqual({ column: 'clus', between: 'saturated' });
    expect(parseModelState({ ...base, multilevel: { column: 'clus', between: 'model', betweenModel: [{ lhs: 'y', op: '~', rhs: [{ name: 'w' }] }] } }).multilevel)
      .toEqual({ column: 'clus', between: 'model', betweenModel: [{ lhs: 'y', op: '~', rhs: [{ name: 'w' }] }] });
  });
});
