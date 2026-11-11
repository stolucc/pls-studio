import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { MenuAction, MenuItem } from './canvasMenu';

/** A right-click menu at a screen position; closes on outside click, Escape, scroll or resize. */
export function ContextMenu({
  x,
  y,
  title,
  items,
  onAction,
  onClose,
}: {
  x: number;
  y: number;
  title: string;
  items: MenuItem[];
  onAction: (a: MenuAction) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)),
      top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)),
    });
    el.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [x, y]);

  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('mousedown', away, true);
    window.addEventListener('wheel', onClose, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', away, true);
      window.removeEventListener('wheel', onClose, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const all = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? all.length - 1
          : (i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
    all[next]?.focus();
  };

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      aria-label={title}
      style={pos}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="ctx-title">{title}</div>
      {items.map((it) => (
        <button
          key={it.action}
          role="menuitem"
          className={`menu-item${it.danger ? ' danger' : ''}`}
          onClick={() => {
            onClose();
            onAction(it.action);
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
