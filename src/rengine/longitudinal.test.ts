import { describe, expect, it } from 'vitest';
import { growthRequest, riclpmRequest } from './longitudinal';

const data = { names: ['t1', 't2', 't3', 'age', 'other'], cols: [1, 2, 3, 4, 5].map((k) => Float64Array.from([k, NaN])) };

describe('longitudinal requests', () => {
  it('send only the chosen columns, missing values as null', () => {
    const g = growthRequest(data, { measures: ['t1', 't2', 't3'], times: [0, 1, 2], shape: 'linear', covariates: ['age'], estimator: 'ML', missing: 'fiml' });
    expect(g.data.names).toEqual(['t1', 't2', 't3', 'age']);
    expect(g.data.cols[0]).toEqual([1, null]);
    expect(g.timeVarying).toEqual([]);
    const tv = growthRequest(data, { measures: ['t1', 't2', 't3'], times: [0, 1, 2], shape: 'linear', covariates: [], timeVarying: ['age', 'other', 't3'], estimator: 'ML', missing: 'fiml' });
    expect(tv.data.names).toEqual(['t1', 't2', 't3', 'age', 'other']);
    expect(tv.timeVarying).toEqual(['age', 'other', 't3']);
    const r = riclpmRequest(data, { x: ['t1', 't2', 't3'], y: ['age', 'other', 't3'], equal: true, estimator: 'MLR', missing: 'casewise' });
    expect(r).toMatchObject({ kind: 'riclpm', equal: true, estimator: 'MLR' });
    expect(r.data.names).toEqual(['t1', 't2', 't3', 'age', 'other']);
  });
});
