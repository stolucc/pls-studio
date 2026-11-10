import { describe, expect, it } from 'vitest';
import { applyStructure, describeChange, drawable, equivalentModels, pairKey, structureOf, type Structure } from './equivalent';
import { toSpec, type ModelState } from './project';

const K = (id: string, extra: object = {}) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: [`${id}1`, `${id}2`], x: 0, y: 0, side: 'left' as const, ...extra });
const M = (ids: string[], paths: [string, string][], covs: [string, string][] = []): ModelState => ({
  constructs: ids.map((id) => K(id)), paths: paths.map(([from, to], i) => ({ id: `p${i}`, from, to })), moderations: [],
  correlations: covs.map(([a, b], i) => ({ id: `k${i}`, kind: 'construct' as const, a, b })),
});
const keyOf = (s: Structure) => [...s.paths.map(([a, b]) => `${a}>${b}`), ...s.covs.map(([a, b]) => `${a}~${b}`)].sort().join(' ');
/** A structure written by hand ("a>b c~d …"), in keyOf's order. */
const K2 = (text: string) => text.split(' ').sort().join(' ');

// Markov equivalence (Verma & Pearl 1990): the same skeleton and the same v-structures. A covariance is read as an
// arrow in whichever direction makes the graph acyclic with the original's v-structures (a covariance of two
// exogenous variables, or of two disturbances with the same predictors, is either arrow).
function vStructures(paths: [string, string][]): Set<string> {
  const adj = new Set(paths.map(([a, b]) => pairKey(a, b)));
  const out = new Set<string>();
  for (const c of new Set(paths.map(([, t]) => t))) {
    const pa = paths.filter(([, t]) => t === c).map(([f]) => f).sort();
    for (let i = 0; i < pa.length; i++) for (let j = i + 1; j < pa.length; j++) if (!adj.has(pairKey(pa[i], pa[j]))) out.add(`${pa[i]}>${c}<${pa[j]}`);
  }
  return out;
}
function markovEquivalent(base: Structure, s: Structure): boolean {
  const skel = (x: Structure) => [...x.paths.map(([a, b]) => pairKey(a, b)), ...x.covs.map(([a, b]) => pairKey(a, b))].sort().join(' ');
  if (skel(base) !== skel(s)) return false;
  const want = [...vStructures(base.paths)].sort().join(' ');
  for (let mask = 0; mask < 2 ** s.covs.length; mask++) {
    const paths = [...s.paths, ...s.covs.map(([a, b], i): [string, string] => ((mask >> i) & 1 ? [b, a] : [a, b]))];
    if (drawable({ ...s, paths, covs: [] }) && [...vStructures(paths)].sort().join(' ') === want) return true;
  }
  return false;
}

describe('equivalent models (Lee–Hershberger replacing rules)', () => {
  it('Roth et al. (1989), Kline’s path model: the exogenous pair and the two chains from it, seven models in all', () => {
    // exercise ↔ hardy; exercise → fitness → illness; hardy → stress → illness
    const roth = M(['exercise', 'hardy', 'fitness', 'stress', 'illness'], [['exercise', 'fitness'], ['hardy', 'stress'], ['fitness', 'illness'], ['stress', 'illness']], [['exercise', 'hardy']]);
    const { models, truncated } = equivalentModels(roth);
    expect(truncated).toBe(false);
    expect(models.map((m) => keyOf(m.structure)).sort()).toEqual([
      'exercise>fitness exercise>hardy fitness>illness hardy>stress stress>illness',
      'exercise>fitness fitness>illness hardy>exercise hardy>stress stress>illness',
      'exercise>fitness fitness>illness hardy>exercise stress>hardy stress>illness',
      'exercise>fitness fitness>illness hardy>exercise stress>illness hardy~stress',
      'exercise>hardy fitness>exercise fitness>illness hardy>stress stress>illness',
      'exercise>hardy fitness>illness hardy>stress stress>illness exercise~fitness',
    ].map(K2).sort());
    const base = structureOf(roth);
    for (const m of models) expect(markovEquivalent(base, m.structure)).toBe(true);
    const first = models.find((m) => keyOf(m.structure).startsWith('exercise>fitness exercise>hardy'))!;
    expect(first.rules).toEqual([1]);
    expect(first.changes.map((c) => describeChange(c, (x) => x, base, first.structure))).toEqual(['exercise ↔ hardy replaced by exercise → hardy']);
  });

  it('a saturated block of three: every drawable recursive configuration, by Rule 1', () => {
    const tri = M(['x', 'y1', 'y2'], [['x', 'y1'], ['x', 'y2'], ['y1', 'y2']]);
    const { models } = equivalentModels(tri);
    // all configurations: each pair →, ← or ↔, acyclic, covariances between two exogenous or two endogenous
    const base = structureOf(tri);
    const pairs: [string, string][] = [['x', 'y1'], ['x', 'y2'], ['y1', 'y2']];
    const all = new Set<string>();
    for (let code = 0; code < 27; code++) {
      const s: Structure = { ...base, paths: [], covs: [] };
      pairs.forEach(([a, b], i) => { const r = Math.floor(code / 3 ** i) % 3; if (r === 0) s.paths.push([a, b]); else if (r === 1) s.paths.push([b, a]); else s.covs.push([a, b]); });
      if (drawable(s)) all.add(keyOf(s));
    }
    all.delete(keyOf(base));
    expect(models.map((m) => keyOf(m.structure)).sort()).toEqual([...all].sort());
    expect(models.every((m) => m.rules.every((r) => r === 1))).toBe(true);
  });

  it('Rule 2: two outcomes with the same predictor (x → y1, x → y2, y1 → y2, then z) — reversal or correlated disturbances', () => {
    const m = M(['w', 'x', 'y1', 'y2', 'z'], [['w', 'x'], ['x', 'y1'], ['x', 'y2'], ['y1', 'y2'], ['y2', 'z']]);
    const keys = equivalentModels(m).models.map((e) => keyOf(e.structure));
    expect(keys).toContain(K2('w>x x>y1 x>y2 y2>y1 y2>z'));
    expect(keys).toContain(K2('w>x x>y1 x>y2 y2>z y1~y2'));
    // y2 → z is reversed only once y2 has lost its predictors (the model has no v-structure: every acyclic
    // orientation of its skeleton without one is equivalent)
    const base = structureOf(m);
    for (const e of equivalentModels(m).models) {
      if (e.structure.paths.some(([f, t]) => f === 'z' && t === 'y2')) expect(e.structure.paths.filter(([, t]) => t === 'y2').map(([f]) => f)).toEqual(['z']);
      expect(markovEquivalent(base, e.structure)).toBe(true);
    }
  });

  it('every alternative of random path models is Markov equivalent to the model (soundness)', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    for (let t = 0; t < 60; t++) {
      const n = 4 + Math.floor(rnd() * 3);
      const ids = Array.from({ length: n }, (_, i) => `v${i}`);
      const paths: [string, string][] = [];
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rnd() < 0.45) paths.push([ids[i], ids[j]]);
      const model = M(ids, paths);
      const base = structureOf(model);
      for (const e of equivalentModels(model, 200).models) expect(markovEquivalent(base, e.structure), `${keyOf(base)} vs ${keyOf(e.structure)}`).toBe(true);
    }
  });

  it('leaves covariates, higher-order constructs, moderations and fixed or labelled arrows as they are', () => {
    const m = M(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    expect(equivalentModels(m).models.length).toBeGreaterThan(0);
    expect(equivalentModels({ ...m, paths: m.paths.map((p) => ({ ...p, label: 'x' })) }).models).toEqual([]);
    expect(equivalentModels({ ...m, paths: m.paths.map((p) => ({ ...p, fixed: 1 })) }).models).toEqual([]);
    const cov = { ...m, constructs: m.constructs.map((c) => (c.id === 'a' ? { ...c, covariate: true } : c)) };
    expect(equivalentModels(cov).models.every((e) => e.structure.paths.some(([f, t]) => f === 'a' && t === 'b'))).toBe(true);
    const mod = { ...m, constructs: [...m.constructs, K('w')], moderations: [{ id: 'mo', moderator: 'w', path: 'p0' }] };
    expect(equivalentModels(mod).models.every((e) => e.structure.paths.some(([f, t]) => f === 'a' && t === 'b'))).toBe(true);
    // a higher-order factor h of b and c: b and c are explained by h, so nothing about them is a free choice
    const hoc: ModelState = { ...M(['x', 'b', 'c'], [['x', 'b']]), constructs: [K('x'), K('b'), K('c'), { ...K('h'), indicators: [], components: ['b', 'c'] }] };
    expect(equivalentModels(hoc).models).toEqual([]);
  });

  it('applies an alternative to the diagram: kept ids, reversed paths, new covariances, zero records of joined pairs dropped', () => {
    const roth = M(['exercise', 'hardy', 'fitness'], [['exercise', 'fitness']], [['exercise', 'hardy']]);
    roth.paths[0].line = 'dashed';
    const alt = equivalentModels(roth).models.find((e) => keyOf(e.structure) === K2('exercise>hardy fitness>exercise'))!;
    const out = applyStructure(roth, alt.structure);
    expect(out.paths).toEqual([{ id: 'eq-p-exercise-hardy', from: 'exercise', to: 'hardy' }, { id: 'p0', from: 'fitness', to: 'exercise', line: 'dashed' }]);
    expect(out.correlations).toEqual([]);
    const withZero: ModelState = { ...M(['a', 'b'], [['a', 'b']]), correlations: [{ id: 'z', kind: 'construct', a: 'a', b: 'b', zero: true }] };
    const swap = applyStructure(withZero, { ...structureOf(withZero), paths: [], covs: [['a', 'b']] });
    expect(swap.correlations).toEqual([{ id: 'eq-k-a-b', kind: 'construct', a: 'a', b: 'b' }]);
    expect(toSpec(swap).covariances).toEqual([{ a: 'a', b: 'b', kind: 'construct' }]);
  });
});
