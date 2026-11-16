// Axis ticks at round values (1, 2, 2.5 or 5 times a power of ten) and their labels with the decimals the step needs.

/** About `count` round tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const first = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let t = first; t <= hi + step * 1e-9; t += step) {
    // (rounded to the step's precision: no 0.30000000000000004)
    ticks.push(Number(t.toFixed(10)));
  }
  return ticks;
}

/** The decimals a step needs to be written exactly (0.25 → 2, 0.5 → 1, 2 → 0), at most 6. */
function decimalsOf(step: number): number {
  for (let d = 0; d < 6; d++) {
    const scaled = step * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9 * Math.max(1, scaled)) return d;
  }
  return 6;
}

/** A tick label with the decimals its axis's step needs, a minus sign for negatives, −0 as 0. */
export function tickLabel(v: number, ticks: number[]): string {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 1;
  const value = Math.abs(v) < step * 1e-9 ? 0 : v;
  return value.toFixed(decimalsOf(step)).replace('-', '\u2212');
}
