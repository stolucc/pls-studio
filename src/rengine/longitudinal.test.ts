import { describe, expect, it } from 'vitest';
import { growthRequest, riclpmRequest, syntaxColumns } from './longitudinal';

const data = {
  names: ['t1', 't2', 't3', 'age', 'other'],
  cols: [1, 2, 3, 4, 5].map((k) => Float64Array.from([k, NaN])),
};

describe('longitudinal requests', () => {
  it('send only the chosen columns, missing values as null', () => {
    const g = growthRequest(data, {
      measures: ['t1', 't2', 't3'],
      times: [0, 1, 2],
      shape: 'linear',
      covariates: ['age'],
      estimator: 'ML',
      missing: 'fiml',
    });
    expect(g.data.names).toEqual(['t1', 't2', 't3', 'age']);
    expect(g.data.cols[0]).toEqual([1, null]);
    expect(g.timeVarying).toEqual([]);
    const tv = growthRequest(data, {
      measures: ['t1', 't2', 't3'],
      times: [0, 1, 2],
      shape: 'linear',
      covariates: [],
      timeVarying: ['age', 'other', 't3'],
      estimator: 'ML',
      missing: 'fiml',
    });
    expect(tv.data.names).toEqual(['t1', 't2', 't3', 'age', 'other']);
    expect(tv.timeVarying).toEqual(['age', 'other', 't3']);
    const r = riclpmRequest(data, {
      x: ['t1', 't2', 't3'],
      y: ['age', 'other', 't3'],
      equal: true,
      estimator: 'MLR',
      missing: 'casewise',
    });
    expect(r).toMatchObject({ kind: 'riclpm', equal: true, estimator: 'MLR' });
    expect(r.data.names).toEqual(['t1', 't2', 't3', 'age', 'other']);
  });

  it('a growth model written as syntax sends the columns it names (not its factors, labels or comments) and the group column', () => {
    const syntax = 'i =~ 1*t1 + 1*t2 + 1*t3  # not other\ns =~ 0*t1 + 1*t2 + 2*t3\ni ~ b*age';
    expect(syntaxColumns(syntax, data.names)).toEqual(['t1', 't2', 't3', 'age']);
    const g = growthRequest(data, {
      measures: [],
      times: [],
      shape: 'linear',
      covariates: [],
      estimator: 'ML',
      missing: 'casewise',
      syntax,
      group: 'other',
    });
    expect(g.data.names).toEqual(['t1', 't2', 't3', 'age', 'other']);
    expect(g).toMatchObject({ syntax, group: 'other' });
  });
});
