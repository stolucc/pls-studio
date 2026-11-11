// User-defined missing values (SPSS's user-missing): per numeric column, codes
// such as -99 or 999 and ranges such as 990 to 999 that are treated as missing
// everywhere. The analysed dataset holds them as missing ("masked"); the
// original values of the masked cells are kept beside the codes, so codes can
// be changed or removed and the values come back. Masking is derived from the
// codes: data/pipeline.ts unmasks before changes to the rows and masks again.

import type { Dataset } from '../engine/types';
import type { DataInfo } from '../model/project';
import { isObj } from '../parse';

/** A column's missing-value codes and, derived, the cells they mask (positions in the current rows). */
export interface MissingCodes {
  name: string;
  values: number[];
  ranges: [number, number][];
  /** The masked cells: 0-based rows and their original values (derived; see mask). */
  cells?: { at: number[]; values: number[] };
}

export const MAX_CODES = 50;
export const MAX_RANGES = 10;

type Data = { data: Dataset; info: DataInfo };

/** Whether a value is one of the codes (or in one of the ranges). */
export function isCode(codes: Pick<MissingCodes, 'values' | 'ranges'>, v: number): boolean {
  if (Number.isNaN(v)) return false;
  if (codes.values.includes(v)) return true;
  return codes.ranges.some(([lo, hi]) => v >= lo && v <= hi);
}

const countMissing = (cols: Float64Array[]) =>
  cols.reduce((n, c) => n + c.filter(Number.isNaN).length, 0);

/** Put the original values of the masked cells back (the codes stay in the info, without cells). */
export function unmask(data: Dataset, info: DataInfo): Data {
  if (!info.missingCodes?.some((m) => m.cells)) return { data, info };
  const cols = [...data.cols];
  const missingCodes = info.missingCodes.map((m) => {
    const j = data.names.indexOf(m.name);
    if (j >= 0 && m.cells) {
      const col = Float64Array.from(cols[j]);
      m.cells.at.forEach((i, k) => {
        if (i < col.length && Number.isNaN(col[i])) col[i] = m.cells!.values[k];
      });
      cols[j] = col;
    }
    return { name: m.name, values: m.values, ranges: m.ranges };
  });
  return {
    data: { ...data, cols },
    info: { ...info, missingCodes, missingCells: countMissing(cols) },
  };
}

/** Mask the values that are codes (as missing), recording the cells and their values. */
export function mask(data: Dataset, info: DataInfo): Data {
  if (!info.missingCodes?.length) return { data, info };
  const plain = unmask(data, info);
  const cols = [...plain.data.cols];
  const missingCodes = plain.info.missingCodes!.map((m) => {
    const j = data.names.indexOf(m.name);
    if (j < 0) return m;
    const at: number[] = [];
    const values: number[] = [];
    const col = Float64Array.from(cols[j]);
    col.forEach((v, i) => {
      if (!isCode(m, v)) return;
      at.push(i);
      values.push(v);
      col[i] = NaN;
    });
    cols[j] = col;
    return at.length ? { ...m, cells: { at, values } } : m;
  });
  return {
    data: { ...plain.data, cols },
    info: { ...plain.info, missingCodes, missingCells: countMissing(cols) },
  };
}

/** Why a column cannot have missing-value codes, or null when it can. */
export function codesColumnError(data: Dataset, info: DataInfo, name: string): string | null {
  if (!data.names.includes(name)) return `“${name}” is not in the dataset.`;
  if (data.categories?.[name]) return `“${name}” is a text column; missing codes are for numbers.`;
  if ((info.computed ?? []).some((c) => c.name === name))
    return `“${name}” is a computed column; give its source columns missing codes instead.`;
  return null;
}

/** Codes as text: "-99, 999, 990 to 999". */
export function codesToText(codes: Pick<MissingCodes, 'values' | 'ranges'>): string {
  const parts = [...codes.values.map(String), ...codes.ranges.map(([lo, hi]) => `${lo} to ${hi}`)];
  return parts.join(', ');
}

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Parse codes typed as "-99, 999, 990 to 999"; throws with a readable message. */
export function parseCodesText(text: string): Pick<MissingCodes, 'values' | 'ranges'> {
  const values: number[] = [];
  const ranges: [number, number][] = [];
  for (const part of text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const range = /^(\S+)\s+(?:to|thru)\s+(\S+)$/i.exec(part);
    if (range) {
      if (!NUMBER.test(range[1]) || !NUMBER.test(range[2]))
        throw new Error(`“${part}”: a range is two numbers, e.g. 990 to 999.`);
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (lo > hi) throw new Error(`“${part}”: a range goes from a lower to a higher value.`);
      ranges.push([lo, hi]);
    } else if (NUMBER.test(part)) {
      const v = Number(part);
      if (!values.includes(v)) values.push(v);
    } else throw new Error(`“${part}” is not a number or a range (e.g. -99 or 990 to 999).`);
  }
  if (values.length > MAX_CODES) throw new Error(`At most ${MAX_CODES} codes per column.`);
  if (ranges.length > MAX_RANGES) throw new Error(`At most ${MAX_RANGES} ranges per column.`);
  return { values: values.sort((a, b) => a - b), ranges };
}

/** The codes of a column (null when it has none). */
export function codesOf(info: DataInfo | null | undefined, name: string): MissingCodes | null {
  return info?.missingCodes?.find((m) => m.name === name) ?? null;
}

/** The info with a column's codes set (without cells; mask derives them) or removed (null). */
export function withCodes(
  info: DataInfo,
  name: string,
  codes: Pick<MissingCodes, 'values' | 'ranges'> | null,
): DataInfo {
  const others = (info.missingCodes ?? []).filter((m) => m.name !== name);
  const empty = !codes || (!codes.values.length && !codes.ranges.length);
  const list = empty ? others : [...others, { name, values: codes.values, ranges: codes.ranges }];
  const { missingCodes: _m, ...rest } = info;
  return list.length ? { ...rest, missingCodes: list } : rest;
}

/**
 * Missing codes from a project file (or a data file read by R): numeric columns that exist,
 * once each, finite codes and ranges (bounded counts). Cells are kept only where they are
 * consistent: strictly ascending rows inside the data, values that are codes, cells that are
 * missing in the column; anything else is dropped (the codes still mask the values present).
 */
export function parseMissingCodes(
  raw: unknown,
  data: Dataset,
  computed: string[] = [],
): MissingCodes[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: MissingCodes[] = [];
  const n = data.cols[0]?.length ?? 0;
  for (const m of raw.slice(0, 2 * data.names.length + 10)) {
    if (!isObj(m) || typeof m.name !== 'string') continue;
    const j = data.names.indexOf(m.name);
    if (j < 0 || data.categories?.[m.name] || computed.includes(m.name)) continue;
    if (out.some((x) => x.name === m.name)) continue;
    const values = Array.isArray(m.values)
      ? [
          ...new Set(
            m.values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)),
          ),
        ]
          .slice(0, MAX_CODES)
          .sort((a, b) => a - b)
      : [];
    const ranges = Array.isArray(m.ranges)
      ? m.ranges
          .filter(
            (r): r is [number, number] =>
              Array.isArray(r) &&
              r.length === 2 &&
              r.every((x) => typeof x === 'number' && Number.isFinite(x)) &&
              r[0] <= r[1],
          )
          .slice(0, MAX_RANGES)
          .map(([lo, hi]): [number, number] => [lo, hi])
      : [];
    if (!values.length && !ranges.length) continue;
    const item: MissingCodes = { name: m.name, values, ranges };
    const cells = parseCells(m.cells, item, data.cols[j], n);
    if (cells) item.cells = cells;
    out.push(item);
  }
  return out.length ? out : undefined;
}

function parseCells(
  raw: unknown,
  codes: MissingCodes,
  col: Float64Array,
  n: number,
): MissingCodes['cells'] | undefined {
  if (!isObj(raw) || !Array.isArray(raw.at) || !Array.isArray(raw.values)) return undefined;
  if (raw.at.length !== raw.values.length || raw.at.length > n) return undefined;
  const at: number[] = [];
  const values: number[] = [];
  for (let k = 0; k < raw.at.length; k++) {
    const i = raw.at[k];
    const v = raw.values[k];
    if (!Number.isInteger(i) || i < 0 || i >= n) return undefined;
    if (at.length && i <= at[at.length - 1]) return undefined;
    if (typeof v !== 'number' || !isCode(codes, v) || !Number.isNaN(col[i])) return undefined;
    at.push(i);
    values.push(v);
  }
  return at.length ? { at, values } : undefined;
}
