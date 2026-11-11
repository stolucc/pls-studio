// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { R_PACKAGES } from '../rengine/bridge';
import { parseDeltas, regsemAnalysis as rs, type RegsemResult } from './regularized';
import type { AnalysisCtx } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const K = (id: string, inds: string[]) => ({
  id,
  name: id,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: inds,
  x: 0,
  y: 0,
  side: 'left' as const,
});
const model: ModelState = {
  constructs: [K('A', ['a1', 'a2', 'a3']), K('B', ['b1', 'b2', 'b3'])],
  paths: [{ id: 'p', from: 'A', to: 'B' }],
  moderations: [],
};
const names = model.constructs.flatMap((k) => k.indicators);
const data = {
  names,
  cols: names.map((_, k) =>
    Float64Array.from({ length: 30 }, (_, i) => Math.sin(i * (k + 1.3)) + (i % (k + 2))),
  ),
};
const settings = {
  ...DEFAULT_SETTINGS,
  method: 'cbsem' as const,
  engine: 'r' as const,
  estimator: 'ML' as const,
};
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings,
  pls: null,
  projectName: 'p',
  model,
  ...over,
});

describe('the regularised SEM card (lslx)', () => {
  it('runs on lslx, with lavaan for the model', () => {
    expect(R_PACKAGES.lslx).toEqual(['jsonlite', 'lavaan', 'semTools', 'lslx']);
  });

  it('reads δ values for the elastic net (0–1) and MCP (above 1, or Inf)', () => {
    expect(parseDeltas('1.5, 3, Inf', 'mcp')).toEqual([1.5, 3, 'Inf']);
    expect(parseDeltas('0.5 1', 'enet')).toEqual([0.5, 1]);
    expect(parseDeltas('1', 'mcp')).toBeNull();
    expect(parseDeltas('Inf', 'enet')).toBeNull();
    expect(parseDeltas('1.2', 'enet')).toBeNull();
    expect(parseDeltas('', 'mcp')).toBeNull();
    expect(parseDeltas('anything', 'lasso')).toEqual([]);
  });

  it('validates options from files', () => {
    expect(
      rs.parseOptions({
        penalise: ['paths', 'x'],
        penalty: 'mcp',
        deltas: [1.5, 'Inf', 'drop()'],
        lambdaLength: '30',
        lambdaAuto: false,
        lambdaFrom: -1,
        lambdaTo: 0.6,
        selector: 'aic',
      }),
    ).toEqual({
      penalise: ['paths'],
      penalty: 'mcp',
      selector: 'aic',
      deltas: [3],
      lambdaAuto: false,
      lambdaLength: 30,
      lambdaFrom: 0,
      lambdaTo: 0.6,
    });
    expect(rs.parseOptions({ penalty: 'enet', deltas: [0.25] })).toMatchObject({
      penalise: ['loadings'],
      deltas: [0.25],
      lambdaAuto: true,
      lambdaLength: 50,
    });
    expect(rs.parseOptions({ penalty: 'nonsense' })).toMatchObject({
      penalty: 'lasso',
      deltas: [],
    });
    expect(rs.parseOptions(7)).toBeNull();
  });

  it('says why it cannot run', () => {
    const o = rs.defaults(ctx());
    expect(rs.blocked(o, ctx())).toBeNull();
    expect(rs.blocked(o, ctx({ settings: { ...settings, estimator: 'WLSMV' } }))).toMatch(
      /ML or MLR/,
    );
    expect(rs.blocked(o, ctx({ settings: { ...settings, missing: 'mi' } }))).toMatch(
      /casewise deletion, mean replacement or FIML/,
    );
    expect(rs.blocked({ ...o, penalise: [] }, ctx())).toBe('Choose which parameters to penalise.');
    expect(
      rs.blocked({ ...o, penalise: ['paths'] }, ctx({ model: { ...model, paths: [] } })),
    ).toMatch(/no structural paths/);
    expect(rs.blocked({ ...o, lambdaAuto: false, lambdaFrom: 0.5, lambdaTo: 0.5 }, ctx())).toMatch(
      /largest penalty level/,
    );
    expect(rs.blocked({ ...o, penalty: 'mcp', deltas: [] }, ctx())).toMatch(/at least one δ/);
    expect(
      rs.blocked(o, ctx({ data: { names: ['a1'], cols: [], moments: { S: [[1]], n: 10 } } })),
    ).toMatch(/raw data/);
    expect(rs.fingerprint(o, ctx())).not.toBe(rs.fingerprint({ ...o, penalty: 'ridge' }, ctx()));
  });

  it('shows the selected model, the penalised and free estimates and the path of the estimates', () => {
    const lvl = (lambda: number, values: number[], bic: number) => ({
      lambda,
      delta: null,
      aic: bic + 1,
      bic,
      nonzero: 10,
      df: 5,
      loss: 0.1,
      converged: true,
      values,
    });
    const r: RegsemResult = {
      method: 'lasso',
      selector: 'bic',
      selected: { lambda: 0.2, delta: null },
      path: [lvl(0.1, [0.4, 0.1], 0.5), lvl(0.2, [0.3, 0], 0.4), lvl(0.3, [0.1, 0], 0.45)],
      penalised: ['A → b1', 'B → a1'],
      penalisedKind: ['loading', 'loading'],
      estimates: [
        { label: 'A → a1', kind: 'loading', type: 'free', est: 1, se: 0.1, z: 10, p: 0 },
        { label: 'A → b1', kind: 'loading', type: 'pen', est: 0.3, se: 0.1, z: 3, p: 0.003 },
        { label: 'B → a1', kind: 'loading', type: 'pen', est: 0, se: null, z: null, p: null },
      ],
      test: { chisq: 12.3, df: 5, p: 0.03 },
      fitIndex: { rmsea: 0.05, cfi: 0.98, nnfi: 0.97, srmr: 0.03 },
      n: 100,
      warnings: [],
      engine: { package: 'lslx', version: '0.6.11' },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<rs.View result={r} options={rs.defaults(ctx())} current />));
    expect(host.textContent).toContain('Selected model (BIC)');
    expect(host.textContent).toContain('1 of 2');
    expect(host.textContent).toContain('Free parameters at the selected level');
    expect(host.querySelectorAll('svg.mc-chart path')).toHaveLength(2);
    act(() => root.unmount());
  });
});
