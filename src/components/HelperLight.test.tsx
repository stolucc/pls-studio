// @vitest-environment happy-dom
// The helper light follows useHelper: green when connected (tooltip with R, processes and GPU), grey when not
// running or not paired, amber when running but unusable; a click opens the helper panel with the connect controls.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHelper } from '../rengine/helper';
import { HelperLight, helperLight, helperSummary } from './HelperLight';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const checkHelper = vi.fn((_force?: boolean) => Promise.resolve('absent'));
vi.mock('../rengine/bridge', () => ({ checkHelper: (force?: boolean) => checkHelper(force) }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  useHelper.setState({ state: 'unknown', info: null, packages: {}, message: '' });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<HelperLight />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  checkHelper.mockClear();
});

const btn = () => host.querySelector('.helper-light-btn')!;

describe('HelperLight', () => {
  it('maps every state to a colour and a short text', () => {
    expect(helperLight('ready')).toEqual({ colour: 'green', text: 'Helper connected' });
    expect(helperLight('absent').colour).toBe('grey');
    expect(helperLight('unpaired').colour).toBe('grey');
    expect(helperLight('checking').colour).toBe('grey');
    expect(helperLight('no-r').colour).toBe('amber');
    expect(helperLight('mismatch').colour).toBe('amber');
  });
  it('probes the helper when it appears only in a browser paired before', async () => {
    await act(async () => {});
    expect(checkHelper).not.toHaveBeenCalled();
    act(() => root.unmount());
    localStorage.setItem('pls-studio.helper.token', 'a'.repeat(64));
    try {
      root = createRoot(host);
      act(() => root.render(<HelperLight />));
      // (the bridge is imported on demand: the probe follows a tick later)
      await vi.waitFor(() => expect(checkHelper).toHaveBeenCalledTimes(1));
      expect(checkHelper).toHaveBeenCalledWith(false);
    } finally {
      localStorage.removeItem('pls-studio.helper.token');
    }
  });
  it('shows grey while unknown, green with details when connected', () => {
    expect(btn().className).toContain('grey');
    expect(btn().textContent).toContain('Helper');
    act(() =>
      useHelper.setState({
        state: 'ready',
        info: {
          helperVersion: '0.1.18',
          r: 'R version 4.6.2 (2026-10-29)',
          workers: 13,
          gpu: {
            accelerators: [
              {
                where: 'local',
                device: 'mps',
                name: 'Apple GPU (Metal)',
                torch: '2.15',
                precisions: ['float32'],
              },
            ],
          },
        },
      }),
    );
    expect(btn().className).toContain('green');
    expect(btn().getAttribute('title')).toBe(
      'Helper connected: R 4.6.2, 13 R processes; GPU bootstrap: Apple GPU (Metal).',
    );
    expect(host.querySelector('.sr-only')!.textContent).toContain('Helper connected');
  });
  it('tells what is wrong in the tooltip when not connected', () => {
    act(() =>
      useHelper.setState({ state: 'unpaired', message: 'Connect this browser to the helper.' }),
    );
    expect(btn().getAttribute('title')).toBe('Connect this browser to the helper.');
    expect(helperSummary('absent', null, '')).toBe('Helper not running');
    expect(
      helperSummary('ready', { helperVersion: '', r: 'R version 4.5.0', workers: 1 }, ''),
    ).toBe('Helper connected: R 4.5.0, 1 R process; no GPU worker.');
  });
  it('opens the helper panel with the connect controls, closes on Escape', () => {
    act(() =>
      useHelper.setState({ state: 'unpaired', message: 'Connect this browser to the helper.' }),
    );
    act(() => btn().dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const pop = host.querySelector('[role="dialog"]')!;
    expect(pop.textContent).toContain('Helper not connected');
    expect(pop.querySelector('button')).not.toBeNull();
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
