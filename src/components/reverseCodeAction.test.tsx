// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { DataPanel } from './DataPanel';
import { DataWorkspace } from './DataViewer';
import { ConfirmModal } from './Overlays';
import { computeColumn } from '../data/compute';
import { parseScale, reverseCodeColumns } from './reverseCodeAction';

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

it('refuses a computed column with a toast pointing to reverse()', async () => {
  const { data, dataInfo } = useStore.getState();
  const c = computeColumn(data!, dataInfo!, 'total', 'sum(q1, q2)');
  useStore.getState().setData(c.data, c.info);
  expect(await reverseCodeColumns(['total'])).toBe(false);
  const toasts = useStore.getState().toasts;
  expect(toasts[toasts.length - 1]).toMatchObject({ kind: 'error' });
  expect(toasts[toasts.length - 1].text).toMatch(/computed column.*reverse\(\)/);
  expect(Array.from(useStore.getState().data!.cols[4])).toEqual(Array.from(c.data.cols[4]));
});

it('leaves Compute and Reverse-code to the Data panel (not repeated in the Data tab header)', () => {
  act(() => root.render(<DataWorkspace />));
  const labels = [...host.querySelectorAll('button')].map((b) => b.textContent ?? '');
  expect(labels.some((t) => t.includes('Compute'))).toBe(false);
  expect(labels.some((t) => t.includes('Reverse-code'))).toBe(false);
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

it('shows "Inspect" (which opens the Data tab) in the model editor only, not in the Data tab itself', () => {
  const inspect = () =>
    [...host.querySelectorAll('button')].some((b) => b.textContent?.includes('Inspect'));
  act(() => useStore.getState().setWorkspace('model'));
  act(() => root.render(<DataPanel />));
  expect(inspect()).toBe(true);
  act(() => useStore.getState().setWorkspace('data'));
  expect(inspect()).toBe(false);
});
