import { useEffect, useEffectEvent } from 'react';

// The handlers of the open dialogs, the most recently opened last. One window
// listener serves them all: Escape goes to the topmost only, so closing a
// confirmation opened from a dialog leaves that dialog open.
const stack: { current: () => void }[] = [];

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || stack.length === 0) return;
  e.stopPropagation();
  stack[stack.length - 1].current();
}

/**
 * Calls onEscape when Escape is pressed while active, unless a dialog opened
 * later is also listening (then only that one closes). Listens in the
 * capture phase and stops the event, so the canvas and anything underneath
 * do not also react to the same key.
 */
export function useEscape(onEscape: () => void, active = true) {
  const fire = useEffectEvent(onEscape);
  useEffect(() => {
    if (!active) return;
    const entry = { current: () => fire() };
    stack.push(entry);
    if (stack.length === 1) window.addEventListener('keydown', onKey, true);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      if (stack.length === 0) window.removeEventListener('keydown', onKey, true);
    };
  }, [active]);
}
