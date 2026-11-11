import type { Dataset } from '../engine/types';
import type { DataInfo } from '../model/project';

/**
 * Reverse-code Likert-type items: x becomes min + max - x on the scale min..max
 * (e.g. 1..5: 1 <-> 5, 2 <-> 4). Applying it again with the same scale undoes
 * it; DataInfo.reversed records which columns are reversed, and on which scale.
 */
export function reverseCode(
  data: Dataset,
  info: DataInfo,
  names: string[],
  min: number,
  max: number,
): { data: Dataset; info: DataInfo; undone: string[] } {
  if (data.moments && data.cols.length === 0)
    throw new Error('Reverse-coding needs raw data; this dataset is a covariance matrix.');
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max)
    throw new Error('The scale needs a lowest value below its highest value.');
  const reversed = [...(info.reversed ?? [])];
  const undone: string[] = [];
  const cols = [...data.cols];
  for (const name of names) {
    const j = data.names.indexOf(name);
    if (j < 0) throw new Error(`“${name}” is not in the dataset.`);
    if (data.categories?.[name])
      throw new Error(`“${name}” is a text column; only numeric items can be reverse-coded.`);
    const outside = Array.from(data.cols[j]).filter(
      (v) => !Number.isNaN(v) && (v < min || v > max),
    );
    if (outside.length)
      throw new Error(`“${name}” has values outside ${min}–${max} (e.g. ${outside[0]}).`);
    const prior = reversed.findIndex((r) => r.name === name);
    if (prior >= 0 && (reversed[prior].min !== min || reversed[prior].max !== max)) {
      throw new Error(
        `“${name}” is already reversed on the scale ${reversed[prior].min}–${reversed[prior].max}; reverse it again on that scale first.`,
      );
    }
    cols[j] = data.cols[j].map((v) => (Number.isNaN(v) ? v : min + max - v));
    if (prior >= 0) {
      reversed.splice(prior, 1);
      undone.push(name);
    } else reversed.push({ name, min, max });
  }
  const { reversed: _r, ...rest } = info;
  return {
    data: { ...data, cols },
    info: { ...rest, ...(reversed.length ? { reversed } : {}) },
    undone,
  };
}

/** The scale of the selected columns as observed (lowest and highest value). */
export function observedRange(data: Dataset, names: string[]): [number, number] | null {
  let lo = Infinity,
    hi = -Infinity;
  for (const n of names) {
    const c = data.cols[data.names.indexOf(n)];
    if (!c) continue;
    for (const v of c)
      if (!Number.isNaN(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
  }
  return Number.isFinite(lo) && lo < hi ? [lo, hi] : null;
}
