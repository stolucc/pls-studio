// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useEscape } from './useEscape';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ onEscape, active }: { onEscape: () => void; active: boolean }) {
  useEscape(onEscape, active);
  return null;
}

it('closes on Escape only while active, before anything underneath sees the key', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const first = vi.fn(), latest = vi.fn(), below = vi.fn();
  document.addEventListener('keydown', below);
  const press = (key = 'Escape') => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

  act(() => root.render(<Probe onEscape={first} active={false} />));
  press();
  expect(first).not.toHaveBeenCalled();
  expect(below).toHaveBeenCalledTimes(1);

  act(() => root.render(<Probe onEscape={first} active />));
  press('Enter');
  expect(first).not.toHaveBeenCalled();
  // A new callback is used without re-subscribing.
  act(() => root.render(<Probe onEscape={latest} active />));
  press();
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
  expect(below).toHaveBeenCalledTimes(2); // the Enter only

  act(() => root.unmount());
  press();
  expect(latest).toHaveBeenCalledTimes(1);
  document.removeEventListener('keydown', below);
});
