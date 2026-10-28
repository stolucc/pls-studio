// CSV import. Handles quoted fields, embedded delimiters/newlines, a BOM,
// and auto-detects comma / semicolon / tab delimiters. Non-numeric columns
// are reported and excluded; missing tokens become NaN.

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
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]) as ',' | ';' | '\t';
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
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export function parseCsv(text: string, opts: ParseOptions = {}): ParsedData {
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  const decimalComma = opts.decimalComma ?? delimiter === ';';
  const missing = new Set(['', ...(opts.missingTokens ?? ['NA', 'N/A', 'NaN', '.'])].map((s) => s.toUpperCase()));
  const rows = parseCsvRows(text, delimiter);
  if (rows.length < 2) throw new Error('The file needs a header row and at least one data row.');

  const header = rows[0].map((h, i) => h.trim() || `V${i + 1}`);
  const seen = new Set<string>();
  const names = header.map((h) => {
    let name = h, k = 2;
    while (seen.has(name)) name = `${h}_${k++}`;
    seen.add(name);
    return name;
  });

  const body = rows.slice(1);
  const excludedColumns: ParsedData['excludedColumns'] = [];
  const keptNames: string[] = [];
  const cols: Float64Array[] = [];
  let missingCells = 0;

  names.forEach((name, c) => {
    const col = new Float64Array(body.length);
    let bad: string | null = null;
    let colMissing = 0;
    for (let r = 0; r < body.length; r++) {
      const rawCell = (body[r][c] ?? '').trim();
      if (missing.has(rawCell.toUpperCase())) { col[r] = NaN; colMissing++; continue; }
      const v = Number(decimalComma ? rawCell.replace(',', '.') : rawCell);
      if (!Number.isFinite(v)) { bad = rawCell; break; }
      col[r] = v;
    }
    if (bad !== null) excludedColumns.push({ name, reason: `non-numeric value "${bad.slice(0, 20)}"` });
    else if (colMissing === body.length) excludedColumns.push({ name, reason: 'all values missing' });
    else { keptNames.push(name); cols.push(col); missingCells += colMissing; }
  });

  return { dataset: { names: keptNames, cols }, rows: body.length, missingCells, excludedColumns };
}
