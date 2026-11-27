// The dominance analysis card (dominance.tsx): its options, what blocks it, the complete-dominance pairs and the
// tables. The numbers themselves: examples/cards/dominance.webr.test.ts against domir and relaimpo.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import type { DominanceResult } from '../rengine/dominance';
import { completePairs, dominanceAnalysis as dom, MAX_DOMINANCE_PREDICTORS } from './dominance';
import type { AnalysisCtx } from './types';

const col = (...v: number[]) => Float64Array.from(v);
const ctx: AnalysisCtx = {
  data: { names: ['y', 'a', 'b', 'c'], cols: [col(1, 2), col(2, 3), col(3, 1), col(0, 1)] },
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
};

const result: DominanceResult = {
  outcome: 'y',
  predictors: ['a', 'b', 'c'],
  n: 50,
  r2: 0.5,
  general: [0.1, 0.3, 0.1],
  conditional: [
    [0.2, 0.1, 0.0],
    [0.4, 0.3, 0.2],
    [0.15, 0.1, 0.05],
  ],
  complete: [
    [null, 0, 0.5],
    [1, null, 1],
    [0.5, 0, null],
  ],
  beta: [0.1, 0.5, 0.2],
  r2Alone: [0.2, 0.4, 0.15],
  warnings: [],
  engine: { package: 'stats', version: '4.6.2' },
};

describe('dominance analysis card', () => {
  it('keeps its options and says what is missing', () => {
    const o = { outcome: 'y', predictors: ['a', 'b'] };
    expect(dom.parseOptions(o)).toEqual(o);
    expect(dom.parseOptions({})).toEqual({ outcome: '', predictors: [] });
    expect(dom.blocked!(o, ctx)).toBeNull();
    expect(dom.blocked!({ ...o, outcome: '' }, ctx)).toMatch(/outcome/);
    expect(dom.blocked!({ ...o, predictors: ['a'] }, ctx)).toMatch(/at least two/);
    expect(dom.blocked!({ ...o, predictors: ['a', 'y'] }, ctx)).toMatch(/cannot also be/);
    expect(dom.blocked!({ ...o, predictors: ['a', 'zz'] }, ctx)).not.toBeNull();
    const many = Array.from({ length: MAX_DOMINANCE_PREDICTORS + 1 }, (_, i) => `x${i}`);
    expect(dom.blocked!({ ...o, predictors: many }, ctx)).toMatch(/at most 12/);
    expect(dom.summary!(o)).toBe('y on 2 predictors');
  });

  it('lists the pairs where one predictor dominates another completely', () => {
    expect(completePairs(result)).toEqual([
      ['b', 'a'],
      ['b', 'c'],
    ]);
  });

  it('ranks the predictors by general dominance, with their shares of R²', () => {
    const html = renderToStaticMarkup(<dom.View result={result} options={{} as never} current />);
    expect(html).toContain('General dominance');
    expect(html).toContain('60.0%'); // b: 0.3 of 0.5
    expect(html.indexOf('>b<')).toBeLessThan(html.indexOf('>a<'));
    expect(html).toContain('With 2 others');
    expect(html).toContain('Complete dominance: b over a; b over c.');
    expect(html).toContain('8 subset regressions');
  });
});
