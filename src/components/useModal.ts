import { useEffect, useRef } from 'react';

// Keyboard and screen-reader behaviour of a modal dialog (WAI-ARIA dialog
// pattern): when it opens, the first form control (or else the first button)
// takes the focus unless the dialog has already focused something; Tab and
// Shift+Tab stay inside it; the rest of the page is inert (neither clickable
// nor focusable nor read out) while it is open; and when it closes, the focus
// goes back to where it was (the button that opened it).

const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), ' +
  'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const FIELDS =
  'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])';

// The element that last lost the focus: the opener of a dialog that focused
// one of its own controls on mounting (autoFocus) before useModal's effect ran.
let lastBlurred: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusout',
    (e) => {
      if (e.target instanceof HTMLElement) lastBlurred = e.target;
    },
    true,
  );
}

/** Where the focus was before the dialog opened. */
function openerOf(dialog: HTMLElement): HTMLElement | null {
  const at = document.activeElement;
  if (at instanceof HTMLElement && !dialog.contains(at)) return at;
  if (lastBlurred && !dialog.contains(lastBlurred)) return lastBlurred;
  return null;
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[inert]'));
}

/**
 * Makes everything outside `keep` inert: the siblings of `keep` and of each of
 * its ancestors up to <body>. Elements already inert, and live regions (the
 * toasts), are left as they are. Returns the function that undoes it.
 */
function inertOutside(keep: HTMLElement): () => void {
  const changed: Element[] = [];
  for (let el: HTMLElement | null = keep; el && el !== document.body; el = el.parentElement) {
    const parent: HTMLElement | null = el.parentElement;
    if (!parent) break;
    for (const sibling of Array.from(parent.children) as Element[]) {
      if (sibling === el || sibling.hasAttribute('inert') || sibling.hasAttribute('aria-live'))
        continue;
      if (sibling.tagName === 'SCRIPT' || sibling.tagName === 'STYLE') continue;
      sibling.setAttribute('inert', '');
      changed.push(sibling);
    }
  }
  return () => {
    for (const el of changed) el.removeAttribute('inert');
  };
}

/**
 * Modal behaviour for the dialog element the returned ref is put on, while
 * `active` (a dialog that is mounted only while open can leave it true).
 * The ref goes on the backdrop or the dialog itself: whatever wraps the
 * dialog's controls.
 */
export function useModal<T extends HTMLElement = HTMLDivElement>(active = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!active || !dialog) return;
    const opener = openerOf(dialog);
    const restoreInert = inertOutside(dialog);

    if (!dialog.contains(document.activeElement)) {
      const first = dialog.querySelector<HTMLElement>(FIELDS) ?? focusables(dialog)[0];
      first?.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const all = focusables(dialog);
      if (all.length === 0) {
        e.preventDefault();
        return;
      }
      const first = all[0];
      const last = all[all.length - 1];
      const at = document.activeElement;
      if (e.shiftKey && (at === first || !dialog.contains(at))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === last || !dialog.contains(at))) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKey);

    return () => {
      dialog.removeEventListener('keydown', onKey);
      restoreInert();
      if (opener?.isConnected) opener.focus();
    };
  }, [active]);
  return ref;
}
