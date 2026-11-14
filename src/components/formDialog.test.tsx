// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { ConfirmModal, confirmDialog, formDialog } from './Overlays';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** React's input value setter, so the change event reaches onChange as typing would. */
function type(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

it('refills a following field when the field it follows changes, and keeps edits otherwise', async () => {
  const held: Record<string, string> = { 1: 't1', 2: '0.5' };
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<ConfirmModal />));
  let result: Promise<string[] | null> = Promise.resolve(null);
  act(() => {
    result = formDialog({
      title: 'A threshold',
      body: '',
      confirmLabel: 'Apply',
      fields: [
        { label: 'Threshold', initial: '1', check: () => null },
        {
          label: 'Value or label',
          initial: held[1],
          check: () => null,
          follow: (all, changed) => (changed === 0 ? (held[all[0]] ?? '') : undefined),
        },
      ],
    });
  });
  const [n, v] = [...host.querySelectorAll('input')] as HTMLInputElement[];
  expect(v.value).toBe('t1');
  act(() => type(n, '2'));
  expect(v.value).toBe('0.5');
  act(() => type(n, '3'));
  expect(v.value).toBe('');
  act(() => type(v, 'lab'));
  expect(n.value).toBe('3');
  act(() =>
    (
      [...host.querySelectorAll('button')].find(
        (b) => b.textContent === 'Apply',
      )! as HTMLButtonElement
    ).click(),
  );
  expect(await result).toEqual(['3', 'lab']);
  act(() => root.unmount());
});

it('answers a dialog still open as cancelled when another one opens', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<ConfirmModal />));
  let first: Promise<boolean> = Promise.resolve(true);
  let second: Promise<boolean> = Promise.resolve(false);
  act(() => {
    first = confirmDialog({ title: 'First', body: '', confirmLabel: 'One' });
  });
  act(() => {
    second = confirmDialog({ title: 'Second', body: '', confirmLabel: 'Two' });
  });
  expect(await first).toBe(false);
  expect(host.querySelector('h3')?.textContent).toBe('Second');
  act(() =>
    (
      [...host.querySelectorAll('button')].find(
        (b) => b.textContent === 'Two',
      )! as HTMLButtonElement
    ).click(),
  );
  expect(await second).toBe(true);
  act(() => root.unmount());
});
