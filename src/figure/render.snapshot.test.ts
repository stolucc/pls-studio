// The figure SVG of a model with every kind of shape and arrow, under every built-in style, both methods, with and
// without circles: pinned so that restructuring the renderer cannot change a byte of its output.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Construct, ModelState } from '../model/project';
import { placeModel } from '../placement';
import { buildFigureInput, type FigureValues } from './build';
import { renderFigureSvg } from './render';
import { FIGURE_PRESETS } from './style';

const K = (id: string, indicators: string[], x: number, y: number, side: Construct['side'], extra: Partial<Construct> = {}): Construct =>
  ({ id, name: id, type: 'factor', mode: 'A', indicators, x, y, side, ...extra });

const model = (): ModelState => ({
  constructs: [
    K('Trust <&>', ['a1', 'a2', 'a3'], 0, 0, 'left', { id: 'A' }),
    K('B', ['b1', 'b2', 'b3'], 420, 0, 'top', { type: 'composite', mode: 'B', color: '#ffeedd' }),
    K('C', ['c1'], 0, 280, 'left', { covariate: true }),
    K('D', ['d1', 'd2'], 840, 0, 'right', { shape: 'octagon' }),
    K('E', ['e1', 'e2'], 420, 320, 'bottom', { shape: 'rectangle' }),
    K('H', [], 420, -320, 'top', { components: ['A', 'D'] }),
    K('G', ['a1', 'a2', 'd1', 'g1'], -360, -200, 'left'),
  ],
  paths: [
    { id: 'ab', from: 'A', to: 'B', curved: true }, { id: 'bd', from: 'B', to: 'D', line: 'dashed' }, { id: 'cb', from: 'C', to: 'B' },
    { id: 'ae', from: 'A', to: 'E', line: 'dotted' }, { id: 'ed', from: 'E', to: 'D' }, { id: 'de', from: 'D', to: 'E' },
  ],
  moderations: [{ id: 'm1', path: 'ab', moderator: 'C' }, { id: 'm2', path: 'ae', moderator: 'A' }],
  correlations: [{ id: 'k1', kind: 'construct', a: 'A', b: 'C' }, { id: 'k2', kind: 'indicator', a: 'a2', b: 'a3' }, { id: 'k3', kind: 'construct', a: 'B', b: 'E' }],
  copulas: [{ id: 'g1', path: 'cb' }],
  constant: { x: -300, y: 120 },
  means: [{ id: 'mean1', target: 'A' }, { id: 'mean2', target: 'C', fixed: 0 }],
  notes: [{ id: 'note-1', x: -200, y: 420, text: 'A note\nover two lines & <tags>' }],
});

// Deterministic estimates, some missing, some significant.
const v = (s: string) => { let h = 7; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 1009; return h; };
const est = (s: string) => (v(s) % 5 === 0 ? null : (v(s) % 200) / 100 - 1);
const p = (s: string) => (v(s) % 3 === 0 ? 0.2 : v(s) % 3 === 1 ? 0.0004 : null);
const values: FigureValues = {
  indicator: (name, c) => est(name + c), fixed: (name) => name === 'e1', r2: (c) => (v(c) % 4 === 0 ? null : (v(c) % 90) / 100),
  path: (from, to) => ({ beta: est(from + to), p: p(from + to) }), moderation: (id) => ({ beta: est(id), p: p(id) }),
  higherOrder: (parent, child) => ({ value: est(parent + child) ?? 0.5, fixed: child === 'A' }), error: (kind, name) => (v(kind + name) % 7 === 0 ? null : (v(kind + name) % 80) / 100),
  correlation: (k) => ({ value: est(JSON.stringify(k)), p: p(JSON.stringify(k)) }), mean: (name) => ({ value: est(name), p: p(name) }), copula: (from, to) => ({ beta: est(from + to), p: p(from + to) }),
};

const render = (method: 'pls' | 'cbsem', circle: boolean, preset: string) =>
  renderFigureSvg(buildFigureInput(placeModel(model(), circle), method, values, { showErrors: method === 'cbsem', showIntercepts: true, showImpliedEffects: true }),
    { ...FIGURE_PRESETS[preset].style, circleConstructs: circle }).svg;

describe('the figure SVG of a rich model', () => {
  it('is unchanged under every style', () => {
    const digests: Record<string, string> = {};
    for (const method of ['pls', 'cbsem'] as const) for (const circle of [false, true]) for (const preset of Object.keys(FIGURE_PRESETS)) {
      digests[`${method}/${circle ? 'circles' : 'ellipses'}/${preset}`] = createHash('sha256').update(render(method, circle, preset)).digest('hex').slice(0, 16);
    }
    expect(digests).toMatchSnapshot();
  });
  it('is unchanged in full for the default style', () => {
    expect(render('cbsem', false, 'default')).toMatchSnapshot();
  });
});
