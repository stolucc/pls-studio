// Summary statistics from raw data: the covariance matrix of chosen columns
// (listwise complete rows, unbiased N − 1) with the means, per group when a
// grouping column is given. For sharing a CB-SEM analysis without the raw data: lavaan refits
// the model from the matrix and N exactly.

import type { Dataset } from '../engine/types';
import { momentsOfGroups } from './moments';

function unbiased(cols: number[][]): { S: number[][]; means: number[] } {
  const n = cols[0].length;
  const means = cols.map((c) => c.reduce((s, v) => s + v, 0) / n);
  const S = cols.map((a, i) =>
    cols.map((b, j) => {
      let s = 0;
      for (let r = 0; r < n; r++) s += (a[r] - means[i]) * (b[r] - means[j]);
      return s / (n - 1);
    }),
  );
  return { S, means };
}

/**
 * The covariance matrix (and N) of `names` over the rows complete in those
 * columns; with `group`, one matrix per value of that column (labelled by its
 * category labels, or the values), pooled into S and n.
 */
export function covarianceDataset(data: Dataset, names: string[], group?: string): Dataset {
  if (data.moments && data.cols.length === 0)
    return { names: data.names, cols: [], moments: data.moments };
  const idx = names.map((n) => data.names.indexOf(n));
  const missing = names.filter((_, k) => idx[k] < 0);
  if (missing.length) throw new Error(`Not in the dataset: ${missing.join(', ')}.`);
  const g = group ? data.names.indexOf(group) : -1;
  if (group && g < 0) throw new Error(`The grouping column “${group}” is not in the dataset.`);
  const rows = data.cols[0]?.length ?? 0;
  const keep: number[] = [];
  for (let r = 0; r < rows; r++)
    if (
      idx.every((k) => !Number.isNaN(data.cols[k][r])) &&
      (g < 0 || !Number.isNaN(data.cols[g][r]))
    )
      keep.push(r);
  const block = (rs: number[]) => {
    if (rs.length < 3) throw new Error('Fewer than three complete rows: no covariance matrix.');
    return unbiased(idx.map((k) => rs.map((r) => data.cols[k][r])));
  };
  if (g < 0) return { names, cols: [], moments: { ...block(keep), n: keep.length } };
  const values = [...new Set(keep.map((r) => data.cols[g][r]))].sort((a, b) => a - b);
  const labels = data.categories?.[group!];
  const groups = values.map((v) => {
    const rs = keep.filter((r) => data.cols[g][r] === v);
    return { label: labels?.[v - 1] ?? String(v), ...block(rs), n: rs.length };
  });
  if (groups.length < 2)
    throw new Error(`The grouping column “${group}” has one value in the complete rows.`);
  return { names, cols: [], moments: momentsOfGroups(groups) };
}
