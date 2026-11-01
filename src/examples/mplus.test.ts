// The Mplus User's Guide examples as package examples: their definitions map
// to the app's model (ordered indicators, freed group parameters by construct
// name, covariates, the disturbance covariance Mplus frees by default) and
// to the native reference (scripts/validation/mplus.R).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, toSpec, validateModel } from '../model/project';
import { parseCsv } from '../engine/dataset';
import { exampleModel, PACKAGE_EXAMPLES } from './packages';
import { exampleTags } from './tags';

// What the Mplus outputs print (scripts/validation/mplus_printed.py); the webR test compares the app with it.
const printed = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'textbook', 'mplus_printed.json'), 'utf8')) as Record<string, { fit: { npar?: number }; estimates: unknown[] }>;
const MPLUS = PACKAGE_EXAMPLES.filter((e) => e.id.startsWith('mplus-'));
const ex = (id: string) => PACKAGE_EXAMPLES.find((e) => e.id === `mplus-${id}`)!;

describe('Mplus User’s Guide examples', () => {
  it('cover the guide’s examples with the reference fixture, shipped data and the guide’s pages', () => {
    expect(MPLUS.map((e) => e.id.slice(6)).sort()).toEqual(['ex3.1', 'ex3.11', 'ex3.5', 'ex3.7', 'ex5.1', 'ex5.11', 'ex5.13', 'ex5.14', 'ex5.15', 'ex5.2', 'ex5.25', 'ex5.6', 'ex5.8', 'ex6.1', 'ex6.10', 'ex6.8', 'ex6.9']);
    for (const e of MPLUS) {
      const key = e.id.slice(6);
      expect(e.data.file).toBe(`examples/mplus/${key}.csv`);
      expect(readFileSync(join(__dirname, '..', '..', 'public', e.data.file!), 'utf8').split('\n')[0].split(',').length).toBeGreaterThan(1);
      expect(e.links[0].url).toBe(`https://www.statmodel.com/usersguide/chap${key[2]}/${key}.html`);
      expect(exampleTags(e)).toContain('Mplus User’s Guide');
      expect(exampleTags(e)).toContain('Shipped data');
      // Every example has the numbers its Mplus output prints (each example has its own data, 5.13 included).
      expect(printed[key]?.estimates.length, key).toBeGreaterThan(0);
      expect(printed[key].fit.npar, key).toBeGreaterThan(0);
    }
  });

  it('carry Mplus’s defaults: mean structure, observed information (expected where the input asks), geomin ε, no mean structure where the input says so', () => {
    for (const key of ['ex3.11', 'ex5.1', 'ex5.6', 'ex5.8', 'ex5.11', 'ex5.15', 'ex5.25']) {
      const m = exampleModel(ex(key));
      expect(m.constant, key).toBeTruthy();
      expect(toSpec(m).information, key).toBe('observed');
    }
    for (const key of ['ex6.1', 'ex6.8', 'ex6.9', 'ex6.10']) expect(exampleModel(ex(key)).information, key).toBe('observed');
    // ex5.14: MODEL = NOMEANSTRUCTURE and INFORMATION = EXPECTED (lavaan's default).
    const m514 = exampleModel(ex('ex5.14'));
    expect(m514.multigroup!.meanStructure).toBe(false);
    expect(m514.information).toBeUndefined();
    expect(toSpec(m514).multigroup!.meanStructure).toBe(false);
    // ex5.25: geomin with ε = 0.0001, Mplus's value for two factors.
    expect(toSpec(exampleModel(ex('ex5.25'))).esem).toMatchObject({ rotation: 'geomin', epsilon: 0.0001 });
  });

  it('build valid models: WLSMV on ordered indicators, freed loadings and intercepts by construct name, the freed disturbance covariance', () => {
    const m52 = exampleModel(ex('ex5.2'));
    expect(m52.ordered).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
    expect(toSpec(m52).ordered).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
    const m515 = exampleModel(ex('ex5.15'));
    const f1 = m515.constructs.find((c) => c.name === 'f1')!;
    expect(m515.multigroup!.free).toEqual([{ kind: 'loading', construct: f1.id, indicator: 'y3' }, { kind: 'intercept', indicator: 'y3' }]);
    expect(toSpec(m515).multigroup!.free).toEqual([{ kind: 'loading', construct: 'f1', indicator: 'y3' }, { kind: 'intercept', indicator: 'y3' }]);
    const m58 = exampleModel(ex('ex5.8'));
    const name = (id: string) => m58.constructs.find((c) => c.id === id)!.name;
    expect(m58.correlations!.filter((k) => k.kind === 'construct').map((k) => [name(k.a), name(k.b)].sort().join('~~'))).toContain('f1~~f2');
    expect(m58.constructs.filter((c) => c.covariate).map((c) => c.name)).toEqual(['x1', 'x2', 'x3']);
    for (const e of MPLUS) {
      if (e.panel) continue;
      const data = parseCsv(readFileSync(join(__dirname, '..', '..', 'public', e.data.file!), 'utf8')).dataset;
      const issues = validateModel(exampleModel(e), data, { ...DEFAULT_SETTINGS, ...e.settings, engine: 'r' }).filter((i) => i.level === 'error');
      expect(issues, e.id).toEqual([]);
    }
  });
});
