// Excluding cases (rows) from the dataset, e.g. the outliers Data screening
// flags, and restoring them. The removed rows are kept in the dataset info
// (positions, values, reason), so they survive saving and can be put back;
// exclusions stack and are undone in reverse order.

import type { Dataset } from '../engine/types';
import type { DataInfo } from './project';

export interface RowExclusion {
  reason: string;
  /** 0-based positions in the dataset as it was when these rows were removed (ascending). */
  at: number[];
  /** The removed values by column name (null for missing). */
  values: Record<string, (number | null)[]>;
}

const missingCells = (cols: Float64Array[]) => cols.reduce((n, c) => n + c.filter(Number.isNaN).length, 0);

/** The dataset without the given rows (1-based), and its info recording them. */
export function excludeRows(data: Dataset, info: DataInfo, rows: number[], reason: string): { data: Dataset; info: DataInfo } {
  const n = data.cols[0]?.length ?? 0;
  const at = [...new Set(rows.map((r) => r - 1))].filter((i) => Number.isInteger(i) && i >= 0 && i < n).sort((a, b) => a - b);
  if (!at.length) return { data, info };
  const drop = new Set(at);
  const values = Object.fromEntries(data.names.map((name, k) => [name, at.map((i) => (Number.isNaN(data.cols[k][i]) ? null : data.cols[k][i]))]));
  const cols = data.cols.map((c) => Float64Array.from(Array.from(c).filter((_, i) => !drop.has(i))));
  return {
    data: { ...data, cols },
    info: { ...info, rows: n - at.length, missingCells: missingCells(cols), droppedRows: [...(info.droppedRows ?? []), { reason: reason.slice(0, 200), at, values }] },
  };
}

/** Put back every excluded row, last exclusion first; columns added since get missing values there. */
export function restoreRows(data: Dataset, info: DataInfo): { data: Dataset; info: DataInfo } {
  let cols = data.cols.map((c) => Array.from(c));
  for (const ex of [...(info.droppedRows ?? [])].reverse()) {
    cols = cols.map((c, k) => {
      const back = ex.values[data.names[k]];
      const out: number[] = [];
      let j = 0, d = 0;
      const total = c.length + ex.at.length;
      for (let i = 0; i < total; i++) {
        if (d < ex.at.length && ex.at[d] === i) { const v = back?.[d]; out.push(v === null || v === undefined ? NaN : v); d++; } else out.push(c[j++]);
      }
      return out;
    });
  }
  const f = cols.map((c) => Float64Array.from(c));
  const { droppedRows: _d, ...rest } = info;
  return { data: { ...data, cols: f }, info: { ...rest, rows: f[0]?.length ?? 0, missingCells: missingCells(f) } };
}

/** Validate excluded rows from an (untrusted) project file against the data's column names. */
export function parseDroppedRows(raw: unknown, names: string[]): RowExclusion[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RowExclusion[] = [];
  for (const e of raw.slice(0, 50)) {
    if (typeof e !== 'object' || e === null) continue;
    const r = e as Record<string, unknown>;
    const at = Array.isArray(r.at) ? r.at.filter((i): i is number => Number.isInteger(i) && (i as number) >= 0).slice(0, 100000) : [];
    if (!at.length || !r.values || typeof r.values !== 'object') continue;
    const values: Record<string, (number | null)[]> = {};
    for (const name of names) {
      const v = (r.values as Record<string, unknown>)[name];
      if (Array.isArray(v) && v.length === at.length) values[name] = v.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : null));
    }
    out.push({ reason: typeof r.reason === 'string' ? r.reason.slice(0, 200) : 'excluded', at, values });
  }
  return out.length ? out : undefined;
}
