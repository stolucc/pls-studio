// Quadratic effects (X² → Y): ŷ(x) = β·x + β_q·x², so the slope of X at x is
// β + 2β_q·x and the curve turns at x* = −β / (2β_q).

export const quadraticValue = (b: number, bq: number, x: number) => b * x + bq * x * x;
export const quadraticSlope = (b: number, bq: number, x: number) => b + 2 * bq * x;
/** Where the slope is zero (the curve's extremum); null for a straight line. */
export const turningPoint = (b: number, bq: number): number | null => (Math.abs(bq) < 1e-12 ? null : -b / (2 * bq));
