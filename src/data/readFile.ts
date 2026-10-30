// SPSS, Stata and Excel files, read by R (haven, readxl) in the browser's R or
// the desktop helper (R/common.R ps_read_data), into the app's dataset: numbers
// as they are, factors as categories in their level order, text columns coded
// as categories like CSV text (free text left out).

import { codeText } from '../engine/dataset';
import type { Dataset } from '../engine/types';
import type { DataInfo } from '../model/project';

export type DataFileFormat = 'sav' | 'zsav' | 'dta' | 'xlsx' | 'xls';

/** The format of a file by its name, or null when it is not one R reads here. */
export function dataFileFormat(name: string): DataFileFormat | null {
  const ext = /\.([A-Za-z]+)$/.exec(name)?.[1]?.toLowerCase();
  return ext === 'sav' || ext === 'zsav' || ext === 'dta' || ext === 'xlsx' || ext === 'xls' ? ext : null;
}

type RawColumn =
  | { kind: 'number'; values: (number | null)[] | number | null }
  | { kind: 'factor'; codes: (number | null)[] | number | null; levels: string[] | string }
  | { kind: 'text'; values: (string | null)[] | string | null };
export interface RawDataFile {
  names: string[] | string; cols: RawColumn[]; n: number;
  sheets?: string[] | string; excluded?: { name: string; reason: string }[];
}

const arr = <T,>(v: T[] | T | null | undefined): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const MISSING_TEXT = new Set(['', 'NA', 'N/A', 'NAN', '.']);

/** Convert R's columns to the app's dataset (pure; exported for tests). */
export function toDataset(raw: RawDataFile, fileName: string): { data: Dataset; info: DataInfo; sheets: string[] } {
  const names: string[] = [], cols: Float64Array[] = [], categories: Record<string, string[]> = {};
  const excluded = [...(raw.excluded ?? [])];
  let missingCells = 0;
  arr(raw.names).forEach((name, i) => {
    const c = raw.cols[i];
    let col: Float64Array;
    if (c.kind === 'number') col = Float64Array.from(arr(c.values), (v) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN));
    else if (c.kind === 'factor') { col = Float64Array.from(arr(c.codes), (v) => (typeof v === 'number' ? v : NaN)); categories[name] = arr(c.levels).map(String); }
    else {
      const coded = codeText(arr(c.values).map((v) => (v == null ? '' : String(v))), MISSING_TEXT);
      if (!coded) { excluded.push({ name, reason: 'free text (too many different values)' }); return; }
      col = coded.col; categories[name] = coded.labels;
    }
    missingCells += col.filter(Number.isNaN).length;
    names.push(name); cols.push(col);
  });
  if (!names.length) throw new Error('No usable columns were found.');
  return {
    data: { names, cols, ...(Object.keys(categories).length ? { categories } : {}) },
    info: { fileName: fileName.slice(0, 200), rows: raw.n, missingCells, excluded },
    sheets: arr(raw.sheets),
  };
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Read a file the user chose (sheet: an Excel sheet by name; default the first). */
export async function readDataFile(file: File, sheet?: string) {
  const format = dataFileFormat(file.name);
  if (!format) throw new Error('Not an SPSS, Stata or Excel file.');
  const { rCall } = await import('../rengine/bridge');
  const raw = await rCall<RawDataFile>('ps_read_data', { format, data: base64(new Uint8Array(await file.arrayBuffer())), ...(sheet ? { sheet } : {}) }, 'readData');
  return toDataset(raw, sheet ? `${file.name} (${sheet})` : file.name);
}

/** Read an example file shipped in an R package (e.g. haven's iris.sav). */
export async function readPackageFile(pkg: string, path: string, format: DataFileFormat, sheet?: string) {
  const { rCall } = await import('../rengine/bridge');
  const raw = await rCall<RawDataFile>('ps_read_data', { format, package_file: { package: pkg, path }, ...(sheet ? { sheet } : {}) }, 'readData');
  return toDataset(raw, `${pkg}: ${path.split('/').pop()}${sheet ? ` (${sheet})` : ''}`);
}
