// The composite model leaves the correlations among a composite's indicators free (Henseler, 2021): with
// "Implied" on, the diagram shows them as dashed arcs between the indicator boxes, without estimates.
import { describe, expect, it } from 'vitest';
import { covarianceLayout } from '../components/CovarianceLayer';
import { constructGeometry } from '../geometry';
import { impliedCompositeCorrelations, type Construct, type ModelState } from '../model/project';
import { placeModel } from '../placement';
import { buildFigureInput } from './build';
import { renderFigureSvg } from './render';
import { DEFAULT_FIGURE_STYLE } from './style';

const K = (
  id: string,
  type: 'factor' | 'composite',
  indicators: string[],
  x: number,
  extra: Partial<Construct> = {},
): Construct => ({
  id,
  name: id,
  type,
  mode: type === 'factor' ? 'A' : 'B',
  indicators,
  x,
  y: 0,
  side: 'left',
  ...extra,
});

const model: ModelState = {
  constructs: [
    K('C', 'composite', ['c1', 'c2', 'c3'], 0),
    K('F', 'factor', ['f1', 'f2', 'f3'], 500),
  ],
  paths: [{ id: 'p', from: 'C', to: 'F' }],
  moderations: [],
};

describe('the correlations a composite implies among its indicators', () => {
  it('are every pair of a composite’s indicators, and none of a factor’s', () => {
    const k = impliedCompositeCorrelations(model);
    expect(k.map((x) => [x.a, x.b])).toEqual([
      ['c1', 'c2'],
      ['c1', 'c3'],
      ['c2', 'c3'],
    ]);
    expect(k.every((x) => x.kind === 'indicator' && x.construct === 'C')).toBe(true);
  });

  it('leave out higher-order composites and covariates', () => {
    const m: ModelState = {
      ...model,
      constructs: [
        K('H', 'composite', [], 0, { components: ['C'] }),
        K('V', 'composite', ['v1', 'v2'], 0, { covariate: true }),
        K('S', 'composite', ['s1'], 0),
      ],
    };
    expect(impliedCompositeCorrelations(m)).toEqual([]);
  });

  it('are laid out only when shown, from the boxes’ outer sides', () => {
    expect(covarianceLayout(model, false, false).curves).toEqual([]);
    const curves = covarianceLayout(model, false, false, true).curves;
    expect(curves).toHaveLength(3);
    expect(curves.every((c) => c.composite && c.auto)).toBe(true);
    // (side 'left': each arc starts and ends on a box's left edge)
    const c = model.constructs[0];
    const left = c.x + constructGeometry(c).indicators[0].x;
    for (const { curve } of curves) {
      expect(curve.x1).toBeCloseTo(left, 6);
      expect(curve.x2).toBeCloseTo(left, 6);
    }
    // The wider pair bows further out, so neighbouring arcs nest rather than overlap.
    const reach = (a: string, b: string) =>
      curves.find((x) => x.k.a === a && x.k.b === b)!.curve.lx;
    expect(reach('c1', 'c3')).toBeLessThan(reach('c1', 'c2') - 5);
    expect(reach('c1', 'c2')).toBeCloseTo(reach('c2', 'c3'), 6);
  });

  it('are dashed in the exported figure, with no estimate, and absent in PROCESS', () => {
    const placed = placeModel(model, false);
    const values = { correlation: () => ({ value: 0.42, p: 0.01 }) };
    const f = buildFigureInput(placed, 'pls', values, {
      showErrors: false,
      showImpliedEffects: true,
    });
    expect(f.correlations).toHaveLength(3);
    expect(f.correlations.every((k) => k.implied && k.label === null)).toBe(true);
    expect(renderFigureSvg(f, DEFAULT_FIGURE_STYLE).svg).toContain('stroke-dasharray="5 4"');
    expect(
      buildFigureInput(placed, 'pls', values, { showErrors: false }).correlations,
    ).toHaveLength(0);
    expect(
      buildFigureInput(placed, 'process', values, { showErrors: false, showImpliedEffects: true })
        .correlations,
    ).toHaveLength(0);
  });
});
