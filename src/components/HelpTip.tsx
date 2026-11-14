// A small "i" button that shows a help text in a tooltip: on hover and on keyboard focus, and on a
// click or tap (touch screens have no hover). Escape closes it. The text stays open while the
// pointer moves onto it, so it can be read (WCAG 1.4.13). It is drawn in a layer above the page,
// placed below the button (above it when there is no room), so a scrolling table cannot clip it.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { IconInfo } from './icons';
import './helpTip.css';

/** How long the tooltip waits after the pointer leaves before it closes (to reach the tooltip). */
const CLOSE_DELAY_MS = 120;
/** The space kept between the tooltip and the window's edges. */
const GUTTER = 8;

/** Where the tooltip goes: below the button, or above it when there is no room below. */
export function tipPosition(
  trigger: { left: number; top: number; bottom: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const maxLeft = viewport.width - tip.width - GUTTER;
  const left = Math.max(GUTTER, Math.min(trigger.left, maxLeft));
  const below = trigger.bottom + 6;
  const fitsBelow = below + tip.height <= viewport.height - GUTTER;
  const above = trigger.top - 6 - tip.height;
  const top = fitsBelow || above < GUTTER ? below : above;
  return { left, top };
}

/**
 * An info button with a tooltip. `label` names what the help is about (the button's accessible
 * name is "About <label>"); `children` is the help.
 */
export function HelpTip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelClose = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);
  const show = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);
  const hide = useCallback(() => {
    cancelClose();
    setOpen(false);
    setPos(null);
  }, [cancelClose]);
  const hideSoon = useCallback(() => {
    cancelClose();
    timer.current = setTimeout(hide, CLOSE_DELAY_MS);
  }, [cancelClose, hide]);

  // Escape closes it, wherever the focus is (also when it was opened by hovering).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        hide();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, hide]);

  useEffect(() => cancelClose, [cancelClose]);

  // Place it once it is drawn and its size is known.
  useLayoutEffect(() => {
    if (!open || !button.current || !tip.current) return;
    const t = button.current.getBoundingClientRect();
    const size = tip.current.getBoundingClientRect();
    setPos(
      tipPosition(
        { left: t.left, top: t.top, bottom: t.bottom },
        { width: size.width, height: size.height },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [open]);

  const style = pos
    ? { left: pos.left, top: pos.top }
    : { left: 0, top: 0, visibility: 'hidden' as const };

  return (
    <>
      <button
        ref={button}
        type="button"
        className="help-tip-btn"
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onFocus={show}
        onBlur={hide}
        onClick={show}
      >
        <IconInfo size={13} />
      </button>
      {open &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            className="help-tip-pop"
            style={style}
            onMouseEnter={cancelClose}
            onMouseLeave={hideSoon}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
