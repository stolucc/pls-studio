import { describe, expect, it } from 'vitest';
import { factorCodes } from '../io';
import { DEFAULT_SETTINGS, validateModel } from '../model/project';
import { processGraph } from '../process/fromModel';
import { R_PACKAGES } from '../rengine/bridge';
import { EXAMPLE_PACKAGES, exampleModel, PACKAGE_EXAMPLES, panelColumns } from './packages';

const diagrams = PACKAGE_EXAMPLES.filter((e) => !e.panel);

describe.each(diagrams.map((e) => [e.id, e] as const))('package example %s', (_id, ex) => {
  it('builds a valid model for its method', () => {
    const model = exampleModel(ex);
    const names = [...new Set([...model.constructs.flatMap((c) => c.indicators), ...(ex.multigroup ? [ex.multigroup.column] : []), ...(ex.multilevel ? [ex.multilevel.column] : [])])];
    const data = { names, cols: names.map((_, k) => Float64Array.from({ length: 400 }, (_, i) => (names[k] === 'school' ? 1 + (i % 2) : names[k] === 'cluster' ? 1 + (i % 40) : Math.sin(i * (k + 1.3)) + (i % (k + 3))))) };
    const errors = validateModel(model, data, { ...DEFAULT_SETTINGS, ...ex.settings }).filter((i) => i.level === 'error');
    expect(errors.map((e) => e.message)).toEqual([]);
    expect(model.moderations.length).toBe(ex.moderations?.length ?? 0);
    expect(model.correlations?.length ?? 0).toBe(ex.correlations?.length ?? 0);
  });
});

it('conditional process examples are recognised as their PROCESS model', () => {
  const cpa = PACKAGE_EXAMPLES.filter((e) => e.settings.method === 'process');
  expect(cpa.length).toBeGreaterThan(0);
  for (const e of cpa) {
    const g = processGraph(exampleModel(e));
    expect(g.recognised?.model, e.id).toBe(e.processModel);
    expect(g.covariates, e.id).toEqual(['c1', 'c2']);
  }
});

it('the labelled Political Democracy model holds the 1960 and 1965 loadings equal', () => {
  const m = exampleModel(PACKAGE_EXAMPLES.find((e) => e.id === 'lavaan-poldem')!);
  expect(m.constructs.map((c) => c.loadingLabels ?? {})).toEqual([{}, { y2: 'a', y3: 'b', y4: 'c' }, { y6: 'a', y7: 'b', y8: 'c' }]);
});

it('ESEM blocks refer to the example’s constructs by id', () => {
  const m = exampleModel(PACKAGE_EXAMPLES.find((e) => e.id === 'lavaan-hs-esem')!);
  expect(m.esem?.blocks[0].constructs).toEqual(m.constructs.map((c) => c.id));
});

it('panel examples carry no diagram and name their columns', () => {
  for (const e of PACKAGE_EXAMPLES.filter((x) => x.panel)) {
    expect(e.constructs, e.id).toEqual([]);
    expect(panelColumns(e.panel!).length, e.id).toBeGreaterThanOrEqual(2);
  }
});

it('ids are unique and every R package the app calculates with has an example', () => {
  expect(new Set(PACKAGE_EXAMPLES.map((e) => e.id)).size).toBe(PACKAGE_EXAMPLES.length);
  expect(new Set(PACKAGE_EXAMPLES.map((e) => e.package))).toEqual(new Set(EXAMPLE_PACKAGES));
  // Bridge packages without their own example: variants of another package's runtime
  // (lavaan + cSEM for simulation, manymome's latent and glm routes, optimx for REndo's latent IV, lavaan for the RSA package's model, flexmix for FIMIX-PLS on plspm's simdata) or helpers.
  const covered = new Set<string>([...EXAMPLE_PACKAGES, 'simulation', 'processGlm', 'manymomeSam', 'optimx', 'polynomial', 'nca', 'flexmix', 'cta']);
  for (const p of Object.keys(R_PACKAGES)) expect(covered, p).toContain(p);
});

it('every example links to its original documentation (https)', () => {
  for (const e of PACKAGE_EXAMPLES) {
    expect(e.links.length, e.id).toBeGreaterThan(0);
    for (const l of e.links) expect(l.url, `${e.id}: ${l.label}`).toMatch(/^https:\/\//);
  }
});

it('factor codes are listed per level set', () => {
  expect(factorCodes(undefined)).toBe('');
  expect(factorCodes([])).toBe('');
  expect(factorCodes({ school: ['Grant-White', 'Pasteur'] })).toBe(' Coded school: 1 = Grant-White, 2 = Pasteur.');
  expect(factorCodes({ a: ['no', 'yes'], b: ['no', 'yes'], g: 'only' })).toBe(' Coded a, b: 1 = no, 2 = yes; g: 1 = only.');
});
