// @vitest-environment happy-dom
// What each chart tells ggplot2 it draws (ChartFrame's figure, src/figure/ggplot.ts): the same marks from the
// same numbers, with the series names and colours of the chart's own legend.
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POSITIVE_COLOR, SERIES_COLORS } from '../figure/palette';
import type { FigureSpec, GgLayer } from '../figure/ggplot';
import * as format from '../format';
import type { NonlinearEquation } from '../engine/nonlinear';
import type { PwrResult } from '../rengine/pwr';
import { DfiHistogram } from './dfi';
import { CurveChart } from './medsens';
import { Curve } from './nonlinear';
import { PowerCurve } from './power';
import { PathChart, type RegsemResult } from './regularized';
import { SemsensChart } from './semsens';
import { StdPowerCurve } from './stdPower';

const gg = vi.hoisted(() => ({
  file: vi.fn(async (_spec: unknown) => new Blob(['%PDF-'])),
  script: vi.fn(async () => ''),
}));
vi.mock('../figure/ggplot', () => ({ ggplotFile: gg.file, ggplotScript: gg.script }));

let host: HTMLDivElement;
afterEach(() => host?.remove());

/** Renders the chart, asks for its ggplot2 PDF and returns the description it handed over. */
async function figureOf(el: ReactNode): Promise<FigureSpec> {
  vi.spyOn(format, 'downloadBlob').mockImplementation(() => {});
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  act(() =>
    (host.querySelector('[title^="This chart drawn by ggplot2"]') as HTMLButtonElement).click(),
  );
  await act(async () => (host.querySelector('[role="menuitem"]') as HTMLButtonElement).click());
  act(() => root.unmount());
  return gg.file.mock.calls.at(-1)![0] as FigureSpec;
}
const kinds = (s: FigureSpec) => s.layers.map((l) => `${l.geom}:${l.series ?? ''}`);
const layer = (s: FigureSpec, series: string) =>
  s.layers.find((l) => l.series === series) as GgLayer;

describe('charts drawn by ggplot2', () => {
  it('the DFI histogram: each model’s bars and both cutoffs', async () => {
    const s = await figureOf(
      <DfiHistogram
        id="dfi:t"
        index="SRMR"
        truth={[0.02, 0.03, 0.03, 0.04]}
        misspec={[0.06, 0.07, 0.07]}
        cutoff={0.05}
        title="Level 1"
      />,
    );
    expect(kinds(s)).toEqual([
      'rect:Correct model',
      'rect:Misspecified',
      'vline:Dynamic cutoff 0.050',
      'vline:Hu & Bentler 0.08 (dotted)',
    ]);
    const bars = layer(s, 'Correct model');
    // (the non-empty bins only, as the chart draws them; four values in all)
    expect(bars.ymax!.reduce((a, b) => a + b, 0)).toBe(4);
    expect(bars.alpha).toBe(0.55);
    expect(layer(s, 'Hu & Bentler 0.08 (dotted)')).toMatchObject({ linetype: 'dotted', x: [0.08] });
    expect(s.x.title).toBe('SRMR');
    expect(s.y).toMatchObject({ title: 'Replications' });
  });

  it('the regularised path: each coefficient, the zero ones grouped, and the chosen level', async () => {
    const r = {
      penalised: ['A → b1', 'B → a1'],
      selector: 'bic',
      selected: { lambda: 0.2, delta: null },
      path: [0, 0.2, 0.4].map((lambda) => ({
        lambda,
        delta: null,
        converged: true,
        values: [0.4 - lambda, lambda === 0 ? 0.1 : 0],
      })),
    } as unknown as RegsemResult;
    const s = await figureOf(<PathChart r={r} />);
    expect(kinds(s)).toEqual([
      'hline:',
      'vline:Chosen by BIC',
      'line:A → b1',
      'line:Zero at the chosen level',
    ]);
    expect(layer(s, 'A → b1')).toMatchObject({ color: SERIES_COLORS[0], x: [0, 0.2, 0.4] });
    expect(layer(s, 'Chosen by BIC').x).toEqual([0.2]);
    expect(s.x.title).toBe('Penalty level λ');
  });

  it('the power curves: the curve, the dot at the N and the .80 line', async () => {
    const pwr = {
      test: 't2',
      alpha: 0.05,
      power: 0.75,
      effect: 0.3,
      n: 120,
      curve: { n: [2, 100, 200, 363], power: [0.07, 0.68, 0.91, 0.99] },
    } as unknown as PwrResult;
    const a = await figureOf(<StdPowerCurve r={pwr} />);
    expect(kinds(a)).toEqual(['hline:Power .80', 'line:Power', 'point:N = 120.0: power 0.750']);
    expect(layer(a, 'Power')).toMatchObject({ color: POSITIVE_COLOR, y: [0.07, 0.68, 0.91, 0.99] });
    expect(a.y).toEqual({ title: 'Power', limits: [0, 1] });

    const sem = {
      analysis: 'apriori',
      alpha: 0.05,
      power: 0.951,
      n: 154,
      df: 200,
      fmin: 0.5,
      curve: { n: [10, 100, 154, 300], power: [0.1, 0.7, 0.951, 0.999] },
    } as unknown as Parameters<typeof PowerCurve>[0]['r'];
    const b = await figureOf(<PowerCurve r={sem} title="A priori" />);
    expect(kinds(b)).toEqual(['hline:Power .80', 'line:Power', 'point:N = 154: power 0.951']);
    expect(layer(b, 'N = 154: power 0.951')).toMatchObject({ x: [154], y: [0.951] });
  });

  it('the mediation sensitivity curve: band, effect, reference lines and the zero crossing', async () => {
    const s = await figureOf(
      <CurveChart
        id="medsens:acme"
        rho={[-0.5, 0, 0.5]}
        curve={{ est: [0.01, -0.016, -0.05], lo: [-0.01, -0.04, -0.09], hi: [0.03, 0.004, -0.01] }}
        zero={{ rho: -0.3, r2star: 0.09, r2tilde: 0.078 }}
        label="Indirect effect (ACME)"
        level={0.95}
      />,
    );
    expect(s.layers.map((l) => l.geom)).toEqual(['ribbon', 'hline', 'vline', 'vline', 'line']);
    expect(s.layers[0]).toMatchObject({ ymin: [-0.01, -0.04, -0.09], ymax: [0.03, 0.004, -0.01] });
    expect(s.layers[3]).toMatchObject({ linetype: 'dashed', x: [-0.3] });
    expect(s.layers.every((l) => !l.series)).toBe(true);
    expect(s.x).toEqual({ title: 'Sensitivity parameter ρ', limits: [-1, 1] });
  });

  it('a nonlinear path: the scores and the fitted curve', async () => {
    const eq = {
      to: 'Y',
      intercept: 0,
      terms: [
        { from: 'X', power: 1, b: 0.5 },
        { from: 'X', power: 2, b: 0.2 },
      ],
      r2: 0.3,
      r2Linear: 0.2,
      n: 3,
    } as unknown as NonlinearEquation;
    const path = {
      from: 'X',
      to: 'Y',
      shape: 'quadratic' as const,
      x: [-1, 0, 1],
      y: [-0.2, 0.1, 0.8],
    };
    const s = await figureOf(<Curve eq={eq} path={path} k={1} />);
    expect(s.layers.map((l) => l.geom)).toEqual(['point', 'line']);
    expect(s.layers[0]).toMatchObject({
      color: SERIES_COLORS[1],
      x: [-1, 0, 1],
      y: [-0.2, 0.1, 0.8],
    });
    expect(s.layers[1].y![0]).toBeCloseTo(-0.3, 12);
    expect(s.x.title).toBe('X (score)');
  });

  it('the SEMsens chart: significant and other evaluations, 0 and the model’s estimate', async () => {
    const r = {
      alpha: 0.05,
      interest: [{ from: 'x', to: 'y' }],
      phantoms: ['x', 'm', 'y'],
      summary: [{ from: 'x', to: 'y', values: [0.32, 0, 0.05, -0.45, 0.42] }],
      draws: {
        path: [{ from: 'x', to: 'y', est: [0.3, -0.4, 0.1], p: [0, 0.01, 0.2] }],
        phantom: [
          [0.1, -0.8, 0.5],
          [0.2, 0.3, 0.6],
          [0.1, -0.9, -0.3],
        ],
      },
    } as unknown as Parameters<typeof SemsensChart>[0]['r'];
    const s = await figureOf(<SemsensChart r={r} />);
    expect(kinds(s)).toEqual([
      'hline:',
      'hline:Model’s estimate (0.320)',
      'point:p < 0.050',
      'point:Not significant',
    ]);
    expect(layer(s, 'Not significant')).toMatchObject({ color: SERIES_COLORS[1], y: [0.1] });
    expect(layer(s, 'p < 0.050').y).toEqual([0.3, -0.4]);
    expect(s.x.title).toBe('Phantom → x × phantom → y');
  });
});
