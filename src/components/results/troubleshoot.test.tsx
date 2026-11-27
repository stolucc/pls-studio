// @vitest-environment happy-dom
// The Troubleshoot tab of the results panel (Troubleshoot.tsx): shown for CB-SEM only, with the number of
// findings, and listing the checks with the likely causes first; it needs no result.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Dataset } from '../../engine/types';
import type { Construct } from '../../model/project';
import { useStore } from '../../store';
import { ResultsPanel } from '../ResultsPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const C = (id: string, indicators: string[]): Construct => ({
  id,
  name: id,
  type: 'factor',
  mode: 'A',
  indicators,
  x: 0,
  y: 0,
  side: 'left',
});

/** Three indicators of one factor, x3 a copy of x1, n = 200. */
function data(): Dataset {
  let s = 3;
  const u = () => ((s = (s * 1664525 + 1013904223) % 4294967296) + 0.5) / 4294967296;
  const f = Array.from({ length: 200 }, () => u() - 0.5);
  const x1 = Float64Array.from(f, (v) => v + 0.5 * (u() - 0.5));
  const x2 = Float64Array.from(f, (v) => v + 0.5 * (u() - 0.5));
  return { names: ['x1', 'x2', 'x3'], cols: [x1, x2, x1.slice()] };
}

function seed(method: 'cbsem' | 'pls') {
  useStore.getState().newProject();
  useStore.setState((x) => ({
    resultsOpen: true,
    data: data(),
    settings: { ...x.settings, method, estimator: 'ML', missing: 'casewise' },
    model: { ...x.model, constructs: [C('F', ['x1', 'x2', 'x3'])] },
  }));
}

function mount() {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(<ResultsPanel height={400} onResize={() => {}} />));
  return { host, unmount: () => act(() => root.unmount()) };
}

describe('the Troubleshoot tab', () => {
  beforeEach(() => seed('cbsem'));

  it('is a results tab for CB-SEM with its number of findings, and lists the likely causes first, before any result', () => {
    const { host, unmount } = mount();
    const tab = host.querySelector<HTMLButtonElement>('[data-tour="results-tab-troubleshoot"]')!;
    expect(tab.textContent).toMatch(/^Troubleshoot \(\d+\)$/);
    act(() => tab.click());
    expect(tab.getAttribute('aria-selected')).toBe('true');
    expect(host.textContent).toContain('There is no result for this model yet');
    const items = [...host.querySelectorAll('.trouble-check')];
    expect(items[0].className).toContain('problem');
    const collinear = host.querySelector('[data-testid="trouble-collinearity"]')!;
    expect(collinear.textContent).toContain('not positive definite');
    expect(collinear.textContent).toContain('x3');
    expect(collinear.textContent).toContain('What to try:');
    // (the checks that found nothing are folded away, behind one line naming them)
    const quiet = host.querySelector<HTMLDetailsElement>('[data-testid="trouble-quiet"]')!;
    expect(quiet.open).toBe(false);
    expect(quiet.querySelector('summary')!.textContent).toMatch(/^\d+ checks? found nothing: /);
    expect(quiet.querySelector('[data-testid="trouble-collinearity"]')).toBeNull();
    expect(
      quiet.querySelector('[data-testid="trouble-missing"], [data-testid="trouble-coverage"]'),
    ).not.toBeNull();
    unmount();
  });

  it('is not offered for PLS-SEM', () => {
    seed('pls');
    const { host, unmount } = mount();
    expect(host.querySelector('[data-tour="results-tab-troubleshoot"]')).toBeNull();
    unmount();
  });
});
