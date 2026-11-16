// Colours of chart series: one categorical palette for every chart, in a fixed
// order (series k always gets slot k), checked for colour-vision-deficiency
// separation on the white chart surface. Charts label their series (legend or
// direct labels), since slots 3–5 are below 3:1 contrast with white.

export const SERIES_COLORS = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
] as const;

/** Series beyond the eighth are not given new hues: they are grey ("other"). */
export const OTHER_COLOR = '#8a8f98';

export const seriesColor = (k: number): string => SERIES_COLORS[k] ?? OTHER_COLOR;

/** Signed values (network edges): positive blue, negative red. */
export const POSITIVE_COLOR = SERIES_COLORS[0];
export const NEGATIVE_COLOR = SERIES_COLORS[7];

/**
 * Line types of series k, in the same fixed order as the colours, so lines stay apart in print, in greyscale
 * and for colour-vision deficiency (as published simulation figures tell estimators apart): the SVG dash
 * pattern and ggplot2's name for it.
 */
export const SERIES_DASHES = [
  { svg: '', ggplot: 'solid' },
  { svg: '7 4', ggplot: 'dashed' },
  { svg: '1.5 3', ggplot: 'dotted' },
  { svg: '7 3 1.5 3', ggplot: 'dotdash' },
  { svg: '12 4', ggplot: 'longdash' },
  { svg: '4 2 10 2', ggplot: 'twodash' },
] as const;

export const seriesDash = (k: number) => SERIES_DASHES[k % SERIES_DASHES.length];
