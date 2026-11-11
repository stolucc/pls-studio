// Summary-statistics datasets with several groups (stacked models): each group
// its own covariance matrix and N. The dataset's S and n are the pooled
// within-group covariance matrix and the total N, so that everything that reads
// one matrix (descriptives, the built-in engine, HTMT) keeps working.

import type { MomentData, MomentGroup } from '../engine/types';

/** The pooled within-group covariance matrix (weights n_g − 1) and the total N of several groups' matrices. */
export function pooledMoments(groups: MomentGroup[]): {
  S: number[][];
  n: number;
  means?: number[];
} {
  if (!groups.length) throw new Error('No groups.');
  const p = groups[0].S.length;
  const S = Array.from({ length: p }, () => Array<number>(p).fill(0));
  const w = groups.reduce((s, g) => s + (g.n - 1), 0);
  for (const g of groups)
    for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) S[i][j] += ((g.n - 1) / w) * g.S[i][j];
  const n = groups.reduce((s, g) => s + g.n, 0);
  // Means (when every group has them): the overall mean, weighted by N.
  const means = groups.every((g) => g.means)
    ? Array.from({ length: p }, (_, i) => groups.reduce((s, g) => s + (g.n / n) * g.means![i], 0))
    : undefined;
  return { S, n, ...(means ? { means } : {}) };
}

/** A dataset's moments from its groups' matrices (S and n pooled). */
export function momentsOfGroups(groups: MomentGroup[]): MomentData {
  return { ...pooledMoments(groups), groups };
}
