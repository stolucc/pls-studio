// Guards for values read from untrusted files (projects, analysis options):
// each returns a safe value of the right type, or the fallback.

export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
/** A column name (or other short text) from an untrusted file. */
export const name = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
export const names = (v: unknown, max = 500) => [
  ...new Set(
    Array.isArray(v)
      ? v
          .slice(0, max)
          .map((x) => name(x))
          .filter(Boolean)
      : [],
  ),
];
export const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T =>
  all.includes(v as T) ? (v as T) : fallback;
/** A finite number (or a number typed into a field) clamped to [lo, hi]; anything else is the fallback. */
export const clampNum = (v: unknown, lo: number, hi: number, fallback: number, integer = false) => {
  let n = NaN;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && v.trim() !== '') n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const c = Math.max(lo, Math.min(hi, n));
  return integer ? Math.round(c) : c;
};
/** A finite number clamped to [lo, hi], numbers only: for values read from project files, where text is not a number. */
export const clampStrict = (
  v: unknown,
  lo: number,
  hi: number,
  fallback: number,
  integer = false,
) => (typeof v === 'number' ? clampNum(v, lo, hi, fallback, integer) : fallback);
export const flag = (v: unknown) => v === true;
