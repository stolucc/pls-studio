// Gaussian copulas in the model: project files, the store, the menu, the layout and the figure.

import { beforeEach, describe, expect, it } from 'vitest';
import { renderFigureSvg, type FigureInput } from '../figure/render';
import { DEFAULT_FIGURE_STYLE, FIGURE_PRESETS, parseFigureStyle } from '../figure/style';
import { indicatorLabels } from '../diagramLabels';
import { autoLayout } from '../model/layout';
import { constructGeometry, distanceToSegment, pathSegment } from '../geometry';
import { placeModel } from '../placement';
import {
  DEFAULT_SETTINGS,
  impliedIntercepts,
  indicatorsDrawnElsewhere,
  parseProject,
  serializeProject,
  toSpec,
  validateModel,
  type Construct,
  type ModelState,
} from '../model/project';
import { plsRequest } from '../rengine/pls';
import { useStore } from '../store';
import { menuFor } from './canvasMenu';
import { copulaEstimate, copulaLayout } from './CopulaLayer';
import { COPULA_R } from './copulaGeometry';
import { covarianceLayout } from './CovarianceLayer';

const C = (id: string, x: number, y: number): Construct => ({
  id,
  name: id.toUpperCase(),
  type: 'factor',
  mode: 'A',
  indicators: [`${id}1`, `${id}2`],
  x,
  y,
  side: 'left',
});
const model = (): ModelState => ({
  constructs: [C('a', 0, 0), C('b', 400, 0), C('c', 400, 300)],
  paths: [
    { id: 'p', from: 'a', to: 'b' },
    { id: 'q', from: 'a', to: 'c' },
    { id: 'r', from: 'b', to: 'c' },
  ],
  moderations: [],
  copulas: [
    { id: 'g1', path: 'p' },
    { id: 'g2', path: 'q' },
  ],
});

describe('in the project', () => {
  it('reaches the estimator by construct names', () => {
    expect(toSpec(model()).copulas).toEqual([
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
    ]);
    expect(toSpec({ ...model(), copulas: undefined }).copulas).toBeUndefined();
  });
  it('survives a project file, and an unknown path is refused', () => {
    const text = serializeProject(model(), DEFAULT_SETTINGS, null, null, null);
    expect(parseProject(text).model.copulas).toEqual(model().copulas);
    const bad = JSON.parse(text);
    bad.model.copulas = [{ id: 'x', path: 'nope' }];
    expect(() => parseProject(JSON.stringify(bad))).toThrow(/unknown path/);
  });
  it('is a PLS-SEM option: other methods and PLSc are reported', () => {
    const errs = (m: Parameters<typeof validateModel>[2]) =>
      validateModel(model(), null, m).filter((e) => /copula/i.test(e.message));
    expect(errs({ method: 'pls', consistent: false })).toHaveLength(0);
    expect(errs({ method: 'cbsem', consistent: false })).toHaveLength(1);
    expect(errs({ method: 'pls', consistent: true })).toHaveLength(1);
    expect(errs({ method: 'pls', consistent: false, plsApproach: 'GSCA' })).toHaveLength(1);
  });
  it('is refused on the way to the R packages, which have no such term', () => {
    const data = { names: ['a1'], cols: [Float64Array.from([1, 2, 3])] };
    expect(() =>
      plsRequest(
        data,
        toSpec(model()),
        { scheme: 'path', maxIter: 300, tolerance: 1e-7, missing: 'mean', consistent: false },
        'cSEM',
      ),
    ).toThrow(/copula/);
  });
});

describe('in the store', () => {
  beforeEach(() => {
    useStore.getState().newProject();
    useStore.setState({ model: model(), readOnly: false } as never);
  });
  it('toggles a path’s term', () => {
    const s = useStore.getState();
    s.toggleCopula('r');
    expect(useStore.getState().model.copulas!.map((k) => k.path)).toEqual(['p', 'q', 'r']);
    s.toggleCopula('p');
    s.toggleCopula('q');
    s.toggleCopula('r');
    expect(useStore.getState().model.copulas).toBeUndefined();
  });
  it('removes a term with its path or predictor', () => {
    useStore.getState().deleteItems([], ['p']);
    expect(useStore.getState().model.copulas!.map((k) => k.path)).toEqual(['q']);
    useStore.getState().deleteItems(['a'], []);
    expect(useStore.getState().model.copulas).toEqual([]);
  });
});

describe('the path menu', () => {
  const items = (method: 'pls' | 'cbsem' | 'process', m = model(), id = 'r') =>
    menuFor({ kind: 'path', id }, m, { method } as never)!.items.filter(
      (i) => i && 'action' in i && i.action === 'toggle-copula',
    );
  it('offers it in PLS-SEM only, and to remove it once added', () => {
    expect(items('pls')[0].label).toMatch(/Add Gaussian copula/);
    expect(items('pls', model(), 'p')[0].label).toBe('Remove Gaussian copula');
    expect(items('cbsem')).toHaveLength(0);
    expect(items('process')).toHaveLength(0);
  });
});

describe('on the diagram', () => {
  it('has one circle per predictor with an arrow to each path, as far from each as its radius', () => {
    const g = copulaLayout(model());
    expect(g).toHaveLength(1);
    expect(g[0].from).toBe('a');
    expect(g[0].targets.map((t) => t.pathId)).toEqual(['p', 'q']);
    for (const t of g[0].targets)
      expect(Math.hypot(t.x1 - g[0].cx, t.y1 - g[0].cy)).toBeCloseTo(COPULA_R, 6);
  });
  it('keeps the circle off every path and shape, with room for each arrow, also when paths fan out', () => {
    // One predictor with three paths at close angles: the middle of the landings lies on a path.
    const m: ModelState = {
      constructs: [C('s', 0, 0), C('t', 300, -300), C('u', 340, -60), C('v', 760, 40)],
      paths: [
        { id: 'p', from: 's', to: 't' },
        { id: 'q', from: 's', to: 'u' },
        { id: 'r', from: 's', to: 'v' },
        { id: 'o', from: 't', to: 'v' },
      ],
      moderations: [],
      copulas: [
        { id: 'g1', path: 'p' },
        { id: 'g2', path: 'q' },
        { id: 'g3', path: 'r' },
      ],
    };
    const [g] = copulaLayout(m);
    const byId = new Map(m.constructs.map((c) => [c.id, c]));
    for (const p of m.paths)
      expect(
        distanceToSegment(g.cx, g.cy, pathSegment(byId.get(p.from)!, byId.get(p.to)!)!),
      ).toBeGreaterThan(COPULA_R);
    for (const c of m.constructs) {
      const b = constructGeometry(c).bounds;
      const inside =
        g.cx > c.x + b.x - COPULA_R &&
        g.cx < c.x + b.x + b.w + COPULA_R &&
        g.cy > c.y + b.y - COPULA_R &&
        g.cy < c.y + b.y + b.h + COPULA_R;
      expect(inside).toBe(false);
    }
    for (const t of g.targets)
      expect(Math.hypot(t.x2 - t.x1, t.y2 - t.y1)).toBeGreaterThanOrEqual(30);
  });
  it('places two predictors’ circles apart', () => {
    const m: ModelState = {
      ...model(),
      paths: [
        { id: 'p', from: 'a', to: 'c' },
        { id: 'q', from: 'b', to: 'c' },
      ],
      copulas: [
        { id: 'g1', path: 'p' },
        { id: 'g2', path: 'q' },
      ],
    };
    const [g, h] = copulaLayout(m);
    expect(Math.hypot(g.cx - h.cx, g.cy - h.cy)).toBeGreaterThan(2 * COPULA_R);
  });
  it('skips a term whose path is gone', () => {
    expect(copulaLayout({ ...model(), copulas: [{ id: 'x', path: 'gone' }] })).toEqual([]);
  });
  it('looks up an estimate and its bootstrap p', () => {
    const pls = {
      constructs: ['A', 'B', 'GC(A → B)'],
      pathCoef: [
        [0, 0.1, 0],
        [0, 0, 0],
        [0, 0.2, 0],
      ],
      copulas: [{ from: 'A', to: 'B', construct: 2, normality: { statistic: 1, p: 0 } }],
    } as never;
    const boot = { stats: [{ key: 'path:GC(A → B):B', p: 0.03 }] } as never;
    expect(copulaEstimate(pls, boot, 'A', 'B')).toEqual({ beta: 0.2, p: 0.03 });
    expect(copulaEstimate(pls, null, 'A', 'B')).toEqual({ beta: 0.2, p: null });
    expect(copulaEstimate(pls, boot, 'B', 'A')).toBeNull();
  });
  const fig = (): FigureInput => {
    const m = model();
    return {
      constructs: m.constructs.map((c) => ({
        c,
        geom: constructGeometry(c),
        r2: null,
        indicators: [null, null],
      })),
      paths: [],
      moderations: [],
      higherOrder: [],
      errors: [],
      correlations: [],
      copulas: copulaLayout(m).map((g) => ({
        cx: g.cx,
        cy: g.cy,
        targets: g.targets.map((t) => ({
          x1: t.x1,
          y1: t.y1,
          x2: t.x2,
          y2: t.y2,
          label: { value: 0.123, p: null },
        })),
      })),
    };
  };
  it('the PLS style draws purple circles with black dotted arrows; the default has its own colours', () => {
    const pls = renderFigureSvg(fig(), FIGURE_PRESETS.pls.style).svg;
    expect(pls).toMatch(/<circle [^>]*r="18" fill="#9980e5"/);
    expect(pls).toMatch(/<line [^>]*stroke="#000000"[^>]*stroke-dasharray="3 3"/);
    expect(pls).toContain('>GC<');
    const dflt = renderFigureSvg(fig(), DEFAULT_FIGURE_STYLE).svg;
    expect(dflt).toMatch(/<circle [^>]*r="18" fill="#fef3c7" stroke="#b45309"/);
    expect(dflt).toMatch(/<line [^>]*stroke="#b45309"[^>]*stroke-dasharray="3 3"/);
    expect(dflt).not.toContain('#9980e5');
  });
  it('estimates are written on the arrows; the black-and-white styles stay so', () => {
    expect(renderFigureSvg(fig(), DEFAULT_FIGURE_STYLE).svg).toContain('>0.123<');
    expect(renderFigureSvg(fig(), FIGURE_PRESETS.classic.style).svg).toMatch(
      /<circle [^>]*r="18" fill="#ffffff" stroke="#000000"/,
    );
  });
  it('colours from a project file are validated', () => {
    expect(parseFigureStyle({ copulaFill: 'url(x)' }).copulaFill).toBe(
      DEFAULT_FIGURE_STYLE.copulaFill,
    );
    expect(parseFigureStyle({ copulaFill: '#123456' }).copulaFill).toBe('#123456');
  });
});

describe('an indicator of several factors', () => {
  const bif = (): ModelState => {
    const K = (id: string, indicators: string[], y: number): Construct => ({
      id,
      name: id,
      type: 'factor',
      mode: 'A',
      indicators,
      x: 0,
      y,
      side: 'left',
    });
    return {
      constructs: [
        K('G', ['a1', 'a2', 'b1', 'b2', 'c'], 0),
        K('A', ['a1', 'a2'], 100),
        K('B', ['b1', 'b2'], 300),
      ],
      paths: [],
      moderations: [],
    };
  };
  it('is drawn once, with its specific factor', () => {
    const m = indicatorsDrawnElsewhere(bif());
    expect([...m.keys()]).toEqual(['G']);
    expect([...m.get('G')!].sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
    const placed = placeModel(bif(), false);
    expect(constructGeometry(placed.constructs[0]).indicators.map((i) => i.name)).toEqual(['c']);
    expect(constructGeometry(placed.constructs[1]).indicators.map((i) => i.name)).toEqual([
      'a1',
      'a2',
    ]);
    const arrows = covarianceLayout(placed, true, false).sharedLoadings;
    expect(arrows.map((a) => [a.construct, a.indicator])).toEqual([
      ['G', 'a1'],
      ['G', 'a2'],
      ['G', 'b1'],
      ['G', 'b2'],
    ]);
    const b = constructGeometry(placed.constructs[1]).indicators[0];
    // Ends on the box's border.
    const hit = arrows[0];
    expect(hit.x2).toBeGreaterThanOrEqual(b.x - 1e-6);
    expect(hit.x2).toBeLessThanOrEqual(b.x + b.w + 1e-6);
  });
  it('gets one intercept', () => {
    const m = { ...bif(), constant: { x: 0, y: 0 } };
    const all = impliedIntercepts(m).map((e) => e.indicator);
    expect(all.sort()).toEqual(['a1', 'a2', 'b1', 'b2', 'c']);
  });
  it('factors by equal size keep their boxes with the first', () => {
    const K = (id: string): Construct => ({
      id,
      name: id,
      type: 'factor',
      mode: 'A',
      indicators: ['x', 'y'],
      x: 0,
      y: 0,
      side: 'left',
    });
    expect([...indicatorsDrawnElsewhere({ constructs: [K('A'), K('C')] }).keys()]).toEqual(['C']);
  });
  it('lays out specific factors clear of each other, with the general factor to the left of their boxes', () => {
    const out = Object.fromEntries(autoLayout(bif()).map((c) => [c.id, c]));
    expect(out.G.x).toBeLessThan(out.A.x - 300);
    expect(out.B.y - out.A.y).toBeGreaterThanOrEqual(2 * 34);
    expect(out.G.y).toBeGreaterThan(out.A.y);
    expect(out.G.y).toBeLessThan(out.B.y);
  });
  it('a factor scaled by its variance has no marker of 1', () => {
    const c = { ...bif().constructs[1], scaling: 'variance' as const };
    expect(indicatorLabels(c, 'cbsem', null)).toEqual([null, null]);
    expect(indicatorLabels(bif().constructs[1], 'cbsem', null)![0]!.text).toBe('1');
  });
  it('labels each factor’s own loading', () => {
    const src = {
      indicator: (_name: string, construct?: string) => (construct === 'G' ? 0.5 : 0.2),
      reflectiveThresholds: () => true,
    };
    const g = bif().constructs[0],
      a = bif().constructs[1];
    expect(indicatorLabels(g, 'cbsem', src)![0]!.text).toBe('0.500');
    expect(indicatorLabels(a, 'cbsem', src)![0]!.text).toBe('0.200');
  });
});
