// @vitest-environment happy-dom
// The key of each chart with more than one colour is inside its SVG (src/figure/legend.tsx), so an exported
// figure keeps it, and every chart draws the plot panel the chart themes style (src/figure/panel.tsx).
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { BFCurve } from '../analyses/bayes';
import type { JohnsonNeyman } from '../engine/jn';
import { estimatePls } from '../engine/pls';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { makeSample } from '../sample';
import { useStore } from '../store';
import { JohnsonNeymanPlot } from './JohnsonNeymanPlot';
import { IpmaTab } from './results/IpmaTab';
import { QuadraticCurve, SimpleSlopes } from './SimpleSlopes';

let host: HTMLDivElement;
afterEach(() => host?.remove());

/** Renders the element; the SVG whose aria-label starts with `label`, with its legend's labels. */
function chart(el: ReactNode, label: string) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(el));
  const svg = host.querySelector(`svg[aria-label^="${label}"]`)!;
  const keys = [...svg.querySelectorAll('.chart-legend text')].map((t) => t.textContent);
  return { svg, keys, unmount: () => act(() => root.unmount()) };
}

describe('the keys of the charts', () => {
  it('simple slopes: one line per level of the moderator', () => {
    const c = chart(
      <SimpleSlopes bx={0.3} bm={0.1} bint={0.2} from="X" moderator="W" to="Y" />,
      'Simple slopes',
    );
    expect(c.keys).toEqual(['W −1 SD', 'W mean', 'W +1 SD']);
    expect(c.svg.querySelector('.plot-panel')).not.toBeNull();
    // (the caption keeps the slopes, without colour swatches)
    expect(host.querySelector('figcaption')!.textContent).toContain('W mean: slope 0.300');
    c.unmount();
  });

  it('a quadratic effect: the curve and the three points', () => {
    const c = chart(<QuadraticCurve b={0.3} bq={-0.1} from="X" to="Y" />, 'Quadratic effect');
    expect(c.keys).toEqual(['Fitted curve', 'X −1 SD', 'X mean', 'X +1 SD']);
    expect(c.svg.querySelector('.chart-legend circle')).not.toBeNull();
    expect(c.svg.querySelector('.plot-panel')).not.toBeNull();
    c.unmount();
  });

  it('Johnson–Neyman: the effect, its band, the significant stretch and the boundary', () => {
    const effect = (m: number) => 0.2 + 0.3 * m;
    const jn: JohnsonNeyman = {
      sdM: 1,
      crit: 1.96,
      bx: 0.2,
      bint: 0.3,
      quadratic: false,
      effect,
      se: () => 0.1,
      boundaries: [-0.013],
      significantAt: (m) => Math.abs(effect(m)) > 0.196,
    };
    const c = chart(<JohnsonNeymanPlot jn={jn} from="X" moderator="W" />, 'Johnson-Neyman');
    expect(c.keys).toEqual(['Effect of X', '95% band', 'Significant', 'Boundary']);
    expect(c.svg.querySelector('.plot-panel')).not.toBeNull();
    c.unmount();
  });

  it('IPMA: the constructs and the priorities', () => {
    const { data, info, model } = makeSample(150, 3);
    useStore.setState((s) => ({
      data,
      info,
      model,
      settings: { ...DEFAULT_SETTINGS, ...s.settings, engine: 'builtin' },
    }));
    const pls = estimatePls(data, toSpec(model));
    const c = chart(<IpmaTab pls={pls} />, 'Importance-performance map');
    expect(c.keys).toEqual([
      'Construct',
      'Priority: above-mean importance, below-mean performance',
    ]);
    expect(c.svg.querySelector('.plot-panel')).not.toBeNull();
    c.unmount();
  });

  it('a Bayes factor curve: one colour, a plot panel and no key', () => {
    const c = chart(
      <BFCurve id="bf" x={[1, 2, 3]} y={[0.5, 2, 6]} xLabel="n" title="Sequential" />,
      'Sequential',
    );
    expect(c.keys).toEqual([]);
    expect(c.svg.querySelector('.plot-panel')).not.toBeNull();
    c.unmount();
  });
});
