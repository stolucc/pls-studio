// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { useStore } from '../store';
import { DataWorkspace } from './DataViewer';
import { ConfirmModal } from './Overlays';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function typeText(el: HTMLTextAreaElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find(
    (b) => b.textContent === text || b.getAttribute('aria-label') === text,
  ) as HTMLButtonElement;

afterEach(() => useStore.getState().newProject());

it('edits measurement levels and value labels in the Variables view, and shows labels in the rows', async () => {
  useStore
    .getState()
    .setData(
      { names: ['sex', 'x'], cols: [Float64Array.from([0, 1, 1]), Float64Array.from([1.5, 2, 3])] },
      { fileName: 'd.csv', rows: 3, missingCells: 0, excluded: [] },
    );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <>
        <DataWorkspace />
        <ConfirmModal />
      </>,
    ),
  );
  act(() => button(host, 'Variables').click());
  const level = host.querySelector(
    'select[aria-label="Measurement level of x"]',
  ) as HTMLSelectElement;
  expect(level.options[0].textContent).toBe('auto: scale');
  act(() => {
    level.value = 'ordinal';
    level.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(useStore.getState().dataInfo!.variables).toEqual([{ name: 'x', level: 'ordinal' }]);

  act(() => button(host, 'Edit the value labels of sex').click());
  const area = host.querySelector('textarea') as HTMLTextAreaElement;
  act(() => typeText(area, '0 = male\n1 = female'));
  await act(async () => {
    button(host, 'Save labels').click();
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(host.textContent).toContain('0 = male, 1 = female');
  act(() => button(host, 'Rows').click());
  expect([...host.querySelectorAll('.value-label')].map((e) => e.textContent?.trim())).toEqual([
    'male',
    'female',
    'female',
  ]);
  act(() => root.unmount());
});
