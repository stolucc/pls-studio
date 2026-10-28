// Labels on indicator arrows. CB-SEM identifies each factor by fixing its first
// loading to 1 (marker indicator); that constraint is always shown, with or
// without results, so the diagram states the model completely.

import type { IndicatorLabel } from './components/ConstructNode';
import type { Construct, Method } from './model/project';

export interface LabelSource {
  indicator: (name: string) => number | null;
  /** True for loadings fixed to 1 (CB-SEM markers). */
  fixed?: (name: string) => boolean;
  /** Colour weak loadings (standardised reflective loadings only). */
  reflectiveThresholds: (type: string) => boolean;
}

export function indicatorLabels(c: Pick<Construct, 'indicators' | 'type' | 'covariate'>, method: Method, src: LabelSource | null): (IndicatorLabel | null)[] | null {
  const marker = method === 'cbsem' && !c.covariate && c.indicators.length > 0 ? c.indicators[0] : null;
  const markerLabel: IndicatorLabel = { text: '1', level: 'ok', fixed: true };
  if (!src) return marker ? c.indicators.map((name) => (name === marker ? markerLabel : null)) : null;
  return c.indicators.map((name): IndicatorLabel | null => {
    const v = src.indicator(name);
    const fixed = !!src.fixed?.(name);
    if (v === null) return fixed || name === marker ? markerLabel : null;
    const level = fixed || !src.reflectiveThresholds(c.type) ? 'ok' : Math.abs(v) < 0.4 ? 'low' : Math.abs(v) < 0.708 ? 'mid' : 'ok';
    return { text: fixed && Math.abs(v - 1) < 1e-12 ? '1' : v.toFixed(3), level, fixed };
  });
}
