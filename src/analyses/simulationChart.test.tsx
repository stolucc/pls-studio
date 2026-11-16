// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DENSITY_POINTS, type McSummaryRow } from '../engine/montecarlo';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import type { FigureSpec } from '../figure/ggplot';
import * as format from '../format';
import { mcAnalysis as t } from './simulation';

const gg = vi.hoisted(() => ({
  file: vi.fn(async (_spec: unknown) => new Blob(['%PDF-'])),
  script: vi.fn(async () => ''),
}));
vi.mock('../figure/ggplot', () => ({ ggplotFile: gg.file, ggplotScript: gg.script }));

// The distribution chart draws a kernel density by default (as published simulation figures do) and
// switches to the histogram's bins; results saved before the density was added keep the histogram.

const K = (id: string, inds: string[]) => ({
  id,
  name: id,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: inds,
  x: 0,
  y: 0,
  side: 'left' as const,
});
const model: ModelState = {
  constructs: [K('A', ['a1', 'a2', 'a3']), K('B', ['b1', 'b2', 'b3'])],
  paths: [{ id: 'p', from: 'A', to: 'B' }],
  moderations: [],
};
const d = t.defaults({
  data: null,
  info: null,
  settings: DEFAULT_SETTINGS,
  pls: null,
  projectName: 'p',
  model,
});
const path = { key: 'path:A:B', kind: 'path' as const, from: 'A', to: 'B', value: 0 };
const counts = Array.from({ length: 40 }, (_, b) => (b === 10 || b === 30 ? 20 : 0));
const density = Array.from({ length: DENSITY_POINTS }, (_, i) => Math.exp(-(((i - 50) / 10) ** 2)));
const row = (estimator: string, withDensity: boolean): McSummaryRow => ({
  estimator,
  n: 100,
  param: path,
  reps: 40,
  failed: 0,
  improper: 0,
  mean: 0,
  bias: 0,
  relBias: null,
  sd: 0.1,
  rmse: 0.1,
  coverage: null,
  width: null,
  rejection: 0.2,
  hist: { lo: -0.4, hi: 0.4, counts, below: 0, above: 0, ...(withDensity ? { density } : {}) },
});

let host: HTMLDivElement;
afterEach(() => host?.remove());

function render(withDensity: boolean) {
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const result = d.estimators.map((e) => row(e.id, withDensity));
  act(() => root.render(<t.View result={result} options={d} current />));
  return root;
}
const chart = () =>
  host.querySelector('svg[aria-label="Distribution of the estimates at N = 100"]')!;
const hits = () => chart().querySelectorAll('.mc-hit');

describe('the distribution chart', () => {
  it('draws the density by default, with a hover per point, and switches to the histogram', () => {
    const root = render(true);
    const radios = [
      ...host.querySelectorAll('[aria-label="Shape of the distribution"] [role="radio"]'),
    ];
    expect(radios.map((b) => b.textContent)).toEqual(['Density', 'Histogram']);
    expect(radios[0].getAttribute('aria-checked')).toBe('true');
    expect(hits()).toHaveLength(DENSITY_POINTS);
    expect(chart().textContent).toContain('Density');
    expect(hits()[50].textContent).toContain('density 1');

    act(() => (radios[1] as HTMLButtonElement).click());
    expect(hits()).toHaveLength(40);
    expect(chart().textContent).toContain('Share of replications');
    act(() => root.unmount());
  });

  it('keeps the histogram, without the switch, for results saved before the density', () => {
    const root = render(false);
    expect(host.querySelector('[aria-label="Shape of the distribution"]')).toBeNull();
    expect(hits()).toHaveLength(40);
    act(() => root.unmount());
  });

  it('describes itself to ggplot2: each estimator’s density and the true value', async () => {
    vi.spyOn(format, 'downloadBlob').mockImplementation(() => {});
    const root = render(true);
    const frame = chart().closest('figure')!;
    act(() =>
      (frame.querySelector('[title^="This chart drawn by ggplot2"]') as HTMLButtonElement).click(),
    );
    await act(async () => (frame.querySelector('[role="menuitem"]') as HTMLButtonElement).click());
    const spec = gg.file.mock.calls.at(-1)![0] as FigureSpec;
    expect(spec.title).toBe('Distribution of the estimates at N = 100');
    expect(spec.x).toEqual({ title: 'Estimate', limits: [-0.4, 0.4] });
    const lines = spec.layers.filter((l) => l.geom === 'line');
    expect(lines.map((l) => l.series)).toEqual(d.estimators.map((e) => e.id));
    expect(lines[0].x).toHaveLength(DENSITY_POINTS);
    expect(lines[0].y![50]).toBe(1);
    expect(spec.layers.at(-1)).toMatchObject({ geom: 'vline', series: 'True value', x: [0] });
    act(() => root.unmount());
  });
});
