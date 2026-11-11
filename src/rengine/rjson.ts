// R's JSON both ways. Replies (auto_unbox): a one-element vector arrives as a scalar, NULL as null, NA/Inf as
// non-numbers. Requests: data columns with missing values as null.

import type { Dataset } from '../engine/types';

/** Any R value as an array: a vector as it is, NULL as none, an unboxed scalar as one element. */
export const rList = <T>(v: unknown): T[] => {
  if (Array.isArray(v)) return v as T[];
  if (v == null) return [];
  return [v] as T[];
};
/** A finite number, or null (NA, NaN, Inf, absent). */
export const rNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The data columns named in `use`, in the dataset's order, missing values as null. */
export function rColumns(data: Dataset, use: Iterable<string>) {
  const set = new Set(use);
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => set.has(n));
  return {
    names: keep.map(([n]) => n),
    cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))),
  };
}
