// Guards for values read from untrusted files (projects, analysis options):
// each returns a safe value of the right type, or the fallback.

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A column name (or other short text) from an untrusted file. */
export const name = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
export const names = (v: unknown, max = 500) => [...new Set(Array.isArray(v) ? v.slice(0, max).map((x) => name(x)).filter(Boolean) : [])];
export const oneOf = <T extends string>(v: unknown, all: readonly T[], fallback: T): T => (all.includes(v as T) ? (v as T) : fallback);
/** A finite number clamped to [lo, hi]; anything else (strings included) is the fallback. */
export const clampNum = (v: unknown, lo: number, hi: number, fallback: number, integer = false) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const c = Math.max(lo, Math.min(hi, v));
  return integer ? Math.round(c) : c;
};
export const flag = (v: unknown) => v === true;
