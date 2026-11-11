// The dataset as the analyses see it is derived from a "base" dataset: the
// base is the data with the cases excluded in the app (outliers, …) left out,
// with the original values of user-missing codes. On top of it the missing
// codes are masked (data/missingCodes.ts) and the dataset filter leaves out
// the rows where its condition is not true. The filter's rows are kept as the
// last entry of droppedRows (so they are saved and restored like any
// exclusion), with their original values; both are derived again whenever the
// data change: every change goes to the base and the derived state is rebuilt
// from it (transformData).

import type { Dataset } from '../engine/types';
import type { DataInfo } from '../model/project';
import { excludeRows, restoreRows, type RowExclusion } from '../model/rows';
import { columnsIn, evaluate, parseFormula, recomputeAll } from './compute';
import { codesColumnError, mask, unmask, withCodes, type MissingCodes } from './missingCodes';

type Data = { data: Dataset; info: DataInfo };

/** The exclusion that holds the rows the filter leaves out (the last one, when there is a filter). */
export function filterLayer(info: DataInfo): RowExclusion | undefined {
  const last = info.droppedRows?.[info.droppedRows.length - 1];
  return last?.filter ? last : undefined;
}

/** The info with these exclusions (the field left out when there are none). */
function withDropped(info: DataInfo, dropped: RowExclusion[]): DataInfo {
  const { droppedRows: _d, ...rest } = info;
  return dropped.length ? { ...rest, droppedRows: dropped } : rest;
}

/**
 * The base dataset: the masked missing codes back to their values and the rows the filter left
 * out put back (the codes and the filter's condition stay in the info).
 */
export function toBase(data: Dataset, info: DataInfo): Data {
  const plain = unmask(data, info);
  const layer = filterLayer(plain.info);
  if (!layer) return plain;
  const others = plain.info.droppedRows!.slice(0, -1);
  const back = restoreRows(plain.data, { ...plain.info, droppedRows: [layer] });
  return { data: back.data, info: withDropped(back.info, others) };
}

/** Why a filter condition cannot be used with this dataset, or null when it can. */
export function filterError(expr: string, data: Dataset): string | null {
  try {
    const node = parseFormula(expr);
    const gone = columnsIn(node).filter((c) => !data.names.includes(c));
    if (gone.length) return `“${gone[0]}” is not a column of the dataset.`;
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * Which rows a filter keeps: those where the condition is true. Rows where it is false or
 * missing (a missing value in a column it reads) are left out, as SPSS's FILTER does.
 */
export function filterKeeps(data: Dataset, expr: string): boolean[] {
  const values = evaluate(parseFormula(expr), data);
  return Array.from(values, (v) => !Number.isNaN(v) && v !== 0);
}

/**
 * Derive the analysed dataset from the base: mask the missing codes, recompute the computed
 * columns (when asked, or when codes or a filter may have changed what they read), then apply
 * the filter (evaluated with the codes missing; the rows it leaves out keep their values).
 */
export function fromBase(data: Dataset, info: DataInfo, recompute = false): Data {
  let out = mask(data, info);
  if (recompute || info.filter || info.missingCodes?.length) out = recomputeAll(out.data, out.info);
  if (!info.filter) return out;
  const keeps = filterKeeps(out.data, info.filter.expr);
  const drop: number[] = [];
  keeps.forEach((keep, i) => {
    if (!keep) drop.push(i + 1);
  });
  if (!drop.length) return out;
  const plain = unmask(out.data, out.info);
  const before = plain.info.droppedRows?.length ?? 0;
  const r = excludeRows(plain.data, plain.info, drop, `filter: ${info.filter.expr}`);
  const dropped = r.info.droppedRows ?? [];
  if (dropped.length === before) return mask(r.data, r.info);
  const marked = dropped.map((d, k) =>
    k === dropped.length - 1 ? { ...d, filter: true as const } : d,
  );
  return mask(r.data, { ...r.info, droppedRows: marked });
}

/**
 * Apply a change to the base dataset (every case, the filter's rows back in) and derive the
 * analysed dataset again, so that missing codes and the filter are applied to the changed data.
 * The change sees the codes as missing, unless `rows` (a change of the rows, which must keep the
 * original values). `recompute`: recompute the computed columns afterwards.
 */
export function transformData(
  data: Dataset,
  info: DataInfo,
  change: (data: Dataset, info: DataInfo) => Data,
  { recompute = false, rows = false }: { recompute?: boolean; rows?: boolean } = {},
): Data {
  const base = toBase(data, info);
  if (rows) {
    const changed = change(base.data, base.info);
    return fromBase(changed.data, changed.info, recompute);
  }
  // Masked for the change; its rows stay as they are, so the masked cells still line up.
  const masked = mask(base.data, base.info);
  const changed = change(masked.data, masked.info);
  const plain = unmask(changed.data, changed.info);
  return fromBase(plain.data, plain.info, recompute);
}

/** Set (expr) or remove (null) the dataset filter. Throws with a readable message. */
export function setFilter(data: Dataset, info: DataInfo, expr: string | null): Data {
  if (data.moments && data.cols.length === 0)
    throw new Error('A filter needs raw data; this dataset is a covariance matrix.');
  const base = toBase(data, info);
  const { filter: _f, ...rest } = base.info;
  if (expr === null) return fromBase(base.data, rest, true);
  const text = expr.trim();
  const bad = filterError(text, base.data);
  if (bad) throw new Error(bad);
  const out = fromBase(base.data, { ...rest, filter: { expr: text } });
  if (out.info.rows === 0) throw new Error(`No case has ${text}: the filter would leave none.`);
  return out;
}

/** The filter's condition and how many rows it keeps of how many, or null without a filter. */
export function filterSummary(
  info: DataInfo,
): { expr: string; kept: number; total: number } | null {
  if (!info.filter) return null;
  const left = filterLayer(info)?.at.length ?? 0;
  return { expr: info.filter.expr, kept: info.rows, total: info.rows + left };
}

/**
 * Exclude cases given as 1-based rows of the analysed (filtered) dataset, e.g. outliers found
 * by Data screening: they are excluded from the base, and the filter is applied again.
 */
export function excludeCases(data: Dataset, info: DataInfo, rows: number[], reason: string): Data {
  const layer = filterLayer(info);
  let baseRows = rows;
  if (layer) {
    // Row p of the filtered data is the p-th row of the base the filter keeps.
    const total = data.cols[0]?.length ?? 0;
    const left = new Set(layer.at);
    const kept: number[] = [];
    for (let i = 0; i < total + layer.at.length; i++) if (!left.has(i)) kept.push(i);
    baseRows = rows.map((r) => (kept[r - 1] ?? -1) + 1).filter((r) => r > 0);
  }
  return transformData(data, info, (d, i) => excludeRows(d, i, baseRows, reason), { rows: true });
}

/** Put back every excluded case (the filter stays and is applied again); computed columns are recomputed. */
export function restoreCases(data: Dataset, info: DataInfo): Data {
  return transformData(data, info, (d, i) => restoreRows(d, i), { recompute: true, rows: true });
}

/**
 * Bring a dataset read from a project file into a consistent state: missing codes masked and
 * the filter's rows derived again. A filter that cannot be evaluated is dropped (its rows come
 * back).
 */
export function normalizeData(data: Dataset, info: DataInfo): Data {
  const base = toBase(data, info);
  try {
    return fromBase(base.data, base.info);
  } catch {
    const { filter: _f, ...rest } = base.info;
    return fromBase(base.data, rest);
  }
}

/**
 * Set a column's missing-value codes (null removes them): the values come back or become
 * missing, and the filter and computed columns follow.
 */
export function setMissingCodes(
  data: Dataset,
  info: DataInfo,
  name: string,
  codes: Pick<MissingCodes, 'values' | 'ranges'> | null,
): Data {
  const bad = codesColumnError(data, info, name);
  if (bad) throw new Error(bad);
  const base = toBase(data, info);
  return fromBase(base.data, withCodes(base.info, name, codes), true);
}
