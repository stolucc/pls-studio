import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { factorCodes } from '../io';
import { DEFAULT_SETTINGS, toSpec, validateModel, unconfirmedUncorrelated } from '../model/project';
import { processGraph } from '../process/fromModel';
import { R_PACKAGES } from '../rengine/bridge';
import { EXAMPLE_PACKAGES, exampleModel, exampleSettings, PACKAGE_EXAMPLES, panelColumns } from './packages';

const diagrams = PACKAGE_EXAMPLES.filter((e) => !e.panel);

describe.each(diagrams.map((e) => [e.id, e] as const))('package example %s', (_id, ex) => {
  it('builds a valid model for its method', () => {
    const model = exampleModel(ex);
    const names = [...new Set([...model.constructs.flatMap((c) => c.indicators), ...(ex.multigroup ? [ex.multigroup.column] : []), ...(ex.multilevel ? [ex.multilevel.column] : [])])];
    const data = { names, cols: names.map((_, k) => Float64Array.from({ length: 400 }, (_, i) => (names[k] === 'school' ? 1 + (i % 2) : names[k] === 'cluster' ? 1 + (i % 40) : Math.sin(i * (k + 1.3)) + (i % (k + 3))))) };
    const errors = validateModel(model, data, { ...DEFAULT_SETTINGS, ...ex.settings }).filter((i) => i.level === 'error');
    expect(errors.map((e) => e.message)).toEqual([]);
    expect(model.moderations.length).toBe(ex.moderations?.length ?? 0);
    // The authored correlations, plus the exogenous ones the package example estimates (drawn).
    expect((model.correlations ?? []).filter((k) => k.kind === 'indicator').length).toBe((ex.correlations ?? []).filter(([, , kind]) => kind === 'indicator').length);
    if (ex.settings.method === 'cbsem') expect(unconfirmedUncorrelated(model)).toEqual([]);
    // PLS-SEM and CPA estimate no construct correlations: none are drawn unless authored.
    else expect((model.correlations ?? []).filter((k) => k.kind === 'construct').length).toBe((ex.correlations ?? []).filter(([, , kind]) => kind === 'construct').length);
    // Nothing for PLS-SEM to ignore: no "correlations are ignored" warning.
    if (ex.settings.method === 'pls') expect(validateModel(model, data, { ...DEFAULT_SETTINGS, ...ex.settings }).some((i) => /correlation.*ignores/.test(i.message))).toBe(false);
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
  // cSEMMi / seminrMi: cSEM and seminr with mice (multiple imputation), shown by the mice and lavaan.mi examples.
  // readData: haven + readxl (SPSS, Stata, Excel import), shown by the haven and readxl examples.
  // regression: base R with MASS, nnet and sandwich, shown by the stats, datasets, MASS and nnet examples.
  const covered = new Set<string>([...EXAMPLE_PACKAGES, 'simulation', 'processGlm', 'manymomeSam', 'optimx', 'polynomial', 'nca', 'flexmix', 'cta', 'cSEMMi', 'seminrMi', 'readData', 'versions', 'regression']);
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

it('an example opens with its documented settings, not the previous project’s; the diagram and chart styles carry over', () => {
  const current = { ...DEFAULT_SETTINGS, bootSamples: 50_000, seed: 7, confidence: 0.9, missing: 'mi' as const, consistent: true, engine: 'builtin' as const, estimator: 'MLR' as const,
    figure: { ...DEFAULT_SETTINGS.figure, fontSize: 19 }, charts: { ...DEFAULT_SETTINGS.charts, size: 19 } };
  const s = exampleSettings(current, { method: 'cbsem', estimator: 'MLM' });
  expect(s).toEqual({ ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'MLM', engine: 'r', figure: current.figure, charts: current.charts });
  // Every package example's own settings are partial: what it does not set is the default, never the previous project's.
  for (const e of PACKAGE_EXAMPLES) {
    const got = exampleSettings(current, e.settings);
    expect(got.bootSamples, e.id).toBe(e.settings.bootSamples ?? DEFAULT_SETTINGS.bootSamples);
    expect(got.seed, e.id).toBe(e.settings.seed ?? DEFAULT_SETTINGS.seed);
    expect(got.missing, e.id).toBe(e.settings.missing ?? DEFAULT_SETTINGS.missing);
  }
});

// Each example opens with the settings of its source (help page, demo, book):
// the estimator's defaults where the source relies on them, its explicit
// arguments otherwise. Sources: the R help pages (tools::Rd_db), the seminr
// demo scripts and Hair et al. (2021); seminr's bootstrap_model() default is 500.
describe('documented settings', () => {
  const ex = (id: string) => PACKAGE_EXAMPLES.find((e) => e.id === id)!.settings;
  it('cSEM examples use csem()’s defaults (PLSc, path scheme, 1e-05, 100 iterations, 499 resamples)', () => {
    for (const id of ['csem-threecf', 'csem-satisfaction', 'csem-gender', 'csem-2ndorder', 'genpathmox-csibank']) {
      expect(ex(id), id).toMatchObject({ plsPackage: 'cSEM', consistent: true, scheme: 'path', stopExp: 5, maxIter: 100, bootSamples: 499 });
    }
  });
  it('the Henseler (2020, 2021) and Benitez examples set the factorial scheme and .tolerance = 1e-06', () => {
    for (const id of ['csem-itflex', 'csem-yoo', 'csem-bergami', 'csem-switching', 'csem-russett', 'csem-lancelot', 'csem-benitez']) {
      expect(ex(id), id).toMatchObject({ plsPackage: 'cSEM', consistent: true, scheme: 'factor', stopExp: 6, maxIter: 100, bootSamples: 499 });
    }
  });
  it('seminr examples bootstrap as their demos do (ECSI and higher-order 1000; interaction 500; influencer the default 500; the book 1000 with seed 123)', () => {
    for (const id of ['seminr-mobi', 'seminr-hoc', 'seminr-interaction', 'seminr-influencer', 'seminr-corprep']) {
      expect(ex(id), id).toMatchObject({ plsPackage: 'seminr', consistent: false, scheme: 'path', missing: 'mean' });
      expect(ex(id).stopExp, id).toBeUndefined();  // estimate_pls(): maxIt = 300, stopCriterion = 7 = the app's defaults
    }
    expect(ex('seminr-mobi').bootSamples).toBe(1000);
    expect(ex('seminr-hoc').bootSamples).toBe(1000);
    expect(ex('seminr-interaction').bootSamples).toBe(500);
    expect(ex('seminr-influencer').bootSamples).toBe(500);
    expect(ex('seminr-corprep')).toMatchObject({ bootSamples: 1000, seed: 123 });
  });
  it('plspm (centroid, 1e-06, 100) and semPLS (centroid, 1e-07, 20) examples use those packages’ defaults', () => {
    expect(ex('plspm-rebus')).toMatchObject({ scheme: 'centroid', consistent: false, stopExp: 6, maxIter: 100 });
    expect(ex('sempls-qsquared')).toMatchObject({ scheme: 'centroid', consistent: false, stopExp: 7, maxIter: 20 });
  });
  it('panel examples carry their help pages’ arguments: RSA() estimates by MLR, nca_analysis() runs no permutation test, mice() sets no seed', () => {
    const panel = (id: string) => PACKAGE_EXAMPLES.find((e) => e.id === id)!.panel as Record<string, unknown>;
    expect(panel('rsa-motcon')).toMatchObject({ estimation: 'MLR', center: 'none' });
    expect(panel('nca-example')).toMatchObject({ permutations: 0 });
    expect(ex('mice-nhanes')).toMatchObject({ missing: 'mi', miImputations: 5 });
    expect(ex('mice-nhanes').seed).toBeUndefined();
  });
});

it('puts the constant on the canvas of mean-structure examples, with its arrows', () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'lavaan-hs-means')!;
  const m = exampleModel(ex);
  expect(m.constant).toEqual({ x: -220, y: 120 });
  expect(m.means ?? []).toEqual([]);
  expect(toSpec(m)).toMatchObject({ meanStructure: true, means: [] });
  expect(exampleModel(PACKAGE_EXAMPLES.find((e) => e.id === 'lavaan-hs')!).constant).toBeUndefined();
  // Arrows name constructs; fixed values and labels carry over.
  const withArrows = exampleModel({ ...ex, means: [{ construct: 'visual' }, { construct: 'speed', fixed: 0 }, { construct: 'textual', label: 'mt' }] });
  const name = new Map(withArrows.constructs.map((c) => [c.id, c.name]));
  expect(withArrows.constant).toBeTruthy();
  expect(withArrows.means!.map((t) => [name.get(t.target), t.fixed, t.label])).toEqual([['visual', undefined, undefined], ['speed', 0, undefined], ['textual', undefined, 'mt']]);
  expect(toSpec(withArrows).means).toEqual([{ construct: 'visual' }, { construct: 'speed', fixed: 0 }, { construct: 'textual', label: 'mt' }]);
  expect(() => exampleModel({ ...ex, means: [{ construct: 'nope' }] })).toThrow(/unknown construct nope/);
});

it('README and ARCHITECTURE state the current number of package examples', () => {
  const readme = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8').match(/\*\*Examples\*\*: (\d+) examples from the R packages/);
  const arch = readFileSync(join(__dirname, '..', '..', 'ARCHITECTURE.md'), 'utf8').match(/(\d+) package examples/);
  expect(Number(readme?.[1])).toBe(PACKAGE_EXAMPLES.length);
  expect(Number(arch?.[1])).toBe(PACKAGE_EXAMPLES.length);
});
