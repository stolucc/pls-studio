// @vitest-environment happy-dom
// What the PLS result charts tell ggplot2 they draw (ChartFrame's figure, src/figure/ggplot.ts): the same marks
// from the same numbers, with the series names and colours of the chart's own legend.
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JohnsonNeyman } from '../engine/jn';
import { estimatePls } from '../engine/pls';
import type { FigureSpec, GgLayer } from '../figure/ggplot';
import * as format from '../format';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { makeSample } from '../sample';
import { useStore } from '../store';
import { JohnsonNeymanPlot } from './JohnsonNeymanPlot';
import { IpmaTab } from './results/IpmaTab';
import { QuadraticCurve, SimpleSlopes } from './SimpleSlopes';

const gg = vi.hoisted(() => ({
  file: vi.fn(async (_spec: unknown) => new Blob(['%PDF-'])),
  script: vi.fn(async () => ''),
}));
vi.mock('../figure/ggplot', () => ({ ggplotFile: gg.file, ggplotScript: gg.script }));

let host: HTMLDivElement;
afterEach(() => host?.remove());

/** Renders the element, asks the chart (the first, or the one whose SVG label starts with `label`) for its ggplot2 PDF. */
async function figureOf(el: ReactNode, label?: string): Promise<FigureSpec> {
  vi.spyOn(format, 'downloadBlob').mockImplementation(() => {});
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  const frame = label
    ? host.querySelector(`svg[aria-label^="${label}"]`)!.closest('figure')!
    : host.querySelector('figure')!;
  act(() =>
    (frame.querySelector('[title^="This chart drawn by ggplot2"]') as HTMLButtonElement).click(),
  );
  await act(async () => (frame.querySelector('[role="menuitem"]') as HTMLButtonElement).click());
  act(() => root.unmount());
  return gg.file.mock.calls.at(-1)![0] as FigureSpec;
}
const kinds = (s: FigureSpec) => s.layers.map((l) => `${l.geom}:${l.series ?? ''}`);
const layer = (s: FigureSpec, series: string) =>
  s.layers.find((l) => l.series === series) as GgLayer;

describe('result charts drawn by ggplot2', () => {
  it('simple slopes: one line per level of the moderator, and 0', async () => {
    const s = await figureOf(
      <SimpleSlopes bx={0.3} bm={0.1} bint={0.2} from="X" moderator="W" to="Y" />,
    );
    expect(kinds(s)).toEqual(['hline:', 'line:W −1 SD', 'line:W mean', 'line:W +1 SD']);
    // ŷ = 0.3 x + 0.1 m + 0.2 x m at m = +1: −0.4 at x = −1, 0.6 at x = +1
    expect(layer(s, 'W +1 SD')).toMatchObject({ color: '#5b21b6', x: [-1, 1] });
    expect(layer(s, 'W +1 SD').y![0]).toBeCloseTo(-0.4, 12);
    expect(layer(s, 'W +1 SD').y![1]).toBeCloseTo(0.6, 12);
    expect(s.x).toEqual({ title: 'X (SD)', limits: [-1, 1] });
    expect(s.y.title).toBe('Y (predicted, SD)');
  });

  it('a quadratic effect: the curve, its turning point and the three points', async () => {
    const s = await figureOf(<QuadraticCurve b={0.3} bq={-0.1} from="X" to="Y" />);
    expect(kinds(s)).toEqual([
      'hline:',
      'vline:',
      'line:Fitted curve',
      'point:X −1 SD',
      'point:X mean',
      'point:X +1 SD',
    ]);
    // (turning point −b / 2bq = 1.5, dotted)
    expect(s.layers[1].linetype).toBe('dotted');
    expect(s.layers[1].x![0]).toBeCloseTo(1.5, 12);
    expect(layer(s, 'Fitted curve').x).toHaveLength(81);
    expect(layer(s, 'X mean')).toMatchObject({ x: [0], y: [0] });
  });

  it('Johnson–Neyman: the significant stretch, the band, the effect and the boundary, in SD of the moderator', async () => {
    const effect = (m: number) => 0.2 + 0.3 * m;
    const jn = {
      sdM: 1,
      crit: 1.96,
      bx: 0.2,
      bint: 0.3,
      quadratic: false,
      effect,
      se: () => 0.1,
      significantAt: (m: number) => Math.abs(effect(m)) > 0.196,
      boundaries: [-0.0133],
    } as unknown as JohnsonNeyman;
    const s = await figureOf(<JohnsonNeymanPlot jn={jn} from="X" moderator="W" />);
    expect(kinds(s)).toEqual([
      'rect:Significant',
      'hline:',
      'ribbon:95% band',
      'line:Effect of X',
      'vline:Boundary',
    ]);
    // (significant below about −1.32 SD and above the boundary: two stretches, to the ends of the plot)
    const sig = layer(s, 'Significant');
    expect(sig.xmin).toHaveLength(2);
    expect(sig.xmin![0]).toBe(-3);
    expect(sig.xmax![1]).toBe(3);
    expect(layer(s, 'Effect of X').y![0]).toBeCloseTo(effect(-3), 12);
    expect(layer(s, '95% band').alpha).toBe(1);
    expect(layer(s, 'Boundary')).toMatchObject({ linetype: 'dashed', x: [-0.0133] });
    expect(s.x).toEqual({ title: 'W (SD)', limits: [-3, 3] });
  });

  it('IPMA: the constructs, the priority ones, the mean lines and the names', async () => {
    const { data, info, model } = makeSample(150, 3);
    useStore.setState((st) => ({
      data,
      info,
      model,
      settings: { ...DEFAULT_SETTINGS, ...st.settings, engine: 'builtin' },
    }));
    const pls = estimatePls(data, toSpec(model));
    const s = await figureOf(<IpmaTab pls={pls} />, 'Importance-performance map');
    expect(s.layers.slice(0, 2).map((l) => l.geom)).toEqual(['vline', 'hline']);
    const dots = s.layers.filter((l) => l.geom === 'point');
    const names = s.layers.find((l) => l.geom === 'text')!;
    expect(dots.map((l) => l.series)).toEqual(expect.arrayContaining(['Construct']));
    // (every construct once: as a dot of one kind or the other, and by name)
    expect(dots.reduce((a, l) => a + l.x!.length, 0)).toBe(names.label!.length);
    expect(s.y.title).toBe('Performance');
  });
});
