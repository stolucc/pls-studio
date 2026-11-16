// @vitest-environment happy-dom
// What the charts tell ggplot2 they draw (ChartFrame's figure, src/figure/ggplot.ts): the same marks from the same
// numbers, the series named as in each chart's legend, the axis titles in use and the chart's ranges.
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FigureSpec } from '../figure/ggplot';
import * as format from '../format';
import { LoopChart } from './bsem';
import { chartAnalysis } from './charts';
import { EventChart } from './did';
import { Scree } from './efa';
import { ClusterLines } from './lmm';
import { CeilingPlot } from './nca';
import { XYPlot } from './qca';
import { Fusion } from './segmentation';

const gg = vi.hoisted(() => ({
  file: vi.fn(async (_spec: unknown) => new Blob(['%PDF-'])),
  script: vi.fn(async () => ''),
}));
vi.mock('../figure/ggplot', () => ({ ggplotFile: gg.file, ggplotScript: gg.script }));

let host: HTMLDivElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
});

/** Renders the chart, asks for its ggplot2 PDF and returns the description the chart gave. */
async function figureOf(el: ReactElement): Promise<FigureSpec> {
  vi.spyOn(format, 'downloadBlob').mockImplementation(() => {});
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  const button = host.querySelector('[title^="This chart drawn by ggplot2"]') as HTMLButtonElement;
  act(() => button.click());
  await act(async () => (host!.querySelector('[role="menuitem"]') as HTMLButtonElement).click());
  act(() => root.unmount());
  return gg.file.mock.calls.at(-1)![0] as FigureSpec;
}

const geoms = (spec: FigureSpec) => spec.layers.map((l) => [l.geom, l.series ?? '']);

describe('charts described to ggplot2', () => {
  it('histogram: one bar per bin over the bins’ range', async () => {
    const result = {
      kind: 'histogram',
      x: 'age',
      bins: [
        { from: 0, to: 1, count: 3 },
        { from: 1, to: 2, count: 5 },
      ],
      n: 8,
      mean: 1,
      sd: 0.5,
    };
    const spec = await figureOf(
      <chartAnalysis.View result={result as never} options={{} as never} current />,
    );
    expect(spec.x).toEqual({ title: 'age', limits: [0, 2] });
    expect(spec.y.title).toBe('Count');
    expect(spec.layers[0]).toMatchObject({
      geom: 'rect',
      xmin: [0, 1],
      xmax: [1, 2],
      ymin: [0, 0],
      ymax: [3, 5],
    });
  });

  it('scatterplot: each group’s points and the least-squares line', async () => {
    const result = {
      kind: 'scatter',
      x: 'x',
      y: 'y',
      points: [
        { x: 0, y: 1, g: 0 },
        { x: 1, y: 3, g: 1 },
        { x: 2, y: 5, g: 1 },
      ],
      groups: ['a', 'b'],
      fit: { intercept: 1, slope: 2, r: 1 },
      n: 3,
      omitted: 0,
    };
    const spec = await figureOf(
      <chartAnalysis.View result={result as never} options={{} as never} current />,
    );
    expect(geoms(spec)).toEqual([
      ['point', 'a'],
      ['point', 'b'],
      ['line', 'Least squares'],
    ]);
    expect(spec.layers[1]).toMatchObject({ x: [1, 2], y: [3, 5] });
    const [x0, x1] = spec.x.limits!;
    expect(spec.layers[2].y).toEqual([1 + 2 * x0, 1 + 2 * x1]);
    expect(spec.x.title).toBe('x');
    expect(spec.y.title).toBe('y');
  });

  it('cluster lines: every cluster’s segment and the average line', async () => {
    const l = {
      predictor: 'ses',
      range: [0, 2],
      intercepts: [1, 2],
      slopes: [0.5, -0.5],
      fixed: [1.5, 0],
    };
    const spec = await figureOf(<ClusterLines l={l as never} />);
    expect(geoms(spec)).toEqual([
      ['segment', 'Each cluster’s line'],
      ['segment', 'Average (fixed) line'],
    ]);
    expect(spec.layers[0]).toMatchObject({ x: [0, 0], xend: [2, 2], y: [1, 2], yend: [2, 1] });
    expect(spec.x).toEqual({ title: 'ses', limits: [0, 2] });
  });

  it('ceiling plot: the observations, the CE-FDH step and the CR-FDH line', async () => {
    const k = {
      x: 'x',
      n: 3,
      scope: [0, 10, 0, 10],
      intercept: 2,
      slope: 1,
      peers: { x: [1, 5], y: [4, 9] },
      points: { x: [1, 5, 8], y: [4, 9, 3] },
    };
    const spec = await figureOf(<CeilingPlot k={k as never} y="y" />);
    expect(geoms(spec)).toEqual([
      ['point', 'Observations'],
      ['step', 'CE-FDH ceiling'],
      ['line', 'CR-FDH ceiling'],
    ]);
    // (from the scope's left edge to its right, through the peers)
    expect(spec.layers[1]).toMatchObject({ x: [0, 1, 5, 10], y: [4, 4, 9, 9] });
    expect(spec.layers[2]).toMatchObject({ linetype: 'dashed', x: [0, 8], y: [2, 10] });
    expect(spec.y).toEqual({ title: 'y', limits: [0, 10] });
  });

  it('scree plot: eigenvalues, parallel analysis and the eigenvalue-1 line', async () => {
    const r = {
      method: 'fa',
      eigenvalues: [2.5, 1.1, 0.4],
      parallel: { observed: [2.5, 1.1, 0.4], simulated: [1.3, 1.1, 0.9] },
    };
    const spec = await figureOf(<Scree r={r as never} />);
    expect(geoms(spec)).toEqual([
      ['hline', 'Eigenvalue 1'],
      ['line', 'Parallel analysis (random data)'],
      ['line', 'Eigenvalues'],
      ['point', 'Eigenvalues'],
    ]);
    expect(spec.layers[2]).toMatchObject({ x: [1, 2, 3], y: [2.5, 1.1, 0.4] });
    expect(spec.x).toEqual({ title: 'Factor', limits: [1, 3] });
  });

  it('Bayesian loop plot: the median and both bounds of the credible interval', async () => {
    const l = {
      name: 'indirect',
      variable: 'w',
      x: [0, 1, 2],
      median: [0.1, 0.2, 0.3],
      low: [0, 0.1, 0.1],
      high: [0.2, 0.3, 0.5],
    };
    const spec = await figureOf(<LoopChart l={l as never} conf={0.95} />);
    expect(geoms(spec)).toEqual([
      ['hline', ''],
      ['line', '95% credible interval'],
      ['line', '95% credible interval'],
      ['line', 'Posterior median'],
    ]);
    expect(spec.layers[3]).toMatchObject({ x: [0, 1, 2], y: [0.1, 0.2, 0.3] });
    expect(spec.x.title).toBe('w');
    expect(spec.y.title).toBe('indirect');
  });

  it('event study: reference lines, intervals, and the periods before and after treatment', async () => {
    const r = {
      design: 'twfe',
      event: [
        { rel: -2, est: 0.1, ciLow: -0.2, ciHigh: 0.4 },
        { rel: -1, est: 0, ciLow: 0, ciHigh: 0 },
        { rel: 0, est: 0.5, ciLow: 0.2, ciHigh: 0.8 },
      ],
    };
    const spec = await figureOf(<EventChart r={r as never} />);
    expect(spec.layers.map((l) => l.geom)).toEqual(['hline', 'vline', 'segment', 'point', 'point']);
    expect(spec.layers[2]).toMatchObject({
      x: [-2, -1, 0],
      y: [-0.2, 0, 0.2],
      yend: [0.4, 0, 0.8],
    });
    expect(spec.layers[3]).toMatchObject({ x: [-2, -1], color: '#4f46e5' });
    expect(spec.layers[4]).toMatchObject({ x: [0], y: [0.5], color: '#d93b2f' });
    expect(spec.x).toEqual({ title: 'Period relative to treatment', limits: [-2, 0] });
  });

  it('fusion levels: one bar per merge, at the number of classes it leaves', async () => {
    const spec = await figureOf(<Fusion heights={[5, 3, 1]} />);
    expect(spec.layers[0]).toMatchObject({
      geom: 'rect',
      xmin: [1.6, 2.6, 3.6],
      ymax: [5, 3, 1],
    });
    expect(spec.x).toEqual({ title: 'Classes below this merge', limits: [1.5, 4.5] });
  });

  it('QCA XY plot: the cases, the diagonal and the 0.5 lines on the unit square', async () => {
    const m = { label: 'M1', membership: [0.2, 0.8, 0.5], inclS: 0.9, covS: 0.6 };
    const r = { outcome: 'surv', negated: false, outcomeValues: [0.3, 0.9, 0.4, 0.7] };
    const spec = await figureOf(<XYPlot m={m as never} r={r as never} />);
    expect(spec.layers.map((l) => l.geom)).toEqual(['vline', 'hline', 'line', 'point']);
    expect(spec.layers[3]).toMatchObject({ x: [0.2, 0.8, 0.5], y: [0.3, 0.9, 0.4] });
    expect(spec.x).toEqual({ title: 'Solution membership', limits: [0, 1] });
    expect(spec.y.limits).toEqual([0, 1]);
  });
});
