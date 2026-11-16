// @vitest-environment happy-dom
// How long a Monte Carlo simulation takes, and the offer to switch to the built-in engine when R would take long.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { McDesign } from '../engine/montecarlo';
import { useCompute } from '../rengine/compute';
import { useHelper } from '../rengine/helper';
import { useStore } from '../store';
import { McDuration, mcSeconds, roughDuration } from './simulation';

// Rönkkö & Evermann's card: 500 replications at N = 100, two PLS estimators with 500 bootstrap samples.
const card = {
  population: { constructs: [], paths: [], exoCor: [] },
  estimators: [
    { id: 'PLS mode A, centroid', method: 'pls', consistent: false, mode: 'A', scheme: 'centroid' },
    { id: 'PLS mode B, centroid', method: 'pls', consistent: false, mode: 'B', scheme: 'centroid' },
    { id: 'Sum scores', method: 'regression', dr: false },
    { id: 'CB-ML', method: 'cb', estimator: 'ML' },
  ],
  sampleSizes: [100],
  replications: 500,
  seed: 2013,
  alpha: 0.05,
  bootSamples: 500,
  mcDraws: 0,
} as McDesign;

describe('the duration of a simulation', () => {
  it('counts every bootstrap estimation at its speed, over the parallel sessions', () => {
    // (desktop R: 500 × (2 × 501 × 4.5 ms + 15 ms + 50 ms) on 11 sessions, about 3.5 minutes)
    expect(mcSeconds(card, 'desktop', 11)).toBeCloseTo((500 * (2 * 501 * 4.5 + 65)) / 1000 / 11, 6);
    expect(mcSeconds(card, 'browser', 1)).toBeCloseTo(3 * mcSeconds(card, 'desktop', 1), 6);
    expect(mcSeconds(card, 'builtin', 8)).toBeLessThan(mcSeconds(card, 'desktop', 8) / 20);
    expect(mcSeconds({ ...card, bootSamples: 0 }, 'desktop', 1)).toBeCloseTo(
      (500 * (2 * 4.5 + 65)) / 1000,
      6,
    );
  });

  it('reads as seconds, minutes, or hours and minutes', () => {
    expect(roughDuration(0.2)).toBe('1 s');
    expect(roughDuration(42)).toBe('42 s');
    expect(roughDuration(213)).toBe('4 min');
    expect(roughDuration(4 * 3600 + 20 * 60)).toBe('4 h 20 min');
  });
});

let host: HTMLDivElement;
afterEach(() => host?.remove());
function render(design: McDesign, engine: 'r' | 'builtin') {
  host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<McDuration design={design} engine={engine} />));
  return root;
}

describe('the duration hint', () => {
  it('offers the built-in engine for a long run in R, which switches the project’s engine', () => {
    useCompute.setState({ backend: 'helper', workers: 2 });
    useHelper.setState({
      state: 'ready',
      info: { helperVersion: '0.1.14', r: '4.6.0', workers: 11 },
    });
    useStore.setState((s) => ({ settings: { ...s.settings, engine: 'r' } }));
    const root = render(card, 'r');
    expect(host.textContent).toContain('desktop R through the helper, 11 sessions at once');
    expect(host.textContent).toContain('roughly 3 min');
    const button = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Use the built-in engine'),
    )!;
    act(() => button.click());
    expect(useStore.getState().settings.engine).toBe('builtin');
    act(() => root.unmount());
  });

  it('makes no offer for a short run, and says where R runs', () => {
    useCompute.setState({ backend: 'browser', workers: 4 });
    const root = render({ ...card, bootSamples: 0, replications: 50 }, 'r');
    expect(host.textContent).toContain('R in this browser, 4 sessions at once');
    expect(host.textContent).not.toContain('Use the built-in engine');
    act(() => root.unmount());
  });

  it('gives the built-in engine’s cores and time', () => {
    const root = render(card, 'builtin');
    expect(host.textContent).toMatch(/model estimations on \d+ cores \(built-in engine\): roughly/);
    act(() => root.unmount());
  });
});
