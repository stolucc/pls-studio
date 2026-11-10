// Reading R's JSON replies (auto_unbox): a one-element vector arrives as a scalar, NULL as null, NA/Inf as non-numbers.

/** Any R value as an array. */
export const rList = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
/** A finite number, or null (NA, NaN, Inf, absent). */
export const rNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
