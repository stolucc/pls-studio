// CSV import. Handles quoted fields, embedded delimiters/newlines, a BOM,
// and auto-detects comma / semicolon / tab delimiters. Text columns with few
// different values become categories coded 1, 2, ...; free-text columns are
// reported and excluded; missing tokens become NaN.

import type { Dataset } from './types';

export interface ParseOptions {
  delimiter?: ',' | ';' | '\t';
  /** Cell values (after trimming) treated as missing, in addition to the empty string. */
  missingTokens?: string[];
  /** Interpret "," as the decimal separator (common with ";" delimited files). */
  decimalComma?: boolean;
}

export interface ParsedData {
  dataset: Dataset;
  rows: number;
  missingCells: number;
  excludedColumns: { name: string; reason: string }[];
}

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const counts = { ',': 0, ';': 0, '\t': 0 } as Record<',' | ';' | '\t', number>;
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch as ',' | ';' | '\t']++;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as ',' | ';' | '\t';
}

export function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export function parseCsv(text: string, opts: ParseOptions = {}): ParsedData {
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const decimalComma = opts.decimalComma ?? delimiter === ';';
  const missing = new Set(
    ['', ...(opts.missingTokens ?? ['NA', 'N/A', 'NaN', '.'])].map((s) => s.toUpperCase()),
  );
  const rows = parseCsvRows(text, delimiter);
  if (rows.length < 2) throw new Error('The file needs a header row and at least one data row.');

  const header = rows[0].map((h, i) => h.trim() || `V${i + 1}`);
  const seen = new Set<string>();
  const names = header.map((h) => {
    let name = h,
      k = 2;
    while (seen.has(name)) name = `${h}_${k++}`;
    seen.add(name);
    return name;
  });

  const body = rows.slice(1);
  const excludedColumns: ParsedData['excludedColumns'] = [];
  const keptNames: string[] = [];
  const cols: Float64Array[] = [];
  let missingCells = 0;

  const categories: Record<string, string[]> = {};
  names.forEach((name, c) => {
    const col = new Float64Array(body.length);
    let bad: string | null = null;
    let colMissing = 0;
    for (let r = 0; r < body.length; r++) {
      const rawCell = (body[r][c] ?? '').trim();
      if (missing.has(rawCell.toUpperCase())) {
        col[r] = NaN;
        colMissing++;
        continue;
      }
      const v = Number(decimalComma ? rawCell.replace(',', '.') : rawCell);
      if (!Number.isFinite(v)) {
        bad = rawCell;
        break;
      }
      col[r] = v;
    }
    if (bad !== null) {
      // A text column with few different values (groups, cluster ids, labels) is kept as
      // categories coded 1, 2, ... in natural sort order; free text is left out.
      const coded = codeText(
        body.map((row) => (row[c] ?? '').trim()),
        missing,
      );
      if (!coded)
        excludedColumns.push({
          name,
          reason: `text with many different values ("${bad.slice(0, 20)}")`,
        });
      else {
        keptNames.push(name);
        cols.push(coded.col);
        missingCells += coded.missing;
        categories[name] = coded.labels;
      }
    } else if (colMissing === body.length)
      excludedColumns.push({ name, reason: 'all values missing' });
    else {
      keptNames.push(name);
      cols.push(col);
      missingCells += colMissing;
    }
  });

  const dataset: Dataset = {
    names: keptNames,
    cols,
    ...(Object.keys(categories).length ? { categories } : {}),
  };
  return { dataset, rows: body.length, missingCells, excludedColumns };
}

/** Most categories a text column may have (beyond that it is treated as free text). */
export const MAX_CATEGORIES = 1000;

/**
 * Code a text column as categories 1, 2, ... (natural order: "2" before "10",
 * case-insensitive). Null when it looks like free text: more than
 * MAX_CATEGORIES values, or more than half the rows distinct (when over 50).
 */
export function codeText(
  cells: string[],
  missing: Set<string>,
): { col: Float64Array; labels: string[]; missing: number } | null {
  const present = cells.filter((x) => !missing.has(x.toUpperCase()));
  const labels = [...new Set(present)].sort(
    (a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) ||
      (a < b ? -1 : a > b ? 1 : 0),
  );
  if (labels.length > MAX_CATEGORIES || (labels.length > 50 && labels.length > present.length / 2))
    return null;
  const code = new Map(labels.map((l, i) => [l, i + 1]));
  const col = Float64Array.from(cells, (x) => code.get(x) ?? NaN);
  return { col, labels, missing: cells.length - present.length };
}
