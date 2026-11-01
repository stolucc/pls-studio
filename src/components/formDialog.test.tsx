// @vitest-environment happy-dom
// A form dialog (Compute… in the data panel) opens without crashing: its fields'
// checks see text from the first render on, typing reaches the field, and OK
// resolves the trimmed values.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { ConfirmModal, formDialog } from './Overlays';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('opens, checks, takes typing and resolves the values', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => { createRoot(host).render(<ConfirmModal />); });
  const seen: unknown[] = [];
  let pending!: Promise<string[] | null>;
  act(() => {
    pending = formDialog({
      title: 'Add a computed column', confirmLabel: 'Add column',
      fields: [
        // (checks that call string methods, as the data panel's: undefined text would throw)
        { label: 'Column name', check: (t) => { seen.push(t); return /^[a-z_]+$/.test(t.trim()) ? null : 'A name.'; } },
        { label: 'Formula', initial: 'log(x)', check: (t, all) => (t.trim().length && all[0] !== undefined ? null : 'A formula.') },
      ],
    });
  });
  expect(host.querySelector('#dlg-f0')).toBeTruthy();
  expect((host.querySelector('#dlg-f1') as HTMLInputElement).value).toBe('log(x)');
  expect(seen.every((t) => typeof t === 'string')).toBe(true);
  const input = host.querySelector('#dlg-f0') as HTMLInputElement;
  act(() => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    set.call(input, ' newcol ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect((host.querySelector('#dlg-f0') as HTMLInputElement).value).toBe(' newcol ');
  const ok = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Add column')!;
  act(() => { ok.click(); });
  await expect(pending).resolves.toEqual(['newcol', 'log(x)']);
});
