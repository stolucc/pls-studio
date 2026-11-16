// The growth charts' keys: inside each chart's SVG, so an exported figure keeps them.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GrowthResult } from '../rengine/longitudinal';
import type { GmmModel, GmmResult } from '../rengine/mixed';
import { Trajectories, Trajectory } from './longitudinal';

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
