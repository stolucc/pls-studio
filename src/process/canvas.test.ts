// Templates on the canvas and back: every PROCESS template, put on the canvas
// as slots, is recognised as itself; drawn models become process graphs with
// implied main effects and lower-order terms.

import { describe, expect, it } from 'vitest';
import type { ModelState } from '../model/project';
import { graphToModel, isSlotName, slotRoles, templateModel, templatePositions } from './canvas';
import { processGraph } from './fromModel';
import { materialise, mediatorRange, template, TEMPLATES } from './templates';

const C = (id: string, extra = {}) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: [id.toLowerCase()], x: 0, y: 0, side: 'left' as const, ...extra });

describe('templates on the canvas', () => {
  it.each(TEMPLATES.map((tp) => [tp.model, tp] as const))('model %i round-trips through the canvas', (model, tp) => {
    const [lo, hi] = mediatorRange(tp);
    for (const k of [...new Set([lo, Math.max(lo, Math.min(hi, 3))])]) {
      const m = templateModel(tp, k);
      const info = processGraph(m);
      expect(info.errors).toEqual([]);
      expect(info.recognised?.model).toBe(model);
      expect(info.recognised?.roles.m.length).toBe(k);
    }
  });

  it('draws a three-way term as a moderation of W’s moderation, not as a second arrow to the path', () => {
    const m = templateModel(template(3)!, 0);
    expect(m.constructs.map((c) => c.name).sort()).toEqual(['W', 'X', 'Y', 'Z']);
    expect(m.paths).toHaveLength(1);
    expect(m.moderations).toHaveLength(1);
    expect(m.threeWay).toEqual([{ id: expect.any(String), moderation: m.moderations[0].id, moderator: m.constructs.find((c) => c.name === 'Z')!.id }]);
  });

  it('keeps variables already in slots of the same name, and covariates', () => {
    const prev: ModelState = { constructs: [C('X'), C('M'), C('Age', { covariate: true }), C('Old')], paths: [], moderations: [] };
    const tp = template(7)!;
    const roles = slotRoles(tp, 1);
    const m = graphToModel(materialise(tp, roles), prev, templatePositions(tp, roles));
    expect(m.constructs.find((c) => c.name === 'X')!.indicators).toEqual(['x']);
    expect(m.constructs.find((c) => c.name === 'W')!.indicators).toEqual([]);
    expect(m.constructs.some((c) => c.name === 'Old')).toBe(false);
    expect(m.constructs.find((c) => c.name === 'Age')?.covariate).toBe(true);
    expect(processGraph(m).covariates).toEqual(['Age']);
    // Slots are named by role until a variable is dropped on them.
    expect(['X', 'M1', 'W', 'Z', 'Y', 'M'].every(isSlotName)).toBe(true);
    expect(isSlotName('Stress')).toBe(false);
  });
});

describe('the drawn model as a process graph', () => {
  it('treats a moderator’s path to the outcome as its implied main effect', () => {
    // As drawn in SEM: W → Y next to W moderating X → Y.
    const m: ModelState = {
      constructs: [C('X'), C('W'), C('Y')],
      paths: [{ id: 'p', from: 'X', to: 'Y' }, { id: 'q', from: 'W', to: 'Y' }],
      moderations: [{ id: 'm', moderator: 'W', path: 'p' }],
    };
    const info = processGraph(m);
    expect(info.graph?.paths).toEqual([['X', 'Y']]);
    expect(info.recognised?.model).toBe(1);
  });

  it('explains what keeps a model from being a process model', () => {
    const two: ModelState = { constructs: [C('A'), C('B'), C('Y')], paths: [{ id: 'p', from: 'A', to: 'Y' }, { id: 'q', from: 'B', to: 'Y' }], moderations: [] };
    expect(processGraph(two).errors[0].message).toMatch(/one antecedent X, but A, B have no incoming paths/);
    const cov: ModelState = { ...two, constructs: [C('A'), C('B', { covariate: true }), C('Y')] };
    expect(processGraph(cov).errors[0].message).toMatch(/Covariate "B" enters every equation/);
    const quad: ModelState = { constructs: [C('X'), C('Y')], paths: [{ id: 'p', from: 'X', to: 'Y' }], moderations: [{ id: 'm', moderator: 'X', path: 'p' }] };
    expect(processGraph(quad).errors[0].message).toMatch(/Quadratic effects/);
    const medMod: ModelState = {
      constructs: [C('X'), C('M'), C('Y')],
      paths: [{ id: 'a', from: 'X', to: 'M' }, { id: 'b', from: 'M', to: 'Y' }, { id: 'c', from: 'X', to: 'Y' }],
      moderations: [{ id: 'm', moderator: 'M', path: 'c' }],
    };
    expect(processGraph(medMod).errors[0].message).toMatch(/M lies on a path and cannot also be a moderator/);
    const loose: ModelState = { constructs: [C('X'), C('Y'), C('Q')], paths: [{ id: 'p', from: 'X', to: 'Y' }], moderations: [] };
    expect(processGraph(loose).errors[0].message).toMatch(/"Q" is not in the model/);
    expect(processGraph({ constructs: [C('X')], paths: [], moderations: [] }).errors[0].message).toMatch(/Draw a path from X to Y/);
  });

  it('a custom model is a valid graph without a number', () => {
    const m: ModelState = {
      constructs: [C('X'), C('M1'), C('M2'), C('W'), C('Y')],
      paths: [{ id: 'a1', from: 'X', to: 'M1' }, { id: 'a2', from: 'X', to: 'M2' }, { id: 'b1', from: 'M1', to: 'Y' }, { id: 'b2', from: 'M2', to: 'Y' }, { id: 'c', from: 'X', to: 'Y' }],
      moderations: [{ id: 'm', moderator: 'W', path: 'a1' }],
    };
    const info = processGraph(m);
    expect(info.errors).toEqual([]);
    expect(info.graph?.mediators.sort()).toEqual(['M1', 'M2']);
    expect(info.recognised).toBeNull();
  });
});
