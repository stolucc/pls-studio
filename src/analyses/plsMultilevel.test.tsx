// The Multilevel PLS-SEM card (plssem): desktop R only (never webR), what it refuses (model/validate.ts
// plsMultilevelIssues), options from files, the request (columns, random slopes, seed), the reply's parsing and the view.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, toSpec, type ModelState, type Settings } from '../model/project';
import { plsMultilevelIssues, validateModel } from '../model/validate';
import { DESKTOP_ONLY, DesktopOnly } from '../rengine/bridge';
import { useCompute } from '../rengine/compute';
import { plssemR, plssemRequest, plssemResult } from '../rengine/plssem';
import * as runtime from '../rengine/runtime';
import { pathPairs, plsMultilevelAnalysis as t, type PlsMultilevelOptions } from './plsMultilevel';
import type { AnalysisCtx } from './types';

const K = (name: string, indicators: string[], more = {}) => ({ id: `id-${name}`, name, type: 'factor' as const, mode: 'A' as const, indicators, x: 0, y: 0, side: 'left' as const, ...more });
const model: ModelState = {
  constructs: [K('fw', ['y1', 'y2', 'y3']), K('x1', ['x1']), K('x2', ['x2'])],
  paths: [{ id: 'p1', from: 'id-x1', to: 'id-fw' }, { id: 'p2', from: 'id-x2', to: 'id-fw' }], moderations: [],
  multilevel: { column: 'cluster', between: 'factors', betweenCovariates: ['w1'] },
};
const names = ['y1', 'y2', 'y3', 'x1', 'x2', 'w1', 'cluster', 'other'];
const data = { names, cols: names.map((n, k) => Float64Array.from({ length: 40 }, (_, i) => (n === 'cluster' ? 1 + (i % 5) : n === 'w1' ? i % 5 : n === 'other' && i === 3 ? NaN : Math.sin(i * (k + 1.3))))) };
const settings: Settings = { ...DEFAULT_SETTINGS, method: 'pls', missing: 'casewise', seed: 9 };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings, pls: null, projectName: 'p', model, ...over });
const opts: PlsMultilevelOptions = { ...t.defaults(ctx()), slopes: [{ from: 'x1', to: 'fw' }] };

describe('Multilevel PLS-SEM: what plssem cannot estimate is refused', () => {
  it('accepts the vignette’s shape', () => {
    expect(plsMultilevelIssues(model, data, settings, opts.slopes)).toEqual([]);
  });
  it('refuses composites, higher-order constructs, interactions, a saturated between level and other missing-value treatments', () => {
    const issues = (m: Partial<ModelState>, s = settings, slopes = opts.slopes) => plsMultilevelIssues({ ...model, ...m }, data, s, slopes).join(' ');
    expect(issues({ constructs: [K('fw', ['y1', 'y2', 'y3'], { mode: 'B', type: 'composite' }), ...model.constructs.slice(1)] })).toMatch(/"fw" is a composite \(Mode B\).*common factors only/);
    // (a single indicator enters as its variable, whatever its mode)
    expect(issues({ constructs: [model.constructs[0], K('x1', ['x1'], { type: 'composite' }), model.constructs[2]] })).toBe('');
    expect(issues({ constructs: [...model.constructs, K('H', [], { components: ['id-fw'] })] })).toMatch(/higher-order/);
    expect(issues({ moderations: [{ id: 'm', path: 'p1', moderator: 'id-x2' }] })).toMatch(/without interaction terms/);
    expect(issues({ multilevel: { column: 'cluster', between: 'saturated' } })).toMatch(/needs a model between clusters/);
    expect(issues({}, { ...settings, missing: 'fiml' })).toMatch(/casewise deletion or mean replacement/);
    expect(issues({ multilevel: { column: 'cluster', between: 'model', betweenModel: [{ lhs: 'fb', op: '=~', rhs: [{ name: 'y1' }, { name: 'y2', fixed: 1 }] }, { lhs: 'fb', op: '~1', rhs: [{ name: '1' }] }] } }))
      .toMatch(/remove fixed values.*no intercepts/);
    expect(issues({ multilevel: { column: 'cluster', between: 'model', betweenModel: [{ lhs: 'fb', op: '~', rhs: [{ name: 'nope' }] }] } })).toMatch(/“nope” in the between-level model/);
    expect(issues({ multilevel: { column: 'y1', between: 'same' } })).toMatch(/“y1” is an indicator/);
    expect(issues({ multilevel: { column: 'cluster', between: 'factors', betweenCovariates: ['x1'] } })).toMatch(/“x1” is in the model/);
    expect(issues({}, settings, [{ from: 'x1', to: 'x2' }])).toMatch(/x1 → x2 is not a path/);
    expect(plsMultilevelIssues({ ...model, multilevel: undefined }, data, settings)).toEqual([expect.stringMatching(/Choose the cluster column/)]);
    expect(plsMultilevelIssues(model, { ...data, moments: { S: [[1]], n: 10 } }, settings).join(' ')).toMatch(/raw data/);
  });
  it('the Model tab’s PLS-SEM says the clustering is the card’s', () => {
    const issues = validateModel(model, data, settings);
    expect(issues.some((i) => i.level === 'warning' && /Multilevel PLS-SEM card on the Analyses tab \(plssem, desktop R\)/.test(i.message))).toBe(true);
  });
});

describe('Multilevel PLS-SEM card', () => {
  beforeEach(() => useCompute.setState({ backend: 'browser' } as never));
  it('is desktop-only, installed by the helper; the bridge never starts R in the browser', async () => {
    expect(DESKTOP_ONLY.has('plssem')).toBe(true);
    expect(readFileSync(join(__dirname, '..', '..', 'helper', 'r', 'packages.txt'), 'utf8').split('\n')).toContain('plssem');
    const spy = vi.spyOn(runtime, 'withR');
    await expect(plssemR({ data, spec: toSpec(model), missing: 'casewise' }, { slopes: [], consistent: false, scheme: 'path', bootR: 0, seed: 1 })).rejects.toThrow(DesktopOnly);
    expect(spy).not.toHaveBeenCalled();
  });
  it('says what it needs; options from a file are bounded; the fingerprint follows the slopes and the seed', () => {
    expect(t.blocked(opts, ctx())).toMatch(/desktop R/);
    useCompute.setState({ backend: 'helper' } as never);
    expect(t.blocked(opts, ctx())).toBeNull();
    expect(t.blocked(opts, ctx({ settings: { ...settings, method: 'cbsem' } }))).toMatch(/choose PLS-SEM/);
    expect(t.blocked(opts, ctx({ model: { ...model, multilevel: undefined } }))).toMatch(/Choose the cluster column/);
    // (a slope of a path no longer drawn is dropped, not refused)
    expect(t.blocked({ ...opts, slopes: [{ from: 'x2', to: 'x1' }] }, ctx())).toBeNull();
    expect(t.parseOptions({ slopes: [{ from: 'x1', to: 'fw' }, { from: 'x1', to: 'fw' }, { from: '', to: 'fw' }, 7], scheme: 'odd', bootR: 1e9, bootstrap: 'yes', consistent: true }))
      .toEqual({ slopes: [{ from: 'x1', to: 'fw' }], consistent: true, scheme: 'path', bootstrap: false, bootR: 10000 });
    expect(t.parseOptions(null)).toBeNull();
    expect(t.fingerprint(opts, ctx())).not.toBe(t.fingerprint({ ...opts, slopes: [] }, ctx()));
    expect(t.fingerprint(opts, ctx())).not.toBe(t.fingerprint(opts, ctx({ settings: { ...settings, seed: 10 } })));
    expect(t.fingerprint(opts, ctx({ model: { ...model, multilevel: undefined } }))).toBeNull();
    expect(pathPairs(ctx())).toEqual([{ from: 'x1', to: 'fw' }, { from: 'x2', to: 'fw' }]);
    expect(t.summary(opts)).toBe('random slopes: x1 → fw');
    expect(t.summary({ ...opts, slopes: [], bootstrap: true })).toBe('random intercepts · bootstrap 500');
  });
  it('sends the model’s columns, the cluster and covariate columns, the slopes, the seed and the bootstrap', () => {
    const r = plssemRequest({ data, spec: toSpec(model), missing: 'casewise' }, { slopes: opts.slopes, consistent: false, scheme: 'centroid', bootR: 200, seed: 9 });
    expect(r.data.names).toEqual(['y1', 'y2', 'y3', 'x1', 'x2', 'w1', 'cluster']);
    expect(r.model.slopes).toEqual([{ from: 'x1', to: 'fw' }]);
    expect(r.model.multilevel).toEqual(model.multilevel);
    expect(r.options).toEqual({ consistent: false, scheme: 'centroid', seed: 9, bootstrap: true, bootR: 200 });
    expect(r.missing).toBe('casewise');
    expect(plssemRequest({ data, spec: toSpec(model), missing: 'mean' }, { slopes: [], consistent: true, scheme: 'path', bootR: 0, seed: 1 }).options).toEqual({ consistent: true, scheme: 'path', seed: 1 });
    expect(() => plssemRequest({ data, spec: toSpec({ ...model, multilevel: undefined }), missing: 'casewise' }, { slopes: [], consistent: false, scheme: 'path', bootR: 0, seed: 1 })).toThrow(/needs clusters/);
  });
  it('reads the reply (R’s single values and empty lists) and shows both levels, ICCs, slopes, fit with plssem’s note, and the syntax', () => {
    const raw = {
      levels: [
        { level: 1, rows: [{ lhs: 'fw', op: '=~', rhs: 'y1', est: 0.716, se: 0.013, z: 53.6, p: 0, lo: 0.69, hi: 0.743 }, { lhs: 'fw', op: '~', rhs: 'x1', est: 0.483, se: null }, { lhs: 'fw', op: '~~', rhs: 'fw', est: 0.577 }],
          r2: { names: 'fw', values: 0.423 }, r2Indicators: { names: ['y1'], values: [0.51] }, fit: { chisq: 7.22, df: 6, rmsea: 0.008, srmr: 0.0065 } },
        { level: 2, rows: [{ lhs: 'fw (between)', op: '~', rhs: 'w1', est: 0.16 }, { lhs: 'x1 → fw (slope)', op: '~', rhs: 'w1', est: 0.176 }], r2: { names: [], values: [] }, r2Indicators: {}, fit: [] },
      ],
      thresholds: { variable: 'y1', threshold: 't1', est: -2.7, se: null },
      icc: { names: ['y1'], values: [0.332] }, slopes: { name: 'x1 → fw (slope)', sd: 0.19 }, n: 3000, clusters: 200, iterations: 101, converged: true, admissible: true,
      estimator: 'MC-PLSc-MLM', consistent: false, scheme: 'path', missing: 'casewise', seed: 1, bootR: 100, ordered: [], fitNote: 'Fit measures for MC-PLSc models are under development!',
      syntax: ['level: 1', '  fw =~ y1 + y2 + y3'], warnings: [], engine: { package: 'plssem', version: '0.2.0' },
    };
    const r = plssemResult(raw);
    expect(r.levels[0].r2).toEqual([{ name: 'fw', value: 0.423 }]);
    expect(r.levels[1].fit).toBeNull();
    expect(r.slopes).toEqual([{ name: 'x1 → fw (slope)', sd: 0.19 }]);
    expect(r.levels[0].rows[1]).toMatchObject({ se: null, z: null, p: null });
    const h = renderToStaticMarkup(<t.View result={r} options={opts} current />);
    expect(h).toContain('3000 cases in 200 clusters');
    expect(h).toContain('depend on the seed (1');
    expect(h).toContain('Level 1 (within clusters): loadings');
    expect(h).toContain('Level 2 (between clusters): paths');
    expect(h).toContain('fw → y1');
    expect(h).toContain('fw (variance)');
    expect(h).toContain('[0.690, 0.743]');
    expect(h).toContain('Intraclass correlations');
    expect(h).toContain('Thresholds (ordinal variables)');
    expect(r.thresholds).toEqual([{ variable: 'y1', threshold: 't1', est: -2.7, se: null }]);
    expect(h).toContain('Random slopes');
    expect(h).toContain('under development');
    expect(h).toContain('fw =~ y1 + y2 + y3');
    const noBoot = renderToStaticMarkup(<t.View result={{ ...r, bootR: 0 }} options={opts} current />);
    expect(noBoot).toContain('No standard errors');
    expect(noBoot).not.toContain('Std. error');
  });
});
