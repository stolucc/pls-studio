// The canvas's figure input, for exports outside the canvas (model snapshots,
// the report): the Canvas registers it while mounted.

import type { FigureInput } from './render';

let source: (() => FigureInput) | null = null;
export const setFigureSource = (f: (() => FigureInput) | null) => {
  source = f;
};
export const figureSource = () => source;
