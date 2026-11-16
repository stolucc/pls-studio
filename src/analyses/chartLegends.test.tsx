// The legends and plot panels of charts that tell series or roles apart by colour (figure/legend.tsx,
// figure/panel.tsx): the legend is inside each chart's SVG, so an exported figure keeps its key.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { LoopChart } from './bsem';
import { EventChart } from './did';
import { Scree } from './efa';
import { ClusterLines } from './lmm';
import { LovePlot } from './match';
import { Surface } from './rsa';

/** The chart's SVG markup (what an export takes). */
const svgOf = (el: ReactElement) => {
  const html = renderToStaticMarkup(el);
  return html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));
};

const expectLegend = (svg: string, labels: string[]) => {
  expect(svg).toContain('aria-label="Legend"');
  for (const l of labels) expect(svg).toContain(`>${l}</text>`);
};

describe('charts with a legend', () => {
  it('Love plot: before and after matching', () => {
    const b = [{ variable: 'age', diffBefore: 0.4, diffAfter: 0.05 }] as never;
    const svg = svgOf(<LovePlot b={b} stage="matching" />);
    expectLegend(svg, ['Before matching (open circle)', 'After matching']);
    expect(svg).toContain('class="plot-panel"');
    expectLegend(svgOf(<LovePlot b={b} stage="weighting" />), ['After weighting']);
  });

  it('cluster lines: each cluster’s line and the average', () => {
    const l = {
      predictor: 'x',
      range: [0, 1],
      intercepts: [1, 2],
      slopes: [0.5, -0.5],
      fixed: [1.5, 0],
    };
    const svg = svgOf(<ClusterLines l={l as never} />);
    expectLegend(svg, ['Each cluster’s line', 'Average (fixed) line']);
    expect(svg).toContain('class="plot-panel"');
  });

  it('scree plot: eigenvalues, parallel analysis (when it ran) and the eigenvalue-1 line', () => {
    const r = { method: 'fa', eigenvalues: [2.5, 1.1, 0.4] };
    const plain = svgOf(<Scree r={r as never} />);
    expectLegend(plain, ['Eigenvalues', 'Eigenvalue 1']);
    expect(plain).not.toContain('Parallel analysis');
    expect(plain).toContain('class="plot-panel"');
    const parallel = { ...r, parallel: { observed: [2.5, 1.1, 0.4], simulated: [1.3, 1.1, 0.9] } };
    expectLegend(svgOf(<Scree r={parallel as never} />), ['Parallel analysis (random data)']);
  });

  it('Bayesian loop plot: the posterior median and the credible interval', () => {
    const l = {
      name: 'indirect',
      variable: 'w',
      expr: 'a*b',
      x: [0, 1, 2],
      median: [0.1, 0.2, 0.3],
      mean: [0.1, 0.2, 0.3],
      sd: [0.1, 0.1, 0.1],
      low: [0, 0.1, 0.2],
      high: [0.2, 0.3, 0.4],
    };
    const svg = svgOf(<LoopChart l={l} conf={0.95} />);
    expectLegend(svg, ['Posterior median', '95% credible interval']);
    expect(svg).toContain('class="plot-panel"');
  });

  it('response surface: the lines of congruence and incongruence (a 3D view: no plot panel)', () => {
    const grid = [-1, 0, 1];
    const r = { grid, z: grid.map((x) => grid.map((y) => x * y)), points: { x: [], y: [] } };
    const input = { x: 'X', y: 'Y', outcome: 'Z', center: 'none' };
    const svg = svgOf(<Surface r={r as never} input={input as never} />);
    expectLegend(svg, ['Congruence (X = Y)', 'Incongruence (X = −Y)']);
    expect(svg).not.toContain('plot-panel');
  });
});

describe('one-colour charts', () => {
  it('event study: a plot panel and no legend', () => {
    const r = {
      event: [
        { rel: -1, est: 0, ciLow: -0.2, ciHigh: 0.2 },
        { rel: 0, est: 0.3, ciLow: 0.1, ciHigh: 0.5 },
      ],
    };
    const svg = svgOf(<EventChart r={r as never} />);
    expect(svg).toContain('class="plot-panel"');
    expect(svg).not.toContain('aria-label="Legend"');
  });
});
