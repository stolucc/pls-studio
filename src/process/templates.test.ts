// Our encoding of the PROCESS model templates against what PROCESS itself
// estimated for every model number (fixtures from
// scripts/validation/process_reference.R).

import { describe, expect, it } from 'vitest';
import { equations, materialise, mediatorRange, recognise, template, TEMPLATES, type ProcessGraph } from './templates';

interface Reference {
  model: number;
  mediators: string[];
  w: boolean;
  z: boolean;
  equations: Record<string, Record<string, number>>;
}

const fixtures = import.meta.glob<Reference>('./__fixtures__/reference/model*.json', { eager: true, import: 'default' });
const references = Object.values(fixtures).sort((a, b) => a.model - b.model);

const key = (term: string) => term.split('*').sort().join('*');
const roles = (r: Reference) => ({ x: 'x', y: 'y', m: r.mediators, w: r.w ? 'w' : undefined, z: r.z ? 'z' : undefined });

describe('PROCESS model templates', () => {
  it('cover exactly the model numbers PROCESS accepts', () => {
    expect(references.length).toBe(56);
    expect(TEMPLATES.map((x) => x.model)).toEqual(references.map((r) => r.model));
  });

  it.each(references.map((r) => [r.model, r] as const))('model %i: same equations as PROCESS', (model, r) => {
    const eq = equations(materialise(template(model)!, roles(r)), ['c1']);
    expect([...eq.keys()].sort()).toEqual(Object.keys(r.equations).sort());
    for (const [outcome, coef] of Object.entries(r.equations)) {
      const theirs = Object.keys(coef).filter((t) => t !== 'constant').map(key).sort();
      expect(eq.get(outcome)!.map((t) => t.join('*')).sort(), `${outcome} equation`).toEqual(theirs);
    }
  });

  it('enforce the mediator counts', () => {
    expect(mediatorRange(template(82)!)).toEqual([4, 4]);
    expect(() => materialise(template(6)!, { x: 'x', y: 'y', m: ['m1'] })).toThrow(/2 to 6 mediators/);
    expect(() => materialise(template(7)!, { x: 'x', y: 'y', m: ['m1'] })).toThrow(/needs a moderator W/);
  });
});

describe('recognising a drawn model', () => {
  // Rename the roles and shuffle the order of everything, as a user drawing it would.
  const drawn = (g: ProcessGraph, names: Record<string, string>): ProcessGraph => {
    const n = (v: string) => names[v] ?? v;
    const e = ([a, b]: [string, string]): [string, string] => [n(a), n(b)];
    return {
      x: n(g.x), y: n(g.y), mediators: g.mediators.map(n).reverse(),
      paths: g.paths.map(e).reverse(),
      moderations: g.moderations.map((m) => ({ path: e(m.path), by: n(m.by) })).reverse(),
      threeWay: g.threeWay.map((m) => ({ path: e(m.path), by: [n(m.by[1]), n(m.by[0])] as [string, string] })),
    };
  };

  it.each(references.map((r) => [r.model, r] as const))('model %i is recognised from its drawing', (model, r) => {
    const names = { x: 'Stress', y: 'Burnout', w: 'Support', z: 'Tenure', m1: 'Rumination', m2: 'Sleep', m3: 'Fatigue', m4: 'Mood' };
    const g = drawn(materialise(template(model)!, roles(r)), names);
    const found = recognise(g);
    expect(found?.model).toBe(model);
    // The roles found reproduce the drawing (W and Z may swap where they play the same part).
    const eqs = (x: ProcessGraph) => [...equations(x)].map(([o, ts]) => `${o}: ${ts.map((t) => t.join('*')).sort()}`).sort();
    expect(eqs(materialise(template(model)!, found!.roles))).toEqual(eqs(g));
  });

  it('a model that is no template is custom', () => {
    const g = materialise(template(4)!, { x: 'x', y: 'y', m: ['m1', 'm2'] });
    // W moderating only one of two parallel X → M paths: no PROCESS number.
    expect(recognise({ ...g, moderations: [{ path: ['x', 'm1'], by: 'w' }] })).toBeNull();
    // Without the X → Y path (full mediation) PROCESS has no number either.
    expect(recognise({ ...g, paths: g.paths.filter(([a, b]) => !(a === 'x' && b === 'y')) })).toBeNull();
  });
});

describe('template descriptions', () => {
  it('say what is moderated', async () => {
    const { describe: text, familyOf } = await import('./templates');
    expect(text(template(7)!)).toBe('Parallel mediation; W moderates X → M');
    expect(text(template(3)!)).toBe('Moderation; W, Z and W × Z moderate X → Y');
    expect(text(template(83)!)).toBe('Serial mediation; W moderates X → M1');
    expect(text(template(74)!)).toBe('Parallel mediation; X moderates M → Y (X × M interaction)');
    expect(familyOf(template(4)!)).toBe('Mediation');
    expect(familyOf(template(21)!)).toBe('Moderated mediation: two moderators');
    expect(familyOf(template(12)!)).toBe('Moderated mediation: three-way interactions');
    expect(familyOf(template(91)!)).toBe('Serial mediation with moderation');
  });
});
