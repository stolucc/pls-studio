export function fmt(v: number | null | undefined, d = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return '∞';
  return v.toFixed(d);
}

/**
 * The smallest and largest of the values ([Infinity, -Infinity] when there
 * are none, as Math.min() and Math.max()). A loop: spreading a long array into
 * Math.min(...values) overflows the stack (above roughly 125,000 values).
 */
export function extent(values: ArrayLike<number>): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

/** A p-value for a table cell: <0.001 or three decimals. */
export function fmtP(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return '—';
  if (p < 0.001) return '<0.001';
  return p.toFixed(3);
}

/** A p-value in a sentence, after "p ": "< 0.001" or "= 0.037". */
export const pIs = (p: number): string => (p < 0.001 ? '< 0.001' : `= ${fmt(p, 3)}`);

export function stars(p: number): string {
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return '';
}

/** A formatted number without its leading zero (APA and Amos style: .45, -.12). */
export const noLeadingZero = (s: string): string => s.replace(/^(-?)0\./, '$1.');

/** Write a string to the clipboard; resolves false if the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadText(filename: string, text: string, type = 'text/plain') {
  downloadBlob(filename, new Blob([text], { type }));
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A plain number as text (a sign, digits, a decimal point, an exponent): nothing a spreadsheet would run. */
const NUMERIC = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/**
 * Text for a spreadsheet cell, with formula injection neutralised: text that
 * starts with =, +, -, @, a tab or a carriage return gets a leading
 * apostrophe, unless it is a plain number (-1.5 stays a number; -1+cmd does not).
 */
export function formulaSafe(v: string | number): string {
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) && !NUMERIC.test(s) ? `'${s}` : s;
}

/** CSV cell escaping, also neutralising spreadsheet formula injection. */
export function csvCell(v: string | number): string {
  const s = formulaSafe(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const safeFileName = (s: string) =>
  s
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-') || 'model';

/** Only web links from metadata become clickable (never javascript: or data: URLs). */
export const safeUrl = (url: string | null | undefined): boolean =>
  typeof url === 'string' && /^https?:\/\//i.test(url);
