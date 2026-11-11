// The meta-analytic SEM card: the studies' data format (N and a column per pair, either order), strict checks, the
// request, desktop R only (never webR), and the view.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, toSpec, type ModelState } from '../model/project';
import { DESKTOP_ONLY, DesktopOnly, R_PACKAGES } from '../rengine/bridge';
import { useCompute } from '../rengine/compute';
import {
  metaColumns,
  metaDataProblem,
  metaPairs,
  metaSemR,
  metaSemRequest,
  metaSemResult,
  type MetaSemResult,
} from '../rengine/metasem';
import * as runtime from '../rengine/runtime';
import { metaSemAnalysis as t } from './metasem';
import type { AnalysisCtx } from './types';

const F = (name: string, indicators: string[]) => ({
  id: name,
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators,
  x: 0,
  y: 0,
  side: 'left' as const,
});
const model: ModelState = {
  constructs: [F('X', ['a', 'b']), F('Y', ['c'])],
  paths: [],
  moderations: [],
};
const col = (...v: number[]) => Float64Array.from(v);
const data = {
  names: ['N', 'a_b', 'c_a', 'b_c'],
  cols: [col(100, 200, 50), col(0.3, 0.4, NaN), col(0.2, 0.1, 0.3), col(0.5, NaN, 0.4)],
};
const ctx = (over: Partial<AnalysisCtx> = {}): AnalysisCtx => ({
  data,
  info: null,
  settings: { ...DEFAULT_SETTINGS, method: 'cbsem' },
  pls: null,
  projectName: 'p',
  model,
  ...over,
});
const opts = { n: 'N', method: 'REM' as const, reType: 'Diag' as const };

describe('meta-analytic SEM data', () => {
  it('finds each pair’s column in either order, and says which are missing or ambiguous', () => {
    expect(metaPairs(['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ]);
    expect(metaColumns(data.names, ['a', 'b', 'c'])).toEqual({
      columns: ['a_b', 'c_a', 'b_c'],
      missing: [],
      ambiguous: [],
    });
    expect(metaColumns(['a_b'], ['a', 'b', 'c']).missing).toEqual([
      ['a', 'c'],
      ['b', 'c'],
    ]);
    expect(metaColumns(['a_b', 'b_a'], ['a', 'b']).ambiguous).toEqual([['a', 'b']]);
    // ("x_y" with "z" and "x" with "y_z" would both be x_y_z)
    expect(
      metaColumns(['x_y_z', 'x_y', 'x_z', 'y_z', 'x_y_x', 'y_z_x'], ['x_y', 'z', 'x', 'y_z'])
        .ambiguous,
    ).toContainEqual(['x_y', 'z']);
  });
  it('checks the data before a run', () => {
    expect(metaDataProblem(data, ['a', 'b', 'c'], 'N')).toBeNull();
    expect(metaDataProblem(data, ['a', 'b', 'c'], '')).toMatch(/N/);
    expect(metaDataProblem(data, ['a', 'b', 'd'], 'N')).toMatch(
      /No column for the correlation of a and d \(name it a_d\)/,
    );
    expect(
      metaDataProblem(
        {
          names: ['a', 'b'],
          cols: [],
          moments: {
            S: [
              [1, 0],
              [0, 1],
            ],
            n: 10,
          },
        } as never,
        ['a', 'b'],
        'N',
      ),
    ).toMatch(/not a covariance matrix/);
  });
  it('sends one study per row, missing correlations as null, in the bridge’s pair order', () => {
    const r = metaSemRequest(data, toSpec(model), opts);
    expect(r.meta).toEqual({
      method: 'REM',
      reType: 'Diag',
      studies: [
        { n: 100, r: [0.3, 0.2, 0.5] },
        { n: 200, r: [0.4, 0.1, null] },
        { n: 50, r: [null, 0.3, 0.4] },
      ],
    });
    expect(() =>
      metaSemRequest(
        { ...data, cols: [col(100, NaN, 50), ...data.cols.slice(1)] },
        toSpec(model),
        opts,
      ),
    ).toThrow(/Row 2 has no N/);
  });
});

describe('meta-analytic SEM card', () => {
  beforeEach(() => useCompute.setState({ backend: 'browser' } as never));
  it('is a desktop-only package the helper installs; the bridge refuses it in the browser without starting R', async () => {
    expect(DESKTOP_ONLY.has('metaSEM')).toBe(true);
    expect(R_PACKAGES.metaSEM).toEqual(expect.arrayContaining(['OpenMx', 'metaSEM']));
    const txt = readFileSync(
      join(__dirname, '..', '..', 'helper', 'r', 'packages.txt'),
      'utf8',
    ).split('\n');
    expect(txt).toEqual(expect.arrayContaining(['OpenMx', 'metaSEM']));
    const spy = vi.spyOn(runtime, 'withR');
    await expect(metaSemR(data, toSpec(model), opts)).rejects.toThrow(DesktopOnly);
    expect(spy).not.toHaveBeenCalled();
  });
  it('says what it needs; finds the N column; options from a file are bounded', () => {
    expect(t.blocked(opts, ctx())).toMatch(/runs in desktop R/);
    useCompute.setState({ backend: 'helper' } as never);
    expect(t.blocked(opts, ctx())).toBeNull();
    expect(t.blocked(opts, ctx({ settings: { ...DEFAULT_SETTINGS, method: 'pls' } }))).toMatch(
      /CB-SEM/,
    );
    expect(t.blocked(opts, ctx({ model: { ...model, constant: { x: 0, y: 0 } } }))).toMatch(
      /mean structure/,
    );
    expect(t.blocked({ ...opts, n: '' }, ctx())).toMatch(/N/);
    expect(t.defaults(ctx())).toEqual(opts);
    expect(t.parseOptions({ n: 'N', method: 'X', reType: 'Symm' })).toEqual({
      n: 'N',
      method: 'REM',
      reType: 'Symm',
    });
    expect(t.fingerprint(opts, ctx())).toBeTruthy();
    expect(
      t.fingerprint(
        opts,
        ctx({ data: { ...data, cols: [col(100, 201, 50), ...data.cols.slice(1)] } }),
      ),
    ).not.toBe(t.fingerprint(opts, ctx()));
  });
  it('shows stage 2’s estimates and fit and stage 1’s pooled correlations with heterogeneity', () => {
    const r: MetaSemResult = metaSemResult({
      stage1: {
        method: 'REM',
        reType: 'Diag',
        studies: 14,
        totalN: 4496,
        pooled: [
          {
            a: 'A',
            b: 'C',
            r: 0.3897,
            se: 0.0543,
            low: 0.283,
            high: 0.496,
            tau2: 0.0365,
            i2: 0.9326,
          },
        ],
        q: 1220.33,
        qDf: 130,
        qP: 0,
        chisq: null,
        status: 0,
      },
      stage2: {
        params: [
          {
            label: 'AONAlpha',
            kind: 'loading',
            from: 'Alpha',
            to: 'A',
            est: 0.5694,
            se: 0.0524,
            low: 0.4667,
            high: 0.6722,
            z: 10.86,
            p: 0,
          },
          {
            label: 'AlphaWITHBeta',
            kind: 'covariance',
            from: 'Alpha',
            to: 'Beta',
            est: 0.3777,
            se: 0.0474,
            low: 0.285,
            high: 0.471,
            z: 7.97,
            p: 0,
          },
        ],
        fit: {
          n: 4496,
          chisq: 7.8204,
          df: 4,
          p: 0.0984,
          rmsea: 0.0146,
          rmseaLow: 0,
          rmseaHigh: 0.0297,
          srmr: 0.0436,
          cfi: 0.9922,
          tli: 0.9806,
          aic: -0.18,
          bic: -25.82,
        },
        status: 0,
      },
      variables: ['A'],
      warnings: [],
      engine: { package: 'metaSEM', version: '1.5.0', openmx: '2.22.11' },
    });
    expect(r.stage1.chisq).toBeUndefined();
    const h = renderToStaticMarkup(<t.View result={r} options={opts} current />);
    expect(h).toContain('Alpha → A');
    expect(h).toContain('Alpha ↔ Beta');
    expect(h).toContain('Q = 1220.33 on 130 df');
    expect(h).toContain('14 studies, N = 4,496');
  });
});
