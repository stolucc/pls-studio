// @vitest-environment happy-dom
// The growth charts' keys: inside each chart's SVG, so an exported figure keeps them.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { figureOf } from './figureOf';
import type { GrowthResult } from '../rengine/longitudinal';
import type { GmmModel, GmmResult } from '../rengine/mixed';
import { Trajectories, Trajectory } from './longitudinal';

const gg = vi.hoisted(() => ({
  file: vi.fn(async (_spec: unknown) => new Blob(['%PDF-'])),
  script: vi.fn(async () => ''),
}));
vi.mock('../figure/ggplot', () => ({ ggplotFile: gg.file, ggplotScript: gg.script }));

const engine = { package: 'lavaan', version: '1' };
const svgOf = (html: string, label: string) => {
  const from = html.indexOf(`aria-label="${label}"`);
  return html.slice(from, html.indexOf('</svg>', from));
};

describe('the growth charts', () => {
  it('keys the model-implied and the observed means of a growth curve', () => {
    const r = {
      n: 100,
      fit: {},
      estimates: [],
      r2: {},
      impliedMeans: [1, 2, 3],
      observedMeans: [1.1, 1.9, 3.2],
      measures: ['y1', 'y2', 'y3'],
      times: [0, 1, 2],
      warnings: [],
      engine,
    } as GrowthResult;
    const svg = svgOf(renderToStaticMarkup(<Trajectory r={r} />), 'Mean trajectory');
    expect(svg).toContain('aria-label="Legend"');
    expect(svg).toContain('>Model-implied mean</text>');
    expect(svg).toContain('>Observed mean</text>');
    expect(svg).toContain('class="plot-panel"');
  });

  it('keys each class of a growth mixture model, keeping the labels at the lines’ ends', () => {
    const m = {
      k: 2,
      shares: [0.6, 0.4],
      trajectories: [
        [1, 2],
        [3, 2],
      ],
      observed: null,
    } as unknown as GmmModel;
    const r = { times: [0, 1], observedTimes: [], models: [m] } as unknown as GmmResult;
    const svg = svgOf(renderToStaticMarkup(<Trajectories r={r} m={m} />), 'Class trajectories');
    expect(svg).toContain('aria-label="Legend"');
    expect(svg).toContain('>Class 1 (60%)</text>');
    expect(svg).toContain('>Class 2 (40%)</text>');
    // (and the direct label at the end of each line, as before)
    expect(svg.match(/text-anchor="end" fill="#2a78d6">Class/g)).toHaveLength(1);
    expect(svg).toContain('class="plot-panel"');
  });
});

describe('the growth charts drawn by ggplot2', () => {
  it('draws the implied means as a line and the observed means as points', async () => {
    const r = {
      impliedMeans: [1, 2, 3],
      observedMeans: [1.1, 1.9, 3.2],
      measures: ['y1', 'y2', 'y3'],
      times: [0, 1, 2],
    } as GrowthResult;
    const spec = await figureOf(<Trajectory r={r} />, 'Mean trajectory', gg.file);
    expect(spec.layers).toMatchObject([
      { geom: 'line', series: 'Model-implied mean', x: [0, 1, 2], y: [1, 2, 3] },
      { geom: 'point', series: 'Observed mean', y: [1.1, 1.9, 3.2] },
    ]);
    expect(spec.x.title).toBe('Time');
  });

  it('draws each class’s trajectory and observed means under the class’s name', async () => {
    const m = {
      k: 2,
      shares: [0.6, 0.4],
      trajectories: [
        [1, 2],
        [3, 2],
      ],
      observed: [
        [1.1, null],
        [2.9, 2.1],
      ],
    } as unknown as GmmModel;
    const r = { times: [0, 1], observedTimes: [0, 1], models: [m] } as unknown as GmmResult;
    const spec = await figureOf(<Trajectories r={r} m={m} />, 'Class trajectories', gg.file);
    expect(spec.layers.map((l) => `${l.geom}:${l.series}`)).toEqual([
      'line:Class 1 (60%)',
      'point:Class 1 (60%)',
      'line:Class 2 (40%)',
      'point:Class 2 (40%)',
    ]);
    expect(spec.layers[1].y).toEqual([1.1, null]);
  });
});
