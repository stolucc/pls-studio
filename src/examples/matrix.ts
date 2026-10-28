import { parseCsvRows } from '../engine/dataset';

/**
 * Parse a covariance matrix CSV with a header row and row names (as written by
 * R's write.csv). Returns null when the file is not a square, symmetric,
 * labelled matrix.
 */
export function parseCovMatrixCsv(text: string): { names: string[]; S: number[][] } | null {
  const rows = parseCsvRows(text, text.includes(';') && !text.includes(',') ? ';' : ',');
  if (rows.length < 3) return null;
  const header = rows[0].map((h) => h.trim());
  const names = header.slice(1);
  if (header[0] !== '' && header.length !== rows.length) return null;
  const body = rows.slice(1);
  if (body.length !== names.length) return null;
  if (!body.every((r, i) => r[0]?.trim() === names[i] && r.length === names.length + 1)) return null;
  const S = body.map((r) => r.slice(1).map(Number));
  if (S.some((r) => r.some((v) => !Number.isFinite(v)))) return null;
  for (let i = 0; i < S.length; i++) for (let j = 0; j < i; j++) if (Math.abs(S[i][j] - S[j][i]) > 1e-8 * Math.max(1, Math.abs(S[i][j]))) return null;
  return { names, S };
}

/** NACOV CSV: a headerless numeric square matrix. */
export function parseNacovCsv(text: string, p: number): number[][] {
  const rows = parseCsvRows(text, ',').map((r) => r.map(Number));
  const k = (p * (p + 1)) / 2;
  if (rows.length !== k || rows.some((r) => r.length !== k || r.some((v) => !Number.isFinite(v)))) {
    throw new Error(`The NACOV file must be a ${k} × ${k} numeric matrix for ${p} variables.`);
  }
  return rows;
}
