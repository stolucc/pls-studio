// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { useStore } from '../store';
import { RecodeDialog } from './RecodeDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function type(el: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value')!.set!.call(el, text);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;

afterEach(() => useStore.getState().newProject());

it('previews the formula and counts, then adds the recoded column with its labels', () => {
  useStore
    .getState()
    .setData(
      { names: ['score'], cols: [Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8])] },
      { fileName: 'd.csv', rows: 8, missingCells: 0, excluded: [] },
    );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let closed = false;
  act(() => root.render(<RecodeDialog column="score" onClose={() => (closed = true)} />));
  // Equal width, 4 bins over 1..8: cuts 2.75, 4.5, 6.25.
  expect(host.querySelector('.recode-formula')?.textContent).toBe(
    '1 + (score >= 2.75) + (score >= 4.5) + (score >= 6.25)',
  );
  act(() => button(host, 'Values').click());
  expect(button(host, 'Create column').disabled).toBe(true);
  const rules = host.querySelector('#recode-rules') as HTMLTextAreaElement;
  act(() => type(rules, '1 to 4 = 0 low\n5 to highest = 1 high'));
  const cells = [...host.querySelectorAll('.recode-preview td')].map((td) => td.textContent);
  expect(cells).toEqual(['0', 'low', '4', '1', 'high', '4']);
  act(() => type(host.querySelector('#recode-name') as HTMLInputElement, 'score'));
  expect(host.textContent).toContain('“score” is already a column.');
  act(() => type(host.querySelector('#recode-name') as HTMLInputElement, 'high'));
  act(() => button(host, 'Create column').click());
  const s = useStore.getState();
  expect(closed).toBe(true);
  expect(Array.from(s.data!.cols[1])).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  expect(s.dataInfo!.computed?.[0].name).toBe('high');
  expect(s.dataInfo!.variables).toEqual([
    {
      name: 'high',
      level: 'nominal',
      labels: [
        { value: 0, label: 'low' },
        { value: 1, label: 'high' },
      ],
    },
  ]);
  act(() => root.unmount());
});
