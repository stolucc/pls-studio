// @vitest-environment happy-dom
// The R status indicator follows useR: R starting (the background warm-up), packages loading, then "R environment
// ready" for good, a short error; hidden with the desktop helper, and when R has not been started (no warm-up, the
// built-in engine).

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompute } from '../rengine/compute';
import { R_STARTING, useR } from '../rengine/status';
import { RStatusPill, R_EXPLANATION, R_READY_EXPLANATION, shortError } from './RStatusPill';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  useR.setState({ status: 'idle', message: '', versions: {} });
  useCompute.setState({ backend: 'browser' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<RStatusPill />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const region = () => host.querySelector('[role="status"]')!;
const pill = () => host.querySelector('.r-pill');
const setR = (status: 'idle' | 'loading' | 'ready' | 'error', message = '') =>
  act(() => useR.setState({ status, message }));

describe('RStatusPill', () => {
  it('is an always-present polite live region, empty while R is not loading', () => {
    expect(region().getAttribute('aria-live')).toBe('polite');
    expect(region().textContent).toBe('');
    expect(pill()).toBeNull();
  });

  it('shows the warm-up, then the packages, then "R environment ready", which stays', () => {
    setR('loading', R_STARTING);
    expect(region().textContent).toBe('Loading R in your browser…');
    expect(pill()!.querySelector('.r-pill-spinner')).not.toBeNull();

    setR('loading', 'Loading R packages: lavaan…');
    expect(region().textContent).toBe('Loading R packages: lavaan…');

    setR('ready');
    expect(region().textContent).toBe('R environment ready');
    expect(pill()!.classList.contains('ready')).toBe(true);
    act(() => vi.advanceTimersByTime(60_000));
    expect(region().textContent).toBe('R environment ready');
  });

  it('says what is ready on hover', () => {
    setR('ready');
    act(() => pill()!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    const about = host.querySelector('.r-pill-about')!.textContent!;
    expect(about).toContain(R_READY_EXPLANATION);
    expect(about).toContain(R_EXPLANATION);
  });

  it('goes away when R is shut down (a fresh session starts it again)', () => {
    setR('ready');
    setR('idle');
    expect(pill()).toBeNull();
  });

  it('shows a short error without the stack trace, dismissible, with the explanation on click', () => {
    setR('error', 'Failed to fetch R.wasm. Check the connection.\n    at init (webr.mjs:1:2)');
    expect(region().textContent).toBe('R could not load');
    const main = pill()!.querySelector<HTMLButtonElement>('.r-pill-main')!;
    expect(main.getAttribute('aria-expanded')).toBe('false');
    act(() => main.click());
    expect(main.getAttribute('aria-expanded')).toBe('true');
    const about = host.querySelector('.r-pill-about')!.textContent!;
    expect(about).toContain('Failed to fetch R.wasm.');
    expect(about).not.toContain('Check the connection');
    expect(about).not.toContain('webr.mjs');
    expect(about).toContain(R_EXPLANATION);

    act(() => pill()!.querySelector<HTMLButtonElement>('.r-pill-close')!.click());
    expect(pill()).toBeNull();
    // A new attempt shows again.
    setR('loading', R_STARTING);
    expect(region().textContent).toBe(R_STARTING);
  });

  it('explains what is loading on hover', () => {
    setR('loading', R_STARTING);
    act(() => pill()!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(host.querySelector('.r-pill-about')?.textContent).toBe(R_EXPLANATION);
  });

  it('stays hidden when the desktop helper runs R', () => {
    act(() => useCompute.setState({ backend: 'helper' }));
    setR('loading', 'Loading R packages: lavaan…');
    expect(pill()).toBeNull();
    setR('error', 'boom');
    expect(pill()).toBeNull();
  });
});

describe('shortError', () => {
  it('keeps the first sentence of the first line, at most 160 characters', () => {
    expect(shortError('Network error. Retry later.')).toBe('Network error.');
    expect(shortError('Error: v0.6.0 broke\n  at x (y.js:1)')).toBe('Error: v0.6.0 broke');
    expect(shortError('x'.repeat(300))).toHaveLength(160);
  });
});
