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
/**
 * A bound that may be infinite (the open end of a one-sided interval): a finite number, Infinity / -Infinity from
 * R's "Inf" / "-Inf" (ps_inf in R/common.R), or null for a missing value (NA, NaN, absent).
 */
export const rBound = (v: unknown): number | null => {
  if (v === 'Inf') return Infinity;
  if (v === '-Inf') return -Infinity;
  return rNum(v);
};

/** The data columns named in `use`, in the dataset's order, missing values as null. */
export function rColumns(data: Dataset, use: Iterable<string>) {
  const set = new Set(use);
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => set.has(n));
  return {
    names: keep.map(([n]) => n),
    cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))),
  };
}
