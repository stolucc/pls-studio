import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import type { NcaResult } from '../rengine/nca';
import { ncaAnalysis as t, NcaView } from './nca';
import type { AnalysisCtx } from './types';

const data = { names: ['x', 'y', 'z'], cols: [Float64Array.from([1, 2, 3]), Float64Array.from([2, 3, 5]), Float64Array.from([0, 0, 1])] };
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({ data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p', ...over });
const o = { source: 'data' as const, x: ['x'], y: 'y', permutations: 100, outliers: false };

describe('NCA card', () => {
  it('validates options from files', () => {
    expect(t.parseOptions(null)).toBeNull();
    expect(t.parseOptions({ source: 'evil', x: ['a', 'a', 3], y: 'b', permutations: 1e9 }))
      .toEqual({ source: 'data', x: ['a'], y: 'b', permutations: 20000, outliers: false });
    expect(t.parseOptions({ source: 'scores', x: 'no', y: 4, outliers: 'yes' }))
      .toEqual({ source: 'scores', x: [], y: '', permutations: 1000, outliers: false });
    expect(t.parseOptions({ ...o, outliers: true })?.outliers).toBe(true);
    expect(t.defaults(ctx()).outliers).toBe(true);
  });

  it('says why it cannot run', () => {
    expect(t.blocked(o, ctx())).toBeNull();
    expect(t.blocked({ ...o, y: '' }, ctx())).toBe('Choose the outcome (Y).');
    expect(t.blocked({ ...o, x: [] }, ctx())).toBe('Choose at least one condition (X).');
    expect(t.blocked({ ...o, x: ['q'] }, ctx())).toBe('Not in the data: q.');
    expect(t.blocked(o, ctx({ data: null }))).toContain('needs raw data');
    expect(t.blocked(o, ctx({ data: { names: ['x', 'y'], cols: [], moments: { S: [[1, 0], [0, 1]], n: 10 } } }))).toContain('needs raw data');
    expect(t.blocked({ ...o, source: 'scores' }, ctx())).toContain('Calculate a PLS-SEM model first');
  });

  it('summarises the robustness checks', () => {
    expect(t.summary(o)).toBe('x → y · 100 permutations');
    expect(t.summary({ ...o, outliers: true })).toBe('x → y · 100 permutations · robustness checks');
  });

  it('fingerprints only the columns it uses', () => {
    const f = t.fingerprint(o, ctx());
    expect(f).toBeTruthy();
    expect(t.fingerprint(o, ctx({ data: { ...data, cols: [data.cols[0], data.cols[1], Float64Array.from([9, 9, 9])] } }))).toBe(f);
    expect(t.fingerprint(o, ctx({ data: { ...data, cols: [Float64Array.from([1, 2, 4]), data.cols[1], data.cols[2]] } }))).not.toBe(f);
    expect(t.fingerprint({ ...o, source: 'scores' }, ctx())).toBeNull();
  });

  it('shows the robustness tables only when the checks ran', () => {
    const condition = {
      x: 'x', n: 3, scope: [1, 3, 1, 3] as [number, number, number, number],
      ceFdh: 0.25, crFdh: 0.2, intercept: null, slope: null, accuracy: null,
      p: { ce_fdh: 0.04, cr_fdh: 0.2 },
      peers: { x: [1], y: [1] }, points: { x: [1], y: [1] },
      bottleneck: [{ y: 0, ceFdh: null, crFdh: null }],
    };
    const r: NcaResult = {
      y: 'y', permutations: 100, warnings: [], engine: { package: 'R', version: '4' },
      conditions: [condition],
    };
    expect(renderToStaticMarkup(<NcaView r={r} />)).not.toContain('Potential outliers');
    const robustness = {
      outliers: {
        ceFdh: [{ case: 7, d: 0.4, change: 0.15, percent: 60, ceiling: true, scope: false }],
        crFdh: [{ case: 2, d: null, change: 0, percent: null, ceiling: false, scope: true }],
      },
      without: [{ case: 7, n: 2, ceFdh: 0.4, crFdh: 0.3, p: { ce_fdh: 0.01, cr_fdh: 0.5 } }],
    };
    const html = renderToStaticMarkup(<NcaView r={{ ...r, conditions: [{ ...condition, robustness }] }} />);
    expect(html).toContain('Robustness: ceiling technique and outliers');
    expect(html).toContain('without case 7');
    expect(html).toContain('60.0%');
    expect(html).toContain('∞');
    expect(html).toContain('Potential outliers (CR-FDH)');
  });
});
