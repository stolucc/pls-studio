// @vitest-environment happy-dom
// The report and replication dialogs use the shared dialog stack (useEscape)
// and useModal: Escape closes only the topmost dialog, the focus goes back to
// the button that opened it, and a dialog underneath never sees the same key.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../store';
import { ConfirmModal, confirmDialog } from '../Overlays';
import { useEscape } from '../useEscape';
import { ReplicationDialog, useReplication } from './ReplicationDialog';
import { ReportDialog, useReportDialog } from './ReportDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A package build that never finishes, so the dialog stays busy.
vi.mock('../../replication/package', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../replication/package')>();
  return {
    ...real,
    packageItems: () => [{ id: 'model', title: 'The model', detail: 'PLS-SEM', scriptable: true }],
    createPackage: (_chosen: unknown, _opts: unknown, setBusy: (s: string) => void) => {
      setBusy('Building…');
      return new Promise(() => {});
    },
  };
});

let host: HTMLDivElement;
let root: Root;

function press() {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
}

/** A button that has the focus when a dialog opens, as the real opener would. */
function focusOpener(): HTMLButtonElement {
  const opener = document.createElement('button');
  opener.textContent = 'Open';
  document.body.append(opener);
  opener.focus();
  return opener;
}

beforeEach(() => {
  useStore.getState().newProject();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
  useReportDialog.setState({ open: false });
  useReplication.setState({ open: false });
});

const DIALOGS = [
  {
    name: 'report',
    Dialog: ReportDialog,
    store: useReportDialog,
    title: 'Export report',
  },
  {
    name: 'replication',
    Dialog: ReplicationDialog,
    store: useReplication,
    title: 'Create replication package',
  },
];

describe.each(DIALOGS)('the $name dialog and Escape', ({ Dialog, store, title }) => {
  it('closes on Escape and gives the focus back to its opener', () => {
    const opener = focusOpener();
    act(() => root.render(<Dialog />));
    act(() => store.setState({ open: true }));
    expect(host.textContent).toContain(title);
    expect(document.activeElement).not.toBe(opener);
    press();
    expect(store.getState().open).toBe(false);
    expect(host.textContent).toBe('');
    expect(document.activeElement).toBe(opener);
  });

  it('closes only a confirmation opened on top of it, then itself', async () => {
    const opener = focusOpener();
    act(() =>
      root.render(
        <>
          <Dialog />
          <ConfirmModal />
        </>,
      ),
    );
    act(() => store.setState({ open: true }));
    let answer: Promise<boolean> = Promise.resolve(true);
    act(() => {
      answer = confirmDialog({ title: 'Sure?', body: 'Really.' });
    });
    expect(host.textContent).toContain('Sure?');
    press();
    expect(await answer).toBe(false);
    expect(host.textContent).not.toContain('Sure?');
    expect(store.getState().open).toBe(true);
    press();
    expect(store.getState().open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('takes the key from a dialog underneath it, which stays open', () => {
    const below = vi.fn();
    function Underneath() {
      useEscape(below);
      return null;
    }
    act(() =>
      root.render(
        <>
          <Underneath />
          <Dialog />
        </>,
      ),
    );
    act(() => store.setState({ open: true }));
    press();
    expect(store.getState().open).toBe(false);
    expect(below).not.toHaveBeenCalled();
    press();
    expect(below).toHaveBeenCalledTimes(1);
  });
});

it('the replication dialog ignores Escape while the package is being built', async () => {
  act(() => root.render(<ReplicationDialog />));
  act(() => useReplication.setState({ open: true }));
  const create = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Create zip',
  ) as HTMLButtonElement;
  await act(async () => {
    create.click();
  });
  expect(host.textContent).toContain('Building…');
  press();
  expect(useReplication.getState().open).toBe(true);
});
