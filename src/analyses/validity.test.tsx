// The validity cards (common method bias, content validity index): options survive a project file, bad values are
// replaced, each card says what it still needs, the inputs a run reads, and the views. (Their results against native R
// and the published table: src/examples/cards/validity.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PlsResult } from '../engine/types';
import { DEFAULT_SETTINGS } from '../model/project';
import type { ModelState } from '../model/project';
import type { CmbResult, CviResult } from '../rengine/validity';
import { ANALYSIS_TYPES } from './registry';
import type { AnalysisCtx } from './types';
import { cmbAnalysis, cmbData, cviAnalysis, kappaBand, KOCK_VIF } from './validity';

const cols = ['a1', 'a2', 'a3', 'b1', 'b2', 'e1', 'e2', 'e3', 'item'];
const data = {
  names: cols,
  cols: cols.map((_, k) => new Float64Array([1, 2, 3, 4].map((v) => ((v * (k + 1)) % 4) + 1))),
};
const model = {
  constructs: [
    {
      id: 'A',
      name: 'A',
      type: 'composite',
      mode: 'A',
      indicators: ['a1', 'a2', 'a3'],
      x: 0,
      y: 0,
      side: 'left',
    },
    {
      id: 'B',
      name: 'B',
      type: 'composite',
      mode: 'A',
      indicators: ['b1', 'b2'],
      x: 0,
      y: 0,
      side: 'left',
    },
  ],
  paths: [{ from: 'A', to: 'B' }],
  moderations: [],
} as unknown as ModelState;
const pls = {
  constructs: ['A', 'B'],
  scores: [new Float64Array([1, 2, 3, 4]), new Float64Array([2, 1, 4, 3])],
} as unknown as PlsResult;
const bare = {
  data,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
} as unknown as AnalysisCtx;
const withModel: AnalysisCtx = { ...bare, model };
const withPls: AnalysisCtx = { ...withModel, pls };
const ENGINE = { package: 'stats', version: '4.6.2' };

describe('validity cards', () => {
  it('are in the Add menu under Measurement', () => {
    for (const id of ['cmb', 'cvi'])
      expect(ANALYSIS_TYPES.find((t) => t.id === id)?.group, id).toBe('Measurement');
    expect(cmbAnalysis.entries!.map((e) => e.options(cmbAnalysis.defaults(bare)).type)).toEqual([
      'harman',
      'vif',
    ]);
  });
  it('parse their options from a file, replacing invalid values', () => {
    expect(
      cmbAnalysis.parseOptions({
        type: 'marker',
        source: 'scores',
        vars: ['a1', 7, 'a1'],
        extraction: 'pca',
      }),
    ).toEqual({ type: 'harman', source: 'model', vars: ['a1'], extraction: 'pca' });
    expect(
      cmbAnalysis.parseOptions({ type: 'vif', source: 'columns', vars: [], extraction: 'ml' }),
    ).toEqual({ type: 'vif', source: 'columns', vars: [], extraction: 'pca' });
    expect(cviAnalysis.parseOptions({ raters: ['e1', 'e2'], item: 3, threshold: 'high' })).toEqual({
      raters: ['e1', 'e2'],
      item: '',
      threshold: 3,
    });
    for (const a of [cmbAnalysis, cviAnalysis]) {
      expect(a.parseOptions(null), a.id).toBeNull();
      expect(a.parseOptions(a.defaults(withModel)), a.id).toEqual(a.defaults(withModel));
    }
    // (a diagram on the canvas: the model is the default source; none: data columns)
    expect(cmbAnalysis.defaults(withModel).source).toBe('model');
    expect(cmbAnalysis.defaults(bare).source).toBe('columns');
  });
  it('say what they still need, and run when complete', () => {
    const o = cmbAnalysis.defaults(bare);
    expect(cmbAnalysis.blocked({ ...o, source: 'columns', vars: ['a1', 'a2'] }, bare)).toMatch(
      /at least 3/,
    );
    expect(
      cmbAnalysis.blocked({ ...o, type: 'vif', source: 'columns', vars: ['a1', 'a2'] }, bare),
    ).toBeNull();
    expect(
      cmbAnalysis.blocked({ ...o, source: 'columns', vars: ['a1', 'a2', 'gone'] }, bare),
    ).toMatch(/gone/);
    expect(cmbAnalysis.blocked({ ...o, source: 'model' }, bare)).toMatch(/Draw a model/);
    expect(cmbAnalysis.blocked({ ...o, source: 'model' }, withModel)).toBeNull();
    expect(cmbAnalysis.blocked({ ...o, type: 'vif', source: 'model' }, withModel)).toMatch(
      /Calculate the PLS-SEM model/,
    );
    expect(cmbAnalysis.blocked({ ...o, type: 'vif', source: 'model' }, withPls)).toBeNull();
    expect(
      cmbAnalysis.blocked(
        { ...o, type: 'harman', source: 'model' },
        { ...bare, data: null, model },
      ),
    ).toMatch(/raw data/);
    const v = cviAnalysis.defaults(bare);
    expect(cviAnalysis.blocked(v, bare)).toMatch(/two experts/);
    expect(cviAnalysis.blocked({ ...v, raters: ['e1', 'e2'], item: 'e1' }, bare)).toMatch(
      /cannot be an expert/,
    );
    expect(
      cviAnalysis.blocked({ ...v, raters: ['e1', 'e2', 'e3'], item: 'item' }, bare),
    ).toBeNull();
    expect(cviAnalysis.blocked({ ...v, raters: ['e1', 'gone'] }, bare)).toMatch(/gone/);
  });
  it('read the model’s indicators for Harman’s test and the construct scores for the VIFs', () => {
    const o = cmbAnalysis.defaults(withPls);
    expect(cmbData({ ...o, type: 'harman' }, withPls)).toMatchObject({
      vars: ['a1', 'a2', 'a3', 'b1', 'b2'],
    });
    expect(cmbData({ ...o, type: 'harman' }, withPls).data).toBe(data);
    const scores = cmbData({ ...o, type: 'vif' }, withPls);
    expect(scores.vars).toEqual(['A', 'B']);
    expect(scores.data?.names).toEqual(['A', 'B']);
    expect(cmbData({ ...o, source: 'columns', vars: ['b2', 'a1'] }, withPls)).toMatchObject({
      vars: ['b2', 'a1'],
    });
  });
  it('change their fingerprint with the inputs that change the result', () => {
    const o = { ...cmbAnalysis.defaults(withPls), type: 'harman' as const };
    const f = cmbAnalysis.fingerprint(o, withPls)!;
    expect(f).toBeTruthy();
    expect(cmbAnalysis.fingerprint({ ...o, extraction: 'fa' }, withPls)).not.toBe(f);
    expect(cmbAnalysis.fingerprint({ ...o, type: 'vif' }, withPls)).not.toBe(f);
    expect(cmbAnalysis.fingerprint({ ...o, type: 'vif' }, withModel)).toBeNull();
    const other = { ...pls, scores: [new Float64Array([1, 2, 3, 5]), pls.scores[1]] } as PlsResult;
    expect(cmbAnalysis.fingerprint({ ...o, type: 'vif' }, { ...withPls, pls: other })).not.toBe(
      cmbAnalysis.fingerprint({ ...o, type: 'vif' }, withPls),
    );
    const v = { raters: ['e1', 'e2'], item: '', threshold: 3 };
    expect(cviAnalysis.fingerprint(v, bare)).not.toBe(
      cviAnalysis.fingerprint({ ...v, threshold: 4 }, bare),
    );
    expect(cviAnalysis.fingerprint(v, bare)).not.toBe(
      cviAnalysis.fingerprint({ ...v, raters: ['e1', 'e3'] }, bare),
    );
  });
  it('band the modified kappa as Polit, Beck & Owen (2007) do', () => {
    expect([1, 0.75, 0.74, 0.6, 0.59, 0.4, 0.39].map(kappaBand)).toEqual([
      'excellent',
      'excellent',
      'good',
      'good',
      'fair',
      'fair',
      'poor',
    ]);
    expect(KOCK_VIF).toBe(3.3);
  });
  it('show the share of variance, the VIFs against 3.3, and the CVI tables', () => {
    const harman: CmbResult = {
      type: 'harman',
      vars: ['a1', 'a2', 'a3'],
      n: 100,
      extraction: 'pca',
      share: 0.62,
      ssLoadings: 1.86,
      eigenvalues: [1.86, 0.8, 0.34],
      proportions: [0.62, 0.2667, 0.1133],
      kaiser: 1,
      loadings: [
        { variable: 'a1', loading: 0.8 },
        { variable: 'a2', loading: 0.7 },
        { variable: 'a3', loading: 0.9 },
      ],
      warnings: [],
      engine: { package: 'psych', version: '2.6.9' },
    };
    const h = renderToStaticMarkup(
      <cmbAnalysis.View
        result={harman}
        options={{ type: 'harman', source: 'columns', vars: [], extraction: 'pca' }}
        current
      />,
    );
    expect(h).toContain('62.0');
    expect(h).toContain('more than half of the variance');
    expect(h).toContain('Podsakoff');
    const vif: CmbResult = {
      type: 'vif',
      vars: ['A', 'B', 'C'],
      n: 344,
      rows: [
        { variable: 'A', vif: 4.3, r2: 0.767 },
        { variable: 'B', vif: 2.1, r2: 0.52 },
        { variable: 'C', vif: 3.1, r2: 0.677 },
      ],
      maxVif: 4.3,
      warnings: [],
      engine: ENGINE,
    };
    const v = renderToStaticMarkup(
      <cmbAnalysis.View
        result={vif}
        options={{ type: 'vif', source: 'model', vars: [], extraction: 'pca' }}
        current
      />,
    );
    expect(v).toContain('construct scores');
    expect(v).toContain('A exceeds 3.3');
    expect(v).toContain('class="num bad"');
    expect(v).toContain('class="num warn"');
    const cvi: CviResult = {
      experts: ['e1', 'e2', 'e3'],
      threshold: 3,
      nItems: 2,
      items: [
        { item: 'Item 1', n: 3, agree: 3, icvi: 1, pc: 0.125, kappa: 1 },
        { item: 'Item 2', n: 3, agree: 2, icvi: 0.6667, pc: 0.375, kappa: 0.4667 },
      ],
      scviAve: 0.8333,
      scviUA: 0.5,
      expertProportions: [
        { expert: 'e1', proportion: 1, rated: 2 },
        { expert: 'e2', proportion: 1, rated: 2 },
        { expert: 'e3', proportion: 0.5, rated: 2 },
      ],
      warnings: [],
      engine: ENGINE,
    };
    const c = renderToStaticMarkup(
      <cviAnalysis.View
        result={cvi}
        options={{ raters: ['e1', 'e2', 'e3'], item: '', threshold: 3 }}
        current
      />,
    );
    expect(c).toContain('S-CVI/Ave');
    expect(c).toContain('excellent');
    expect(c).toContain('fair');
    expect(c).toContain('amber: Item 2');
    expect(
      cmbAnalysis.summary({ type: 'vif', source: 'model', vars: [], extraction: 'pca' }),
    ).toContain('construct scores');
    expect(cviAnalysis.summary({ raters: ['e1', 'e2'], item: '', threshold: 3 })).toBe(
      '2 experts: e1, e2 · relevant from 3',
    );
  });
});
