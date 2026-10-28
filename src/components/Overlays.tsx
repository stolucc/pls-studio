import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useStore } from '../store';
import { IconAlert, IconCheck, IconInfo, IconX } from './icons';

interface ConfirmOpts { title: string; body: string; confirmLabel?: string; danger?: boolean }
interface NumberField { label: string; min: number; max: number; integer?: boolean; initial?: string }
interface DialogState {
  current: (ConfirmOpts & { field?: NumberField; resolve: (ok: boolean, value?: number) => void }) | null;
}
const useDialog = create<DialogState>(() => ({ current: null }));

/** On-theme replacement for window.confirm. */
export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => useDialog.setState({ current: { ...opts, resolve: (ok) => resolve(ok) } }));
}

/** On-theme replacement for window.prompt, for a single validated number. Resolves null on cancel. */
export function numberDialog(opts: ConfirmOpts & { field: NumberField }): Promise<number | null> {
  return new Promise((resolve) => useDialog.setState({ current: { ...opts, resolve: (ok, v) => resolve(ok && v !== undefined ? v : null) } }));
}

export function ConfirmModal() {
  const current = useDialog((s) => s.current);
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const field = current?.field;
  const value = Number(text);
  const valid = !field || (text.trim() !== '' && Number.isFinite(value) && value >= field.min && value <= field.max && (!field.integer || Number.isInteger(value)));
  const close = (ok: boolean) => {
    if (ok && !valid) return;
    current?.resolve(ok, field ? value : undefined);
    useDialog.setState({ current: null });
  };
  useEffect(() => { setText(current?.field?.initial ?? ''); }, [current]);
  useEffect(() => {
    if (!current) return;
    (current.field ? inputRef.current : okRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  if (!current) return null;
  return (
    <div className="modal-backdrop" onMouseDown={() => close(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="dlg-title" onMouseDown={(e) => e.stopPropagation()}>
        <h3 id="dlg-title">{current.title}</h3>
        <p>{current.body}</p>
        {field && (
          <div className="field">
            <label htmlFor="dlg-num">{field.label}</label>
            <input id="dlg-num" ref={inputRef} className="input num" type="number" min={field.min} max={field.max} value={text}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') close(true); }} />
            {!valid && text !== '' && <span className="hint" style={{ color: 'var(--bad)' }}>Enter {field.integer ? 'a whole number' : 'a number'} between {field.min} and {field.max}.</span>}
          </div>
        )}
        <div className="actions">
          <button className="btn" onClick={() => close(false)}>Cancel</button>
          <button ref={okRef} className="btn primary" disabled={!valid} onClick={() => close(true)}>
            {current.confirmLabel ?? 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="ticon">{t.kind === 'error' ? <IconAlert /> : t.kind === 'success' ? <IconCheck /> : <IconInfo />}</span>
          <span style={{ flex: 1 }}>{t.text}</span>
          <button onClick={() => dismiss(t.id)} aria-label="Dismiss"><IconX size={14} /></button>
        </div>
      ))}
    </div>
  );
}
