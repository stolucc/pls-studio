// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHART_STYLE } from '../figure/chartStyle';
import { PlotPanel } from '../figure/panel';
import * as format from '../format';
import { useStore } from '../store';
import { ChartFrame } from './ChartFrame';

const gg = vi.hoisted(() => ({
  file: vi.fn(async () => new Blob(['%PDF-'], { type: 'application/pdf' })),
  script: vi.fn(async () => 'library(ggplot2)'),
}));
vi.mock('../figure/ggplot', () => ({ ggplotFile: gg.file, ggplotScript: gg.script }));

let host: HTMLDivElement;
afterEach(() => host?.remove());

function render(theme: (typeof DEFAULT_CHART_STYLE)['theme']) {
  useStore.setState((s) => ({
    settings: { ...s.settings, charts: { ...DEFAULT_CHART_STYLE, theme } },
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <ChartFrame id="t" name="t" defaults={{ x: 'x', y: 'y' }} width={100} height={80}>
        {() => (
          <svg viewBox="0 0 100 80">
            <PlotPanel x={10} y={5} width={80} height={60} />
          </svg>
        )}
      </ChartFrame>,
    ),
  );
  return root;
}

describe('the chart theme', () => {
  it('marks the frame with the project’s theme, which styles the plot panel', () => {
    const root = render('grey');
    expect(host.querySelector('figure')!.getAttribute('data-chart-theme')).toBe('grey');
    expect(host.querySelector('rect.plot-panel')!.getAttribute('width')).toBe('80');
    // (the x and y axis lines theme_classic draws: down the left edge, along the bottom)
    expect(host.querySelector('path.plot-axes')!.getAttribute('d')).toBe('M 10 5 V 65 H 90');
    act(() => root.unmount());
  });

  it('offers the themes in the Style panel', () => {
    const root = render('app');
    act(() => (host.querySelector('[title^="Theme"]') as HTMLButtonElement).click());
    const options = [...host.querySelectorAll('.chart-style select')][1].querySelectorAll('option');
    expect([...options].map((o) => o.getAttribute('value'))).toEqual([
      'app',
      'grey',
      'bw',
      'minimal',
      'classic',
    ]);
    act(() => root.unmount());
  });

  it('offers ggplot2 for a chart that describes what it draws', async () => {
    useStore.setState((s) => ({
      settings: { ...s.settings, charts: { ...DEFAULT_CHART_STYLE, labels: { t: { x: 'Mine' } } } },
    }));
    const blob = vi.spyOn(format, 'downloadBlob').mockImplementation(() => {});
    const text = vi.spyOn(format, 'downloadText').mockImplementation(() => {});
    host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const figure = (labels: { x: string; y: string }) => ({
      title: 't',
      x: { title: labels.x },
      y: { title: labels.y },
      layers: [],
      width: 100,
      height: 80,
    });
    act(() =>
      root.render(
        <ChartFrame
          id="t"
          name="t"
          defaults={{ x: 'x', y: 'y' }}
          width={100}
          height={80}
          figure={figure}
        >
          {() => <svg />}
        </ChartFrame>,
      ),
    );
    act(() =>
      (host.querySelector('[title^="This chart drawn by ggplot2"]') as HTMLButtonElement).click(),
    );
    const items = [...host.querySelectorAll('[role="menuitem"]')];
    expect(items.map((b) => b.textContent)).toEqual([
      ' PDF (vector)',
      ' SVG (vector, desktop R)',
      ' PNG (300 dpi)',
      ' R script',
    ]);
    await act(async () => (items[0] as HTMLButtonElement).click());
    // (the axis title the user chose, and the project's chart style)
    expect(gg.file).toHaveBeenCalledWith(
      expect.objectContaining({ x: { title: 'Mine' }, y: { title: 'y' } }),
      expect.objectContaining({ theme: 'app' }),
      'pdf',
    );
    expect(blob).toHaveBeenCalledWith(expect.stringMatching(/-ggplot2\.pdf$/), expect.any(Blob));
    act(() =>
      (host.querySelector('[title^="This chart drawn by ggplot2"]') as HTMLButtonElement).click(),
    );
    await act(async () =>
      (host.querySelectorAll('[role="menuitem"]')[3] as HTMLButtonElement).click(),
    );
    expect(text).toHaveBeenCalledWith(expect.stringMatching(/-ggplot2\.R$/), 'library(ggplot2)');

    gg.file.mockRejectedValueOnce(new Error('no svglite'));
    const toast = vi.spyOn(useStore.getState(), 'toast');
    act(() =>
      (host.querySelector('[title^="This chart drawn by ggplot2"]') as HTMLButtonElement).click(),
    );
    await act(async () =>
      (host.querySelectorAll('[role="menuitem"]')[1] as HTMLButtonElement).click(),
    );
    expect(toast).toHaveBeenCalledWith('error', expect.stringContaining('no svglite'));
    act(() => root.unmount());
  });

  it('has no ggplot2 button without a description of the chart', () => {
    const root = render('app');
    expect(host.querySelector('[title^="This chart drawn by ggplot2"]')).toBeNull();
    act(() => root.unmount());
  });
});
