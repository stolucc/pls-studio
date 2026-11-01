import { describe, expect, it } from 'vitest';
import { parseCovMatrixCsv } from './matrix';

describe('covariance matrix CSV', () => {
  it('reads a labelled square matrix, with or without a leading row of means', () => {
    expect(parseCovMatrixCsv(',a,b\na,1,0.5\nb,0.5,2\n')).toEqual({ names: ['a', 'b'], S: [[1, 0.5], [0.5, 2]] });
    expect(parseCovMatrixCsv(',a,b\nmean,10,20\na,1,0.5\nb,0.5,2\n')).toEqual({ names: ['a', 'b'], S: [[1, 0.5], [0.5, 2]], means: [10, 20] });
    expect(parseCovMatrixCsv(',a,b\n(Means),10,20\na,1,0.5\nb,0.5,2\n')!.means).toEqual([10, 20]);
    expect(parseCovMatrixCsv(',a,b\nmean,10,x\na,1,0.5\nb,0.5,2\n')).toBeNull();
    expect(parseCovMatrixCsv(',a,b\na,1,0.5\nb,0.6,2\n')).toBeNull();  // not symmetric
  });
});
