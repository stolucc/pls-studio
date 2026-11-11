// What the diagram's geometry needs beyond a construct itself: whether constructs are circles (the figure style) and
// which indicator boxes each one shows (an indicator of several factors is drawn once). One pure function of the model
// and the settings, carried on each construct, so the canvas, the figure export and the method comparison lay a model
// out alike, and two layouts side by side never interfere.

import {
  indicatorsDrawnElsewhere,
  type Construct,
  type Method,
  type ModelState,
} from './model/project';
import type { FigureStyle } from './figure/style';

/** A construct with its layout: `circle`, drawn as a circle (composites as matching hexagons); `shown`, the indicator boxes drawn on it. */
export type PlacedConstruct = Construct & { circle: boolean; shown: string[] };
/** A model whose constructs are placed (placeModel). */
export type PlacedModel = Omit<ModelState, 'constructs'> & { constructs: PlacedConstruct[] };

/** Whether constructs are circles: the figure style's choice (conditional process analysis keeps its rectangles). */
export const circlesFor = (figure: Pick<FigureStyle, 'circleConstructs'>, method: Method) =>
  figure.circleConstructs && method !== 'process';

/**
 * The model with its constructs placed. `prev` (an earlier placement) lends its object to each construct whose placement
 * is unchanged, so arrows memoised on the construct object do not recompute.
 */
export function placeModel<M extends Pick<ModelState, 'constructs'>>(
  m: M,
  circle: boolean,
  prev?: Pick<PlacedModel, 'constructs'>,
): Omit<M, 'constructs'> & { constructs: PlacedConstruct[] } {
  const elsewhere = indicatorsDrawnElsewhere(m);
  const old = new Map(prev?.constructs.map((p) => [p.id, p]));
  return {
    ...m,
    constructs: m.constructs.map((c) => {
      const hidden = elsewhere.get(c.name);
      const shown = hidden ? c.indicators.filter((i) => !hidden.has(i)) : c.indicators;
      const p = old.get(c.id);
      return p && samePlacement(p, c, circle, shown) ? p : { ...c, circle, shown };
    }),
  };
}

// The placed construct p is { ...c, circle, shown }.
function samePlacement(
  p: PlacedConstruct,
  c: Construct,
  circle: boolean,
  shown: string[],
): boolean {
  if (
    p.circle !== circle ||
    p.shown.length !== shown.length ||
    shown.some((x, i) => p.shown[i] !== x)
  )
    return false;
  const keys = Object.keys(c) as (keyof Construct)[];
  return Object.keys(p).length === keys.length + 2 && keys.every((k) => p[k] === c[k]);
}
