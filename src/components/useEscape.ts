import { useEffect, useEffectEvent } from 'react';

/**
 * Calls onEscape when Escape is pressed while active. Listens in the capture
 * phase and stops the event, so the canvas and any dialog underneath do not
 * also react to the same key.
 */
export function useEscape(onEscape: () => void, active = true) {
  const fire = useEffectEvent(onEscape);
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        fire();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);
}
