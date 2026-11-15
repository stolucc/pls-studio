// Modification indices: lavaan reports one for every fixed parameter, and the
// results table shows those at or above a minimum the user chooses. The
// default is 3.84, the critical value of χ²(1) at α = .05: freeing that one
// parameter would improve the fit significantly at the .05 level (Sörbom
// 1989). Any minimum from 0 up is respected, smaller ones included.

import { clampNum } from '../parse';

/** χ²(1) at α = .05: the default minimum and the checklist's count. */
export const MI_SIGNIFICANT = 3.84;

/** The minimum typed into the field: a number from 0 up; empty or not a number gives the default. */
export function miMinimum(text: string): number {
  return clampNum(text, 0, Infinity, MI_SIGNIFICANT);
}

/** The indices at or above the minimum, in their order (largest first). */
export function miAtLeast<T extends { mi: number }>(all: T[], minimum: number): T[] {
  return all.filter((m) => m.mi >= minimum);
}
