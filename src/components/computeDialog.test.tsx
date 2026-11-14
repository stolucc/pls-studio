// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { computeColumn, FUNCTIONS } from '../data/compute';
import { useStore } from '../store';
import { ComputeDialog } from './ComputeDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function type(el: HTMLInputElement, text: string, cursor = text.length) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, text);
    el.setSelectionRange(cursor, cursor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
/** Move the cursor with the arrow keys (the field notes where it is on key up). */
function moveCursor(el: HTMLInputElement, cursor: number) {
  act(() => {
    el.setSelectionRange(cursor, cursor);
    el.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', bubbles: true }));
  });
}
const byLabel = (host: HTMLElement, label: string) =>
  host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
const byText = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement;

let host: HTMLDivElement;
let root: Root;
let closed: boolean;
beforeEach(() => {
  useStore.getState().setData(
    {
      names: ['q1', 'q2', 'my var'],
      cols: [
        Float64Array.from([1, 2, 3, 4, 5, NaN]),
        Float64Array.from([2, 2, 4, 4, 1, 1]),
        Float64Array.from([10, 20, 30, 40, 50, 60]),
      ],
    },
    { fileName: 'd.csv', rows: 6, missingCells: 1, excluded: [] },
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  closed = false;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useStore.getState().newProject();
});

const open = (edit?: string) =>
  act(() => root.render(<ComputeDialog edit={edit} onClose={() => (closed = true)} />));
const formula = () => host.querySelector('#compute-formula') as HTMLInputElement;
const status = () => host.querySelector('#compute-status')!.textContent;

it('builds a formula with the pad, the columns and the functions, inserting at the cursor', () => {
  open();
  type(host.querySelector('#compute-name') as HTMLInputElement, 'q1r');
  act(() => byLabel(host, 'Insert reverse(): ' + FUNCTIONS.reverse.doc).click());
  expect(formula().value).toBe('reverse()');
  // The cursor is back in the field, between the parentheses.
  expect(document.activeElement).toBe(formula());
  expect(formula().selectionStart).toBe(8);
  act(() => byLabel(host, 'Insert the column q1').click());
  act(() => byLabel(host, 'comma, between the arguments of a function').click());
  act(() => byLabel(host, '1').click());
  act(() => byLabel(host, 'comma, between the arguments of a function').click());
  act(() => byLabel(host, '5').click());
  expect(formula().value).toBe('reverse(q1, 1, 5)');
  expect(status()).toBe('Preview: 5, 4, 3, 2, 1, … (6 rows, 1 missing)');
  act(() => byText(host, 'Add column').click());
  const s = useStore.getState();
  expect(closed).toBe(true);
  expect(Array.from(s.data!.cols[3])).toEqual([5, 4, 3, 2, 1, NaN]);
  expect(s.dataInfo!.computed).toEqual([{ name: 'q1r', expr: 'reverse(q1, 1, 5)' }]);
});

it('inserts at a cursor placed by typing, quotes names, and validates as the formula changes', () => {
  open();
  type(host.querySelector('#compute-name') as HTMLInputElement, 'total');
  type(formula(), 'q1 + ', 5);
  act(() => byLabel(host, 'Insert the column my var').click());
  expect(formula().value).toBe('q1 + `my var`');
  // Cursor after "q1": the operator goes there, spaced.
  moveCursor(formula(), 2);
  act(() => byLabel(host, 'times').click());
  expect(formula().value).toBe('q1 * + `my var`');
  expect(status()).toBe('Unexpected “+” in the formula.');
  expect(byText(host, 'Add column').disabled).toBe(true);
  act(() => byLabel(host, 'Backspace').click());
  // The operator goes with its space, so the formula is as it was.
  expect(formula().value).toBe('q1 + `my var`');
  act(() => byText(host, 'Clear').click());
  expect(formula().value).toBe('');
  expect(status()).toBe('Type a formula, or build it with the buttons below.');
});

it('offers every function with its doc, and symbols with spoken labels', () => {
  open();
  for (const [name, f] of Object.entries(FUNCTIONS)) {
    const button = byLabel(host, `Insert ${name}(): ${f.doc}`);
    expect(button.title).toBe(f.doc);
    expect(button.textContent).toBe(`${name}()${f.doc}`);
  }
  for (const label of ['divided by', 'times', 'minus', 'plus', 'not equal to', 'decimal point'])
    expect(byLabel(host, label).tagName).toBe('BUTTON');
  expect(byLabel(host, 'times').textContent).toBe('×');
  expect(byLabel(host, 'less than or equal to').title).toBe('less than or equal to: inserts <=');
});

it('names a problem with the column name and edits an existing formula', () => {
  open();
  type(host.querySelector('#compute-name') as HTMLInputElement, 'q1');
  expect(host.textContent).toContain('“q1” is already a column.');
  act(() => root.unmount());
  root = createRoot(host);
  const s = useStore.getState();
  const r = computeColumn(s.data!, s.dataInfo!, 'double', 'q1 * 2');
  s.setData(r.data, r.info);
  open('double');
  expect(formula().value).toBe('q1 * 2');
  // The column being edited is not offered (it cannot be computed from itself).
  expect(byLabel(host, 'Insert the column double')).toBeNull();
  act(() => byLabel(host, 'plus').click());
  act(() => byLabel(host, '1').click());
  expect(status()).toBe('Preview: 3, 5, 7, 9, 11, … (6 rows, 1 missing)');
  act(() => byText(host, 'Recompute').click());
  expect(Array.from(useStore.getState().data!.cols[3])).toEqual([3, 5, 7, 9, 11, NaN]);
});
