// The Mplus User's Guide examples as package examples: their definitions map
// to the app's model (ordered indicators, freed group parameters by construct
// name, covariates, the disturbance covariance Mplus frees by default) and
// to the native reference (scripts/validation/mplus.R).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec, validateModel } from '../model/project';
import type { DataInfo } from '../model/project';
import { computeColumn } from '../data/compute';
import { exampleModel, PACKAGE_EXAMPLES } from './packages';
import { exampleTags } from './tags';
import { exampleTestData } from './testData';
import { parseLavaanSyntax } from '../model/syntax';

// What the Mplus outputs print (scripts/validation/mplus_printed.py); the webR test compares the app with it.
const printed = JSON.parse(
  readFileSync(
    join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'mplus_printed.json'),
    'utf8',
  ),
) as Record<string, { fit: { npar?: number }; estimates: unknown[] }>;
const MPLUS = PACKAGE_EXAMPLES.filter((e) => e.id.startsWith('mplus-'));
const ex = (id: string) => PACKAGE_EXAMPLES.find((e) => e.id === `mplus-${id}`)!;

describe('Mplus User’s Guide examples', () => {
  it('cover the guide’s examples with the reference fixture, data downloaded from the guide and the guide’s pages', () => {
    expect(MPLUS.length).toBeGreaterThanOrEqual(17);
    expect(new Set(MPLUS.map((e) => e.id)).size).toBe(MPLUS.length);
    for (const e of MPLUS) {
      const key = e.id.slice(6);
      expect(key, e.id).toMatch(/^ex\d+\.\d+[a-z0-9]*$/);
      // (not shipped: no licence is stated; downloaded from statmodel.com when the example opens)
      expect(e.data.file, e.id).toBeUndefined();
      // (an example's own data, or those of the example it varies: ex5.27b reads ex5.27's)
      expect(
        e.data.remote?.kind === 'mplus' && key.slice(2).startsWith(e.data.remote.example),
        e.id,
      ).toBe(true);
      // (data rows; a univariate time series has a single column)
      expect(exampleTestData(e)!.cols[0].length, key).toBeGreaterThan(10);
      expect(e.links[0].url).toBe(
        `https://www.statmodel.com/usersguide/chap${key.slice(2).split('.')[0]}/${key}.html`,
      );
      expect(exampleTags(e)).toContain('Mplus User’s Guide');
      expect(exampleTags(e)).toContain('Downloaded data');
      // Every example has the output Mplus prints for it (parsed from the guide's output page).
      expect(printed[key], key).toBeDefined();
    }
  });

  it('given as lavaan syntax, import without losing a line', () => {
    for (const e of MPLUS.filter((x) => x.syntax)) {
      expect(e.constructs, e.id).toEqual([]);
      expect(parseLavaanSyntax(e.syntax!).warnings, e.id).toEqual([]);
    }
  });

  it('carry Mplus’s defaults: mean structure, observed information (expected where the input asks), geomin ε, no mean structure where the input says so', () => {
    for (const key of ['ex3.11', 'ex5.1', 'ex5.6', 'ex5.8', 'ex5.11', 'ex5.15', 'ex5.25']) {
      const m = exampleModel(ex(key));
      expect(m.constant, key).toBeTruthy();
      expect(toSpec(m).information, key).toBe('observed');
    }
    for (const key of ['ex6.1', 'ex6.8', 'ex6.9', 'ex6.10'])
      expect(exampleModel(ex(key)).information, key).toBe('observed');
    // ex5.14: MODEL = NOMEANSTRUCTURE and INFORMATION = EXPECTED (lavaan's default).
    const m514 = exampleModel(ex('ex5.14'));
    expect(m514.multigroup!.meanStructure).toBe(false);
    expect(m514.information).toBeUndefined();
    expect(toSpec(m514).multigroup!.meanStructure).toBe(false);
    // ex5.25: geomin with ε = 0.0001, Mplus's value for two factors.
    expect(toSpec(exampleModel(ex('ex5.25'))).esem).toMatchObject({
      rotation: 'geomin',
      epsilon: 0.0001,
    });
  });

  it('build valid models: WLSMV on ordered indicators, freed loadings and intercepts by construct name, the freed disturbance covariance', () => {
    const m52 = exampleModel(ex('ex5.2'));
    expect(m52.ordered).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
    expect(toSpec(m52).ordered).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
    const m515 = exampleModel(ex('ex5.15'));
    const f1 = m515.constructs.find((c) => c.name === 'f1')!;
    expect(m515.multigroup!.free).toEqual([
      { kind: 'loading', construct: f1.id, indicator: 'y3' },
      { kind: 'intercept', indicator: 'y3' },
    ]);
    expect(toSpec(m515).multigroup!.free).toEqual([
      { kind: 'loading', construct: 'f1', indicator: 'y3' },
      { kind: 'intercept', indicator: 'y3' },
    ]);
    const m58 = exampleModel(ex('ex5.8'));
    const name = (id: string) => m58.constructs.find((c) => c.id === id)!.name;
    expect(
      m58
        .correlations!.filter((k) => k.kind === 'construct')
        .map((k) => [name(k.a), name(k.b)].sort().join('~~')),
    ).toContain('f1~~f2');
    expect(m58.constructs.filter((c) => c.covariate).map((c) => c.name)).toEqual([
      'x1',
      'x2',
      'x3',
    ]);
    for (const e of MPLUS) {
      if (e.panel) continue;
      let data = exampleTestData(e)!;
      // (the example's computed columns, as opening it adds them: Mplus's DEFINE, CENTER)
      let info: DataInfo = {
        fileName: e.id,
        rows: data.cols[0].length,
        missingCells: 0,
        excluded: [],
      };
      for (const k of e.computed ?? [])
        ({ data, info } = computeColumn(data, info, k.name, k.expr));
      const issues = validateModel(exampleModel(e), data, {
        ...DEFAULT_SETTINGS,
        ...e.settings,
        engine: 'r',
      }).filter((i) => i.level === 'error');
      expect(issues, e.id).toEqual([]);
    }
  });
});
