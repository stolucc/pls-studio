import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseProject, serializeProject, validateModel, type ModelState } from '../model/project';
import { estimateMiiv } from './miiv';
import { buildPopulation, generateData, specFromPopulation, type PopulationSpec } from './population';

const pop: PopulationSpec = {
  constructs: [
    { name: 'X', type: 'factor', indicators: ['x1', 'x2', 'x3'], loadings: [0.8, 0.7, 0.75] },
    { name: 'Y', type: 'factor', indicators: ['y1', 'y2', 'y3'], loadings: [0.8, 0.75, 0.7] },
  ],
  paths: [{ from: 'X', to: 'Y', value: 0.5 }],
  exoCor: [],
};

describe('MIIV-2SLS', () => {
  const data = generateData(buildPopulation(pop), 5000, 4);
  const res = estimateMiiv(data, specFromPopulation(pop));

  it('recovers population values in large samples', () => {
    // Unstandardised in marker metric: λ_i / λ_marker, β·λ_y1/λ_x1.
    const est = (lhs: string, op: string, rhs: string) => res.estimates.find((e) => e.lhs === lhs && e.op === op && e.rhs === rhs)!.est;
    expect(est('X', '=~', 'x2')).toBeCloseTo(0.7 / 0.8, 1);
    expect(est('Y', '~', 'X')).toBeCloseTo((0.5 * 0.8) / 0.8, 1);
  });

  it('uses only variables uncorrelated with each composite error as instruments', () => {
    const eq = res.equations.find((e) => e.dv === 'x2')!;
    // x2 = λ x1 + (ε2 − λ ε1): x1 and x2 are excluded, everything else qualifies.
    expect([...eq.instruments].sort()).toEqual(['x3', 'y1', 'y2', 'y3']);
    const st = res.equations.find((e) => e.kind === 'structural')!;
    // y1 = β x1 + (ζ + ε_y1 − β ε_x1): only the other X indicators are valid.
    expect([...st.instruments].sort()).toEqual(['x2', 'x3']);
    expect(st.sargan).not.toBeNull();
    expect(st.sarganP!).toBeGreaterThan(0.01); // correct model
  });

  it('reports equations without enough instruments', () => {
    const tiny: PopulationSpec = { constructs: [{ name: 'X', type: 'factor', indicators: ['x1', 'x2'], loadings: [0.8, 0.7] }], paths: [], exoCor: [] };
    const d = generateData(buildPopulation(tiny), 200, 1);
    expect(() => estimateMiiv(d, specFromPopulation(tiny))).toThrow(/not identified by MIIV-2SLS/);
  });
});

describe('2SLS settings and validation', () => {
  const C = (id: string, ind: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: ind, x: 0, y: 0, side: 'left' as const });
  const model: ModelState = {
    constructs: [C('A', ['a1', 'a2', 'a3']), C('M', ['m1', 'm2', 'm3']), C('Y', ['y1', 'y2', 'y3'])],
    paths: [{ id: 'p1', from: 'A', to: 'Y' }, { id: 'p2', from: 'M', to: 'Y' }],
    moderations: [{ id: 'mo', moderator: 'M', path: 'p1' }],
  };
  it('rejects moderation with MIIV-2SLS', () => {
    const e = validateModel(model, null, { method: 'cbsem', consistent: false, estimator: '2SLS' }).map((i) => i.message);
    expect(e.some((m) => m.includes('MIIV-2SLS'))).toBe(true);
  });
  it('round-trips the estimator in project files', () => {
    const p = parseProject(serializeProject(model, { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: '2SLS' }, null, null));
    expect(p.settings.estimator).toBe('2SLS');
  });
});
