// A sample covariance matrix that is not positive definite (a scale score next
// to its own items, a constant column) is reported as such, naming the
// variables, by every estimator: ULS used to crash with a TypeError and ML to
// report that no starting values could be found.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { estimateCb } from './cbsem';
import { parseCsv } from './dataset';
import type { Dataset, ModelSpec } from './types';

const hs = parseCsv(
  readFileSync(
    join(__dirname, '__fixtures__', 'validation', 'data', 'holzinger_swineford.csv'),
    'utf8',
  ),
).dataset;
const col = (name: string) => hs.cols[hs.names.indexOf(name)];

/** The data plus one more column. */
const withColumn = (name: string, values: Float64Array): Dataset => ({
  names: [...hs.names, name],
  cols: [...hs.cols, values],
});

const spec = (third: string): ModelSpec => ({
  constructs: [
    { name: 'visual', type: 'factor', mode: 'A', indicators: ['x1', 'x2', third] },
    { name: 'textual', type: 'factor', mode: 'A', indicators: ['x4', 'x5', 'x6'] },
  ],
  paths: [{ from: 'visual', to: 'textual' }],
});

describe('a covariance matrix that is not positive definite', () => {
  const score = Float64Array.from(col('x1'), (v, r) => (v + col('x2')[r]) / 2);
  const data = withColumn('score', score);

  for (const estimator of ['ML', 'GLS', 'ULS', 'MLR'] as const)
    it(`is named, with the variables involved (${estimator})`, () => {
      expect(() => estimateCb(data, spec('score'), 'casewise', estimator)).toThrow(
        'The indicator covariance matrix is not positive definite: x1, x2, score are (nearly) linearly dependent',
      );
    });

  it('names a constant variable', () => {
    const constant = withColumn('flat', new Float64Array(hs.cols[0].length).fill(3));
    expect(() => estimateCb(constant, spec('flat'), 'casewise', 'ULS')).toThrow(
      /flat has no variance/,
    );
  });

  it('leaves a regular model alone', () => {
    expect(estimateCb(hs, spec('x3'), 'casewise', 'ULS').converged).toBe(true);
  });
});
