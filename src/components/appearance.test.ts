// How things are drawn (shapes, colours, lines, comments), and recalculating by itself.

import { beforeEach, describe, expect, it } from 'vitest';
import { autoCalculateDue } from '../autoCalculate';
import { renderFigureSvg, type FigureInput } from '../figure/render';
import { DEFAULT_FIGURE_STYLE } from '../figure/style';
import { constructGeometry, octagonVertices, pathCurve, pathSegment, shapePoint } from '../geometry';
import { DEFAULT_SETTINGS, parseProject, serializeProject, toSpec, type Construct, type ModelState } from '../model/project';
import { resultsKey, useStore } from '../store';

const C = (id: string, x: number, more: Partial<Construct> = {}): Construct => ({ id, name: id.toUpperCase(), type: 'factor', mode: 'A', indicators: [`${id}1`, `${id}2`], x, y: 0, side: 'left', ...more });
const model = (): ModelState => ({ constructs: [C('a', 0), C('b', 500)], paths: [{ id: 'p', from: 'a', to: 'b' }], moderations: [] });
const figure = (m: ModelState): FigureInput => ({
  constructs: m.constructs.map((c) => ({ c, geom: constructGeometry(c), r2: null, indicators: [null, null] })),
  paths: m.paths.map((p) => ({ key: p.id, ...pathSegment(m.constructs[0], m.constructs[1])!, label: { value: 0.5, p: null }, moderated: false, line: p.line, curved: p.curved })),
  moderations: [], higherOrder: [], errors: [], correlations: [], notes: m.notes,
});

describe('construct shapes', () => {
  it('end arrows on a rectangle’s and an octagon’s border', () => {
    expect(shapePoint('rectangle', 50, 30, 1, 0)).toEqual([50, 0]);
    expect(shapePoint('rectangle', 50, 30, 0, 1)).toEqual([0, 30]);
    const [x, y] = shapePoint('octagon', 50, 30, 1, 0);
    expect([x, y]).toEqual([50, 0]);
    expect(octagonVertices(50, 30)).toHaveLength(8);
    expect(shapePoint('octagon', 50, 30, 0, -1)).toEqual([expect.closeTo(0), -30]);
    const g = constructGeometry(C('a', 0, { shape: 'rectangle' }));
    expect(g.indicators).toHaveLength(2);
    expect(Math.abs(g.indicators[0].ex)).toBeCloseTo(g.rx, 6);
  });
  it('are drawn in the figure, with the colour on the construct and its indicators', () => {
    const m = model();
    m.constructs[0] = C('a', 0, { shape: 'octagon', color: '#e6b34d' });
    m.constructs[1] = C('b', 500, { shape: 'rectangle' });
    const { svg } = renderFigureSvg(figure(m), DEFAULT_FIGURE_STYLE);
    expect(svg).not.toContain('<ellipse');
    expect(svg).toMatch(/<polygon [^>]*fill="#e6b34d"/);
    expect([...svg.matchAll(/<rect [^>]*fill="#e6b34d"/g)]).toHaveLength(2);
  });
});

describe('path lines', () => {
  it('are dashed, dotted or curved in the figure', () => {
    const svg = (p: Partial<ModelState['paths'][number]>) => { const m = model(); m.paths[0] = { ...m.paths[0], ...p }; return renderFigureSvg(figure(m), DEFAULT_FIGURE_STYLE).svg; };
    expect(svg({})).not.toContain('stroke-dasharray');
    expect(svg({ line: 'dashed' })).toContain('stroke-dasharray="7 4"');
    expect(svg({ line: 'dotted' })).toContain('stroke-dasharray="1.5 4"');
    expect(svg({ curved: true })).toMatch(/<path d="M [^"]+ Q [^"]+" fill="none"/);
    expect(svg({ curved: true, line: 'dashed' })).toMatch(/ Q [^"]+" fill="none"[^>]*stroke-dasharray="7 4"/);
  });
  it('a curve’s midpoint lies on it, off the straight line', () => {
    const k = pathCurve({ x1: 0, y1: 0, x2: 100, y2: 0 });
    expect(k.mx).toBeCloseTo(50, 8);
    expect(Math.abs(k.my)).toBeCloseTo(9, 8);
  });
});

describe('comments', () => {
  const m = (): ModelState => ({ ...model(), notes: [{ id: 'note-1', x: 10, y: 20, text: 'a < b & "c"\nline two' }] });
  it('are exported, escaped, line by line', () => {
    const { svg } = renderFigureSvg(figure(m()), DEFAULT_FIGURE_STYLE);
    expect(svg).toContain('a &lt; b &amp; &quot;c&quot;');
    expect(svg).toContain('>line two<');
  });
  it('survive a project file, which drops malformed ones and limits their length', () => {
    const text = serializeProject(m(), DEFAULT_SETTINGS, null, null, null);
    expect(parseProject(text).model.notes).toEqual(m().notes);
    const raw = JSON.parse(text);
    raw.model.notes = [{ id: 'x', x: 'NaN', y: 0, text: 'bad' }, { id: 'y', x: 0, y: 0, text: 'z'.repeat(9000) }];
    const notes = parseProject(JSON.stringify(raw)).model.notes!;
    expect(notes).toHaveLength(1);
    expect(notes[0].text).toHaveLength(5000);
  });
  it('do not touch the model’s estimates', () => {
    expect(toSpec(m())).toEqual(toSpec(model()));
    const s = { model: model(), settings: DEFAULT_SETTINGS, dataVersion: 1 };
    expect(resultsKey({ ...s, model: { ...m() } })).toBe(resultsKey(s));
  });
  it('are added, edited and removed in the store', () => {
    useStore.getState().newProject();
    useStore.setState({ model: model() });
    useStore.getState().addNote(1, 2);
    const id = useStore.getState().model.notes![0].id;
    expect(id.startsWith('note-')).toBe(true);
    useStore.getState().updateNote(id, 'hello');
    useStore.getState().moveNote(id, 5, 6);
    expect(useStore.getState().model.notes).toEqual([{ id, x: 5, y: 6, text: 'hello' }]);
    useStore.getState().deleteItems([id], []);
    expect(useStore.getState().model.notes).toEqual([]);
    expect(useStore.getState().model.constructs).toHaveLength(2);
  });
});

describe('appearance', () => {
  it('leaves results current', () => {
    const s = { model: model(), settings: DEFAULT_SETTINGS, dataVersion: 1 };
    const m = model();
    m.constructs[0] = { ...m.constructs[0], color: '#123456', shape: 'octagon' };
    m.paths[0] = { ...m.paths[0], line: 'dotted', curved: true };
    expect(resultsKey({ ...s, model: m })).toBe(resultsKey(s));
  });
  it('rejects a colour from a project file that is not one', () => {
    const m = model();
    const raw = JSON.parse(serializeProject(m, DEFAULT_SETTINGS, null, null, null));
    raw.model.constructs[0].color = 'url(javascript:x)';
    raw.model.constructs[0].shape = 'star';
    raw.model.paths[0].line = '<x>';
    const back = parseProject(JSON.stringify(raw)).model;
    expect(back.constructs[0].color).toBeUndefined();
    expect(back.constructs[0].shape).toBeUndefined();
    expect(back.paths[0].line).toBeUndefined();
  });
});

describe('recalculating by itself', () => {
  const data = { names: ['a1', 'a2', 'b1', 'b2'], cols: [0, 1, 2, 3].map((k) => Float64Array.from({ length: 30 }, (_, i) => Math.sin(i * (k + 1)))) };
  const base = { model: model(), data, dataVersion: 1, job: null, results: null, settings: { ...DEFAULT_SETTINGS, autoCalculate: true } };
  beforeEach(() => {});
  it('runs when on and the model changed', () => {
    expect(autoCalculateDue(base as never, null)).toBe(true);
  });
  it('waits when off, busy, without data, or with an empty or invalid model', () => {
    expect(autoCalculateDue({ ...base, settings: DEFAULT_SETTINGS } as never, null)).toBe(false);
    expect(autoCalculateDue({ ...base, job: { kind: 'estimate' } } as never, null)).toBe(false);
    expect(autoCalculateDue({ ...base, data: null } as never, null)).toBe(false);
    expect(autoCalculateDue({ ...base, model: { constructs: [], paths: [], moderations: [] } } as never, null)).toBe(false);
    const dangling = model();
    dangling.constructs[0] = { ...dangling.constructs[0], indicators: [] };
    expect(autoCalculateDue({ ...base, model: dangling } as never, null)).toBe(false);
  });
  it('does not repeat a model it tried, or recalculate current results', () => {
    const key = resultsKey(base);
    expect(autoCalculateDue(base as never, key)).toBe(false);
    expect(autoCalculateDue({ ...base, results: { key } } as never, null)).toBe(false);
  });
  it('does not make results stale by being switched', () => {
    expect(resultsKey(base)).toBe(resultsKey({ ...base, settings: DEFAULT_SETTINGS }));
  });
});
