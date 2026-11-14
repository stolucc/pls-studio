// @vitest-environment happy-dom
// Modal dialogs: the first control takes the focus (a text box too), Tab stays
// inside, the page behind is inert while open, and the focus returns to the
// opener on closing.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { ConfirmModal, formDialog } from './Overlays';
import { useModal } from './useModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tab = (shift = false) =>
  act(() => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true }),
    );
  });

it('focuses a multiline first field, traps Tab, makes the page inert and restores the focus', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <>
        <main>
          <button>Import syntax</button>
        </main>
        <ConfirmModal />
      </>,
    ),
  );
  const opener = host.querySelector('main button') as HTMLButtonElement;
  opener.focus();
  let result: Promise<string[] | null> = Promise.resolve(null);
  act(() => {
    result = formDialog({
      title: 'Import model syntax',
      body: '',
      confirmLabel: 'Build',
      fields: [{ label: 'Syntax', multiline: true, check: () => null }],
    });
  });
  const area = host.querySelector('textarea');
  expect(document.activeElement).toBe(area);
  expect(host.querySelector('main')!.hasAttribute('inert')).toBe(true);
  expect(host.querySelector('.modal-backdrop')!.closest('[inert]')).toBeNull();

  // Tab from the last button wraps to the first control, Shift+Tab from the first to the last.
  const buttons = [...host.querySelectorAll('.modal button')] as HTMLButtonElement[];
  const cancel = buttons.find((b) => b.textContent === 'Cancel')!;
  cancel.focus();
  tab();
  expect(document.activeElement).toBe(area);
  tab(true);
  expect(document.activeElement).toBe(cancel);

  act(() => cancel.click());
  expect(await result).toBeNull();
  expect(host.querySelector('main')!.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(opener);
  act(() => root.unmount());
  host.remove();
});

it('a dialog that focuses a control itself keeps that focus, and the opener gets it back', () => {
  function Dialog() {
    const ref = useModal();
    return (
      <div ref={ref}>
        <button>Close</button>
        <input aria-label="Name" autoFocus />
      </div>
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<button>Open</button>));
  const opener = host.querySelector('button') as HTMLButtonElement;
  opener.focus();
  act(() =>
    root.render(
      <>
        <button>Open</button>
        <Dialog />
      </>,
    ),
  );
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Name');
  act(() => root.render(<button>Open</button>));
  expect(document.activeElement).toBe(host.querySelector('button'));
  act(() => root.unmount());
  host.remove();
});
