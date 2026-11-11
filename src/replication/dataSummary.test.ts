import { describe, expect, it } from 'vitest';
import type { DataSummaryResult } from '../rengine/cbExtras';
import { dataSummaryFiles, refitScript, summaryIsOrdinal } from './dataSummary';

const base: DataSummaryResult = {
  groups: [{
    label: '',
    n: 3,
    variables: ['a', 'b'],
    ordinal: [false, false],
    valid: [3, 3],
    mean: [1.5, 2],
    sd: [0.5, 1],
    cor: [[1, 0.25], [0.25, 1]],
    cov: [[0.25, 0.125], [0.125, 1]],
    means: [1.5, 2],
  }],
  names: { lavaan: ['f', 'a', 'b'], app: ['F', 'a', 'b'] },
  syntax: ['  f =~ 1*a + b'],
  refitCall: 'fit <- sem(model, sample.cov = S, sample.mean = M, sample.nobs = N, estimator = "ML")',
  refitAfter: [],
  refitEstimator: 'ML',
  requestedEstimator: 'MLR',
  estimator: 'ML',
  missing: 'listwise',
  meanstructure: false,
  estimates: { lhs: ['f'], op: ['=~'], rhs: ['b'], group: [1], est: [0.5], se: [null] },
  chisq: 0,
  df: 0,
  warnings: [],
  engine: { package: 'lavaan', version: '0.7-3' },
};

const text = (files: { path: string; data: string | Uint8Array }[], path: string) =>
  String(files.find((f) => f.path === path)?.data);

describe('data summary package', () => {
  it('writes the continuous statistics, the syntax, the estimates and a README', () => {
    const files = dataSummaryFiles(base, 'My project');
    expect(files.map((f) => f.path)).toEqual([
      'groups.csv', 'descriptives.csv', 'correlations.csv', 'covariances.csv', 'means.csv',
      'model.lav', 'estimates.csv', 'refit.R', 'README.txt',
    ]);
    expect(text(files, 'groups.csv')).toBe('group,label,n\n1,,3\n');
    expect(text(files, 'covariances.csv')).toBe(',a,b\na,0.25,0.125\nb,0.125,1\n');
    expect(text(files, 'descriptives.csv')).toContain('a,no,3,1.5,0.5');
    // (=~ guarded against spreadsheet formulas; refit.R strips the apostrophe)
    expect(text(files, 'estimates.csv')).toBe("lhs,op,rhs,group,est,se\nf,'=~,b,1,0.5,NA\n");
    expect(refitScript(base)).toContain('ref$op <- sub("^\'", "", ref$op)');
    const readme = text(files, 'README.txt');
    expect(readme).toContain('Data summary for secondary analysis: My project');
    expect(readme).toContain('contains no case-level data');
    expect(readme).toContain('estimated with MLR');
    expect(readme).toContain('f = F');
    expect(readme).toContain('covariances.csv: the covariance matrix (divisor N − 1)');
    expect(summaryIsOrdinal(base)).toBe(false);
  });

  it('numbers groups, and writes the ordinal statistics and their refit', () => {
    const g = {
      ...base.groups[0],
      ordinal: [true, true],
      cov: undefined,
      means: undefined,
      thresholds: { variable: ['a', 'b'], index: [1, 1], value: [-0.2, 0.3] },
      nacovNames: ['a|t1', 'b|t1', 'a~~b'],
      nacov: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      wlsV: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    };
    const r: DataSummaryResult = {
      ...base,
      groups: [{ ...g, label: 'A' }, { ...g, label: 'B', ordinal: [true, false] }],
      requestedEstimator: 'WLSMV',
      refitEstimator: 'WLSMV',
      refitAfter: ['fit <- mplus_se(fit)'],
    };
    const files = dataSummaryFiles(r, 'p');
    const paths = files.map((f) => f.path);
    expect(paths).toContain('thresholds-group1.csv');
    expect(paths).toContain('nacov-group2.csv');
    expect(paths).toContain('wls_v-group2.csv');
    expect(paths).not.toContain('covariances-group1.csv');
    expect(text(files, 'thresholds-group1.csv')).toBe('variable,threshold,value\na,1,-0.2\nb,1,0.3\n');
    const script = refitScript(r);
    expect(script).toContain('attr(th, "th.idx")');
    expect(script).toContain('fit <- mplus_se(fit)');
    expect(script.indexOf(r.refitCall)).toBeLessThan(script.indexOf('fit <- mplus_se(fit)'));
    const readme = text(files, 'README.txt');
    expect(readme).toContain('group 2 (B): N = 3');
    expect(readme).toContain('both ordinal and continuous indicators');
    expect(readme).toContain('polychoric');
  });
});
