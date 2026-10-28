export const fmt = (v: number | null | undefined, d = 3): string =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : !Number.isFinite(v) ? '∞' : v.toFixed(d);

export const fmtP = (p: number): string => (p < 0.001 ? '<0.001' : p.toFixed(3));

export const stars = (p: number): string => (p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : '');

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
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV cell escaping, also neutralising spreadsheet formula injection. */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const safeFileName = (s: string) => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'model';
