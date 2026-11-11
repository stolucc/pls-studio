// A result's fingerprint for the browser self-check: its numbers, by path, in a fixed order. Recorded by the
// webR tests with the validation evidence and recomputed in the user's browser (selfCheck.ts), so that
// "this browser computes what the tests computed" can be shown, not asserted.

/** Fields that describe the run, not the result. */
const SKIP = new Set([
  'warnings',
  'notes',
  'engine',
  'droppedRows',
  'iterations',
  'vcov',
  'scores',
  'caseWeights',
  'modindices',
  'elapsed',
]);
/** Arrays longer than this are per-case values (scores, weights): left out. */
const MAX_ARRAY = 60;
/** At most this many numbers. */
const MAX_NUMBERS = 400;

export function digest(result: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  let n = 0;
  const walk = (v: unknown, path: string) => {
    if (n >= MAX_NUMBERS) return;
    if (typeof v === 'number') {
      if (Number.isFinite(v)) {
        out[path] = v;
        n++;
      }
      return;
    }
    if (ArrayBuffer.isView(v)) return;
    if (Array.isArray(v)) {
      if (v.length <= MAX_ARRAY) v.forEach((x, i) => walk(x, `${path}[${i}]`));
      return;
    }
    if (v && typeof v === 'object')
      for (const k of Object.keys(v).sort())
        if (!SKIP.has(k)) walk((v as Record<string, unknown>)[k], path ? `${path}.${k}` : k);
  };
  walk(result, '');
  return out;
}

/** The numbers that differ by more than the tolerance (relative to their size, at least `tol` absolute). */
export function digestDifferences(
  got: Record<string, number>,
  want: Record<string, number>,
  tol = 1e-6,
): { path: string; got: number | undefined; want: number }[] {
  return Object.entries(want)
    .filter(([k, w]) => {
      const g = got[k];
      return g === undefined || Math.abs(g - w) > tol * Math.max(1, Math.abs(w));
    })
    .map(([path, w]) => ({ path, got: got[path], want: w }));
}
