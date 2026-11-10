// Labels on indicator arrows. CB-SEM identifies each factor by fixing its first
// loading to 1 (marker indicator); that constraint, and any loading the user
// fixed at a value, is always shown, with or without results, so the diagram
// states the model completely.

import type { IndicatorLabel } from './components/ConstructNode';
import type { Construct, Method } from './model/project';

export interface LabelSource {
  /** (by construct too: an indicator of several factors has a loading on each) */
  indicator: (name: string, construct?: string) => number | null;
  /** True for loadings fixed to 1 (CB-SEM markers). */
  fixed?: (name: string) => boolean;
  /** Colour weak loadings (standardised reflective loadings only). */
  reflectiveThresholds: (type: string) => boolean;
}

/** A fixed value as written by the user (no trailing zeros). */
export const fixedText = (v: number) => String(Number(v.toPrecision(6)));

/**
 * The value an indicator's loading is held at (CB-SEM): the user's fixed value, or 1 for the marker (the first indicator,
 * unless the factor is scaled by its variance or rotated in an ESEM block). Undefined: estimated. Shared by the canvas and
 * the figure export.
 */
export function heldLoading(c: Pick<Construct, 'indicators' | 'covariate' | 'fixedLoadings' | 'scaling'>, method: Method, name: string, esem = false): number | undefined {
  if (method !== 'cbsem' || c.covariate || c.indicators.length === 0) return undefined;
  const marker = !esem && c.scaling !== 'variance' ? c.indicators[0] : null;
  return c.fixedLoadings?.[name] ?? (name === marker ? 1 : undefined);
}

export function indicatorLabels(c: Pick<Construct, 'indicators' | 'type' | 'covariate' | 'fixedLoadings' | 'scaling'> & { name?: string }, method: Method, src: LabelSource | null, esem = false, format: (v: number) => string = (v) => v.toFixed(3)): (IndicatorLabel | null)[] | null {
  const cb = method === 'cbsem' && !c.covariate && c.indicators.length > 0;
  const held = (name: string) => heldLoading(c, method, name, esem);
  const heldLabel = (name: string): IndicatorLabel | null => { const h = held(name); return h === undefined ? null : { text: fixedText(h), level: 'ok', fixed: true }; };
  if (!src) return cb ? c.indicators.map(heldLabel) : null;
  return c.indicators.map((name): IndicatorLabel | null => {
    const v = src.indicator(name, c.name);
    const h = held(name);
    const fixed = h !== undefined || !!src.fixed?.(name);
    if (v === null) return heldLabel(name);
    const level = fixed || !src.reflectiveThresholds(c.type) ? 'ok' : Math.abs(v) < 0.4 ? 'low' : Math.abs(v) < 0.708 ? 'mid' : 'ok';
    return { text: h !== undefined && Math.abs(v - h) < 1e-9 ? fixedText(h) : format(v), level, fixed };
  });
}
