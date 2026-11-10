import { describe, expect, it } from 'vitest';
import { buildFigureInput } from './figure/build';
import { renderFigureSvg } from './figure/render';
import { DEFAULT_FIGURE_STYLE } from './figure/style';
import { constructGeometry, pathSegment } from './geometry';
import type { Construct, ModelState } from './model/project';
import { circlesFor, placeModel } from './placement';
import { emptyModel, selectPlacedModel, useStore } from './store';

const K = (id: string, indicators: string[], x: number, y = 0): Construct => ({ id, name: id, type: 'factor', mode: 'A', indicators, x, y, side: 'left' });
// A bifactor model: G's boxes a1..b2 are drawn with A and B.
const bif = (): ModelState => ({ constructs: [K('G', ['a1', 'a2', 'b1', 'b2', 'c'], 0), K('A', ['a1', 'a2'], 400, -100), K('B', ['b1', 'b2'], 400, 200)], paths: [{ id: 'p', from: 'A', to: 'B' }], moderations: [] });

describe('placing a model', () => {
  it('circles constructs by the figure style, except in conditional process analysis', () => {
    expect(circlesFor({ circleConstructs: true }, 'pls')).toBe(true);
    expect(circlesFor({ circleConstructs: true }, 'cbsem')).toBe(true);
    expect(circlesFor({ circleConstructs: true }, 'process')).toBe(false);
    expect(circlesFor({ circleConstructs: false }, 'pls')).toBe(false);
  });

  it('carries the circle style and the boxes each construct shows, leaving the model alone', () => {
    const m = bif();
    const p = placeModel(m, true);
    expect(p.constructs.map((c) => [c.circle, c.shown])).toEqual([[true, ['c']], [true, ['a1', 'a2']], [true, ['b1', 'b2']]]);
    expect(p.paths).toBe(m.paths);
    expect(m.constructs[0]).not.toHaveProperty('circle');
    expect(constructGeometry(p.constructs[0]).indicators.map((b) => b.name)).toEqual(['c']);
    expect(constructGeometry(p.constructs[0]).rx).toBe(36);
    expect(constructGeometry(placeModel(m, false).constructs[0]).rx).toBeGreaterThan(36);
  });

  it('keeps the placed object of a construct whose placement is unchanged', () => {
    const m = bif();
    const first = placeModel(m, false);
    const moved = { ...m, constructs: m.constructs.map((c) => (c.id === 'A' ? { ...c, x: 500 } : c)) };
    const second = placeModel(moved, false, first);
    expect(second.constructs[0]).toBe(first.constructs[0]);
    expect(second.constructs[1]).not.toBe(first.constructs[1]);
    expect(second.constructs[1].x).toBe(500);
    // Another circle style, or other boxes shown (A no longer shares a1): new objects.
    expect(placeModel(m, true, first).constructs[0]).not.toBe(first.constructs[0]);
    const unshared = { ...m, constructs: m.constructs.map((c) => (c.id === 'A' ? { ...c, indicators: ['x1'] } : c)) };
    const third = placeModel(unshared, false, first);
    expect(third.constructs[0]).not.toBe(first.constructs[0]);
    expect(third.constructs[0].shown).toEqual(['a1', 'a2', 'c']);
  });

  it('lays out the same model under two styles side by side without one affecting the other', () => {
    const m = bif();
    const circles = placeModel(m, true), ellipses = placeModel(m, false);
    const alone = (p: typeof circles) => renderFigureSvg(buildFigureInput(p, 'cbsem', {}, { showErrors: true }), DEFAULT_FIGURE_STYLE).svg;
    const a = alone(circles), b = alone(ellipses);
    expect(a).not.toBe(b);
    // Interleaved, each still gives what it gave alone.
    expect(pathSegment(circles.constructs[0], circles.constructs[1])).not.toEqual(pathSegment(ellipses.constructs[0], ellipses.constructs[1]));
    expect(alone(circles)).toBe(a);
    expect(alone(ellipses)).toBe(b);
    expect(alone(circles)).toBe(a);
  });
});

describe('the placed model of the store', () => {
  it('is the same object until the model or the circle style changes', () => {
    useStore.setState({ model: emptyModel() });
    useStore.getState().addConstruct(0, 0, ['x1', 'x2']);
    const s = () => useStore.getState();
    const first = selectPlacedModel(s());
    expect(selectPlacedModel(s())).toBe(first);
    expect(first.constructs[0].circle).toBe(false);
    useStore.setState((st) => ({ settings: { ...st.settings, figure: { ...st.settings.figure, circleConstructs: true } } }));
    const circled = selectPlacedModel(s());
    expect(circled).not.toBe(first);
    expect(circled.constructs[0].circle).toBe(true);
    expect(constructGeometry(circled.constructs[0]).rx).toBe(36);
    // The store's model itself is not touched.
    expect(s().model.constructs[0]).not.toHaveProperty('circle');
  });
});
