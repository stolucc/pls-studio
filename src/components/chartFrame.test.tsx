// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CHART_STYLE } from '../figure/chartStyle';
import { PlotPanel } from '../figure/panel';
import { useStore } from '../store';
import { ChartFrame } from './ChartFrame';

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
});
