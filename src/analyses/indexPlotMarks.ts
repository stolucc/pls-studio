// Which cases an index plot draws, and how large. An index plot has one stem
// and dot per case; with more cases than the plot is pixels wide they pile on
// top of each other, and hundreds of thousands of SVG elements stall the page.
// So above that the plot keeps, per pixel column, the case with the largest
// and the one with the smallest value (the column then looks exactly as with
// every case drawn: the stems in between are covered), plus every case above
// the far-out fence, and draws the far-out ones last so none is hidden.

/** The cases to draw (indices into the series) and the dot radius. */
export interface IndexMarks {
  /** Indices of the cases to draw, the far-out ones last. */
  order: number[];
  /** Dot radius in pixels: smaller as the cases get denser. */
  radius: number;
  /** Whether some cases are not drawn (they are covered by the ones drawn). */
  thinned: boolean;
}

/** At most this many far-out cases are drawn beyond the column extremes. */
export const MAX_FAR_DRAWN = 1000;

/**
 * The marks of an index plot of `values` (one per case, in row order) whose
 * x positions are `xs` (pixels), `width` pixels wide. `isFar` tells which
 * values lie above the far-out fence.
 */
export function indexPlotMarks(
  xs: number[],
  values: number[],
  width: number,
  isFar: (v: number) => boolean,
): IndexMarks {
  const n = values.length;
  const radius = dotRadius(n, width);
  const all = values.map((_, i) => i);
  if (n <= width) {
    return { order: farLast(all, values, isFar), radius, thinned: false };
  }

  // The largest and the smallest value in each pixel column.
  const high = new Map<number, number>();
  const low = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const column = Math.floor(xs[i]);
    const hi = high.get(column);
    if (hi === undefined || values[i] > values[hi]) high.set(column, i);
    const lo = low.get(column);
    if (lo === undefined || values[i] < values[lo]) low.set(column, i);
  }
  const keep = new Set<number>([...high.values(), ...low.values()]);

  // Every far-out case, the largest first if there are very many.
  const far = all.filter((i) => isFar(values[i]));
  far.sort((a, b) => values[b] - values[a]);
  for (const i of far.slice(0, MAX_FAR_DRAWN)) keep.add(i);

  const order = [...keep].sort((a, b) => a - b);
  return { order: farLast(order, values, isFar), radius, thinned: true };
}

/** 3 px for a few cases, down to 1.5 px when they are denser than one per 2 px. */
function dotRadius(n: number, width: number): number {
  if (n <= 100) return 3;
  if (n <= width / 2) return 2;
  return 1.5;
}

/** The indices with the far-out cases moved to the end (drawn on top). */
function farLast(order: number[], values: number[], isFar: (v: number) => boolean): number[] {
  const near = order.filter((i) => !isFar(values[i]));
  const far = order.filter((i) => isFar(values[i]));
  return [...near, ...far];
}
