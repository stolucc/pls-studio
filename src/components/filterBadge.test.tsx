// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { useStore } from '../store';
import { applyFilter, editFilter, FilterBadge } from './FilterBadge';
import { ConfirmModal } from './Overlays';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function type(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find(
    (b) => b.textContent === text || b.getAttribute('aria-label') === text,
  ) as HTMLButtonElement;

afterEach(() => useStore.getState().newProject());

it('sets a filter through the dialog, shows the cases kept, and removes it', async () => {
  useStore
    .getState()
    .setData(
      { names: ['age'], cols: [Float64Array.from([15, 20, 30, 12])] },
      { fileName: 'd.csv', rows: 4, missingCells: 0, excluded: [] },
    );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <>
        <FilterBadge />
        <ConfirmModal />
      </>,
    ),
  );
  expect(host.querySelector('.filter-badge')).toBeNull();
  let done: Promise<void> = Promise.resolve();
  act(() => {
    done = editFilter();
  });
  const input = host.querySelector('input') as HTMLInputElement;
  act(() => type(input, 'age >='));
  expect(button(host, 'Filter').disabled).toBe(true);
  act(() => type(input, 'age >= 18'));
  await act(async () => {
    button(host, 'Filter').click();
    await done;
  });
  expect(host.querySelector('.filter-badge')?.textContent).toContain('2 of 4 cases');
  expect(useStore.getState().data!.cols[0].length).toBe(2);
  act(() => button(host, 'Remove the filter').click());
  expect(host.querySelector('.filter-badge')).toBeNull();
  expect(useStore.getState().data!.cols[0].length).toBe(4);
  act(() => applyFilter('age < 0'));
  expect(host.querySelector('.filter-badge')).toBeNull();
  expect(useStore.getState().toasts.at(-1)?.text).toMatch(/would leave none/);
  act(() => root.unmount());
});
