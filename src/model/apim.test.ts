import { describe, expect, it } from 'vitest';
import { apimModel, apimRolesError, type ApimRoles } from './apim';
import { DEFAULT_SETTINGS, labelUses, toSpec, validateModel } from './project';

const items = (stem: string, n: number) => Array.from({ length: n }, (_, i) => `${stem}${i + 1}`);
const LATENT: ApimRoles = { x1: items('xa', 3), x2: items('xb', 3), y1: items('ya', 3), y2: items('yb', 3), dyads: 'distinguishable' };
const OBSERVED: ApimRoles = { x1: ['X1'], x2: ['X2'], y1: ['Y1'], y2: ['Y2'], dyads: 'indistinguishable' };

function dataFor(r: ApimRoles) {
  const names = [...r.x1, ...r.x2, ...r.y1, ...r.y2];
  const cols = names.map((_, k) => Float64Array.from({ length: 60 }, (_, i) => Math.sin(i * (k + 1.3)) + (i % (k + 3))));
  return { names, cols };
}

describe('the APIM as a diagram', () => {
  it('says why roles cannot be drawn', () => {
    expect(apimRolesError(LATENT)).toBeNull();
    expect(apimRolesError({ ...LATENT, y2: [] })).toMatch(/Choose the columns/);
    expect(apimRolesError({ ...LATENT, x2: items('xb', 2) })).toMatch(/same number of X items/);
    expect(apimRolesError({ ...LATENT, y2: items('yb', 4) })).toMatch(/same number of Y items/);
    expect(apimRolesError({ ...LATENT, y1: LATENT.x1 })).toMatch(/one role only/);
  });

  it('draws distinguishable dyads with latent variables: own paths, invariant items, k1 and k2', () => {
    const m = apimModel(LATENT);
    expect(m.constructs.map((c) => c.name)).toEqual(['X1', 'X2', 'Y1', 'Y2']);
    expect(m.paths.map((p) => p.label)).toEqual(['a1', 'a2', 'p1', 'p2']);
    expect(m.constructs[0].loadingLabels).toEqual({ xa2: 'lx2', xa3: 'lx3' });
    expect(m.constructs[1].loadingLabels).toEqual({ xb2: 'lx2', xb3: 'lx3' });
    expect(m.correlations!.filter((k) => k.kind === 'indicator').map((k) => [k.a, k.b])).toEqual([['xa1', 'xb1'], ['xa2', 'xb2'], ['xa3', 'xb3'], ['ya1', 'yb1'], ['ya2', 'yb2'], ['ya3', 'yb3']]);
    expect(m.defined!.map((d) => `${d.name} := ${d.expr}`)).toEqual(['k1 := p1/a1', 'k2 := p2/a2']);
    // (free means and variances: no labels on them)
    expect(m.means!.every((t) => !t.label)).toBe(true);
    expect(m.parameters!.every((t) => t.kind === 'intercept')).toBe(true);
    const settings = { ...DEFAULT_SETTINGS, method: 'cbsem' as const };
    expect(validateModel(m, dataFor(LATENT), settings).filter((i) => i.level === 'error')).toEqual([]);
    expect(toSpec(m)).toMatchObject({ meanStructure: true });
  });

  it('draws indistinguishable dyads with observed variables: shared labels for effects, means and variances', () => {
    const m = apimModel(OBSERVED);
    expect(m.constructs.map((c) => [c.name, c.indicators])).toEqual([['X1', ['X1']], ['X2', ['X2']], ['Y1', ['Y1']], ['Y2', ['Y2']]]);
    expect(m.paths.map((p) => p.label)).toEqual(['a', 'a', 'p', 'p']);
    expect(m.means!.map((t) => t.label)).toEqual(['mx', 'mx', 'my', 'my']);
    expect(m.parameters!.map((t) => t.label)).toEqual(['vx', 'vx', 'vy', 'vy']);
    expect(m.defined!.map((d) => d.name)).toEqual(['k']);
    expect([...labelUses(m).keys()].sort()).toEqual(['a', 'p', 'vx', 'vy']);
    const settings = { ...DEFAULT_SETTINGS, method: 'cbsem' as const };
    expect(validateModel(m, dataFor(OBSERVED), settings).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('names latent variables apart from the columns', () => {
    const m = apimModel({ ...LATENT, x1: ['X1', 'q2', 'q3'] });
    expect(m.constructs[0].name).toBe('X1_lv');
  });
});
