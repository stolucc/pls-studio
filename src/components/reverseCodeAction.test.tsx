// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { DataPanel } from './DataPanel';
import { DataWorkspace } from './DataViewer';
import { ConfirmModal } from './Overlays';
import { parseScale, reversibleColumns } from './reverseCodeAction';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const byText = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;
const flush = () => act(async () => await Promise.resolve());

describe('parseScale', () => {
  it('reads the lowest and highest value of a scale', () => {
    expect(parseScale('1, 5')).toEqual([1, 5]);
    expect(parseScale('1-7')).toEqual([1, 7]);
    expect(parseScale('0 4')).toEqual([0, 4]);
    expect(parseScale('5, 1')).toBeNull();
    expect(parseScale('1')).toBeNull();
    expect(parseScale('a, b')).toBeNull();
  });
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  useStore.getState().setData(
    {
      names: ['q1', 'q2', 'q3', 'city'],
      cols: [
        Float64Array.from([1, 2, 5, NaN]),
        Float64Array.from([4, 2, 1, 5]),
        Float64Array.from([3, 3, 3, 3]),
        Float64Array.from([1, 2, 1, 2]),
      ],
      categories: { city: ['Cork', 'Galway'] },
    },
    { fileName: 'likert.csv', rows: 4, missingCells: 1, excluded: [] },
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useStore.getState().newProject();
});

it('offers only numeric columns', () => {
  expect(reversibleColumns()).toEqual(['q1', 'q2', 'q3']);
});

it('reverse-codes from the Data tab: choose the items, then confirm the observed scale', async () => {
  useStore.getState().setSelectedVars(['q1']);
  act(() =>
    root.render(
      <>
        <DataWorkspace />
        <ConfirmModal />
      </>,
    ),
  );
  act(() => byText(host, '⇅ Reverse-code…').click());
  const dialog = host.querySelector('.reverse-pick')!;
  expect(dialog.textContent).toContain('1 becomes 5');
  // The item selected in the variable list is chosen; text columns are not offered.
  const boxes = [...dialog.querySelectorAll('label.var-check')];
  expect(boxes.map((b) => b.textContent)).toEqual(['q1', 'q2', 'q3']);
  expect((boxes[0].querySelector('input') as HTMLInputElement).checked).toBe(true);
  act(() => byText(dialog as HTMLElement, 'All').click());
  act(() => byText(host, 'Next: answer scale…').click());
  expect(host.querySelector('.reverse-pick')).toBeNull();
  // The model editor's scale dialog, with the observed range of the items.
  expect(host.querySelector('#dlg-title')!.textContent).toBe('Reverse-code 3 items?');
  expect((host.querySelector('#dlg-text') as HTMLInputElement).value).toBe('1, 5');
  act(() => byText(host, 'Reverse-code').click());
  await flush();
  const s = useStore.getState();
  expect(Array.from(s.data!.cols[0])).toEqual([5, 4, 1, NaN]);
  expect(Array.from(s.data!.cols[1])).toEqual([2, 4, 5, 1]);
  expect(s.dataInfo!.reversed).toEqual([
    { name: 'q1', min: 1, max: 5 },
    { name: 'q2', min: 1, max: 5 },
    { name: 'q3', min: 1, max: 5 },
  ]);
  expect(s.toasts.at(-1)?.text).toBe('Reverse-coded q1, q2, q3 (1–5).');
});

it('opens the formula builder from the Data tab', () => {
  act(() => root.render(<DataWorkspace />));
  act(() => byText(host, 'ƒ Compute…').click());
  expect(host.querySelector('#compute-title')!.textContent).toBe('Add a computed column');
});

it('the model editor’s button uses the same dialog, and offers to undo', async () => {
  const s = useStore.getState();
  act(() =>
    root.render(
      <>
        <DataPanel />
        <ConfirmModal />
      </>,
    ),
  );
  act(() => s.setSelectedVars(['q2']));
  act(() => byText(host, 'Reverse-code…').click());
  expect(host.querySelector('#dlg-title')!.textContent).toBe('Reverse-code q2?');
  act(() => byText(host, 'Reverse-code').click());
  await flush();
  expect(Array.from(useStore.getState().data!.cols[1])).toEqual([2, 4, 5, 1]);
  act(() => s.setSelectedVars(['q2']));
  act(() => byText(host, 'Reverse-code…').click());
  expect(host.querySelector('#dlg-title')!.textContent).toBe('Undo the reverse-coding of q2?');
  act(() => byText(host, 'Undo').click());
  await flush();
  expect(Array.from(useStore.getState().data!.cols[1])).toEqual([4, 2, 1, 5]);
  expect(useStore.getState().dataInfo!.reversed).toBeUndefined();
});
