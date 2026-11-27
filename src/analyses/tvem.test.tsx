// The time-varying effect model card (tvem.tsx): its options, what blocks it, the table's points and the charts.
// The numbers: examples/cards/tvem.webr.test.ts against the tvem package.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import type { TvemResult } from '../rengine/tvem';
import { tablePoints, tvemAnalysis as tvem } from './tvem';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const ctx: AnalysisCtx = {
  data: {
    names: ['y', 't', 'x', 'id'],
    cols: [col(1, 2), col(0, 1), col(3, 4), col(1, 1)],
  },
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
};
const grid = Array.from({ length: 100 }, (_, i) => i / 99);
const result: TvemResult = {
  n: 200,
  clusters: 50,
  knots: 20,
  grid,
  curves: [
    {
      name: '(Intercept)',
      estimate: grid.map(() => 1),
      se: grid.map(() => 0.1),
      lower: grid.map(() => 0.8),
      upper: grid.map(() => 1.2),
    },
    {
      name: 'x',
      estimate: grid,
      se: grid.map(() => 0.1),
      lower: grid.map((g) => g - 0.2),
      upper: grid.map((g) => g + 0.2),
    },
  ],
  edf: 12.3,
  warnings: [],
  engine: { package: 'mgcv', version: '1.9-4' },
};

describe('time-varying effect model card', () => {
  const o = { outcome: 'y', time: 't', subject: 'id', varying: ['x'], knots: 20 };
  it('keeps its options and says what is missing', () => {
    expect(tvem.parseOptions(o)).toEqual(o);
    expect(tvem.parseOptions({})).toEqual({
      outcome: '',
      time: '',
      subject: '',
      varying: [],
      knots: 20,
    });
    expect(tvem.parseOptions({ ...o, knots: 500 })!.knots).toBe(50);
    expect(tvem.blocked!(o, ctx)).toBeNull();
    expect(tvem.blocked!({ ...o, subject: '' }, ctx)).toBeNull();
    expect(tvem.blocked!({ ...o, time: '' }, ctx)).toMatch(/time variable/);
    expect(tvem.blocked!({ ...o, varying: [] }, ctx)).toMatch(/at least one predictor/);
    expect(tvem.blocked!({ ...o, varying: ['t'] }, ctx)).toMatch(/different columns/);
    expect(tvem.blocked!({ ...o, varying: ['zz'] }, ctx)).not.toBeNull();
    expect(tvem.fingerprint(o, ctx)).not.toBe(tvem.fingerprint({ ...o, knots: 10 }, ctx));
    expect(tvem.summary!(o)).toBe('y over t · 1 varying effect');
  });

  it('tabulates eleven evenly spaced points of the grid, its ends included', () => {
    expect(tablePoints(100)).toEqual([0, 10, 20, 30, 40, 50, 59, 69, 79, 89, 99]);
  });

  it('draws each coefficient with its band and tabulates it', () => {
    const html = renderToStaticMarkup(<tvem.View result={result} options={o} current />);
    expect(html).toContain('aria-label="Intercept"');
    expect(html).toContain('aria-label="Effect of x"');
    expect(html).toContain('Effect of x over time');
    expect(html).toContain('200 rows of 50 subjects');
    expect(html).toContain('clustered by subject');
  });
});
