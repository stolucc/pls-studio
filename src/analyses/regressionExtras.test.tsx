// The linear regression's extras: blocks and case diagnostics in the options (files, request, what blocks a run),
// the flags' cut-offs, the saved columns aligned with the data rows, and the views.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { regressionRequest, type CaseDiagnostics } from '../rengine/regression';
import { regressionAnalysis as t, parseLinearExtras, regressionColumns } from './regression';
import {
  caseColumns,
  caseCutoffs,
  caseFlags,
  HierarchicalBlocks,
  TermDetails,
} from './regressionExtras';
import { DEFAULT_SETTINGS } from '../model/project';
import type { AnalysisCtx } from './types';

const base = { ...t.defaults({} as never), outcome: 'y', predictors: ['a'] };
const data = {
  names: ['y', 'a', 'b', 'c'],
  cols: [0, 1, 2, 3].map((k) => Float64Array.from({ length: 20 }, (_, i) => Math.sin(i + k) + i)),
};
const ctx = { data, info: null, settings: DEFAULT_SETTINGS, pls: null } as unknown as AnalysisCtx;

describe('linear regression extras: options', () => {
  it('parses blocks and case diagnostics from files, dropping empty blocks', () => {
    expect(
      parseLinearExtras({ blocks: [['b'], [], 'x', ['c', 3]], caseDiagnostics: true }),
    ).toEqual({
      blocks: [['b'], ['c']],
      caseDiagnostics: true,
    });
    expect(parseLinearExtras({ caseDiagnostics: 'yes' })).toEqual({});
    const o = t.parseOptions({ ...base, blocks: [['b', 'c']] })!;
    expect(o.blocks).toEqual([['b', 'c']]);
  });

  it('sends blocks and case diagnostics for a linear model only, with their columns', () => {
    const o = { ...base, blocks: [['b'], ['c']], caseDiagnostics: true };
    const req = regressionRequest(data, { ...o, confidence: 0.95 });
    expect(req.blocks).toEqual([['b'], ['c']]);
    expect(req.caseDiagnostics).toBe(true);
    expect(req.data.names).toEqual(['y', 'a', 'b', 'c']);
    expect(regressionColumns(o)).toEqual(['y', 'a', 'b', 'c']);
    const poisson = regressionRequest(data, { ...o, family: 'poisson', confidence: 0.95 });
    expect(poisson.blocks).toBeUndefined();
    expect(poisson.caseDiagnostics).toBeUndefined();
    // Blocks change the fingerprint (a result without them is stale).
    expect(t.fingerprint(o, ctx)).not.toBe(t.fingerprint(base, ctx));
  });

  it('blocks a predictor in two blocks, the outcome in a block, and blocks without a first block', () => {
    expect(t.blocked({ ...base, blocks: [['a']] }, ctx)).toMatch(/one block only/);
    expect(t.blocked({ ...base, blocks: [['b'], ['b']] }, ctx)).toMatch(/one block only/);
    expect(t.blocked({ ...base, blocks: [['y']] }, ctx)).toMatch(/outcome/);
    expect(t.blocked({ ...base, predictors: [], blocks: [['b']] }, ctx)).toMatch(
      /predictor|first block/,
    );
    expect(t.blocked({ ...base, blocks: [['b']] }, ctx)).toBeNull();
  });
});

const cases: CaseDiagnostics = {
  row: [1, 2, 4, 5],
  fitted: [1, 2, 3, 4],
  residual: [0.1, -0.2, 0.3, 2],
  standardized: [0.2, -0.4, 0.5, 3.5],
  studentized: [0.2, -0.4, 0.5, 5],
  leverage: [0.2, 0.3, 0.9, 0.6],
  cooks: [0.01, 0.02, 0.5, 2],
  dfbetas: [
    { term: '(Intercept)', values: [0.1, 0.2, 0.3, 0.4] },
    { term: 'a', values: [0.1, -0.2, 1.2, -0.3] },
  ],
};

describe('linear regression extras: case diagnostics', () => {
  it('flags by the usual cut-offs', () => {
    expect(caseCutoffs(cases)).toEqual({ residual: 3, leverage: 1, cooks: 1, dfbetas: 1 });
    expect(caseFlags(cases, 0).flags).toEqual([]);
    expect(caseFlags(cases, 2)).toEqual({ flags: ['DFBETAS (a)'], maxAbs: 1.2, maxTerm: 'a' });
    expect(caseFlags(cases, 3).flags).toEqual(['residual', 'Cook’s D']);
  });

  it('saves full-length columns, blank where a row was left out, under free names', () => {
    const cols = caseColumns(cases, 5, 'y', ['y', 'pred_y']);
    expect(cols.map((c) => c.name)).toEqual([
      'pred_y_2',
      'resid_y',
      'zresid_y',
      'sresid_y',
      'lever_y',
      'cook_y',
    ]);
    expect(Array.from(cols[0].col)).toEqual([1, 2, NaN, 3, 4]);
    expect(Array.from(cols[5].col)).toEqual([0.01, 0.02, NaN, 0.5, 2]);
  });
});

describe('linear regression extras: views', () => {
  it('shows the R² change of each block and the terms’ correlations', () => {
    const blocks = renderToStaticMarkup(
      <HierarchicalBlocks
        r={
          {
            input: { blocks: [['b']] },
            blocks: [
              {
                block: 1,
                r2: 0.43,
                adj_r2: 0.4,
                r2_change: 0.43,
                f_change: 16.77,
                df1: 2,
                df2: 44,
                p_change: 0.000004,
              },
              {
                block: 2,
                r2: 0.65,
                adj_r2: 0.62,
                r2_change: 0.22,
                f_change: 13.02,
                df1: 1,
                df2: 43,
                p_change: 0.00004,
              },
            ],
          } as never
        }
        o={{ predictors: ['a'], interactions: [['a', 'c']] }}
      />,
    );
    expect(blocks).toContain('R² change by block');
    expect(blocks).toContain('a, a × c');
    expect(blocks).toContain('+ b');
    expect(blocks).toContain('16.77');
    const terms = renderToStaticMarkup(
      <TermDetails
        details={[
          {
            term: 'a',
            beta: -0.2,
            zero_order: -0.6,
            partial: -0.36,
            part: -0.18,
            tolerance: 0.08,
            vif: 12.5,
          },
        ]}
      />,
    );
    expect(terms).toContain('Part r');
    expect(terms).toContain('12.50');
  });
});
