import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { useStore } from '../store';
import { IconAlert, IconCheck, IconInfo, IconX } from './icons';
import { useEscape } from './useEscape';

interface ConfirmOpts { title: string; body: string; confirmLabel?: string; danger?: boolean }
/** Several ways to continue (besides Cancel), e.g. keep / discard. */
interface Choice { id: string; label: string; danger?: boolean; primary?: boolean }
interface NumberField { label: string; min: number; max: number; integer?: boolean; initial?: string }
/** A text field: `check` returns why the text is not acceptable (null when it is). Empty text is allowed when `allowEmpty`. */
interface TextField { label: string; initial?: string; check: (text: string) => string | null; allowEmpty?: boolean }
/** Several text fields at once; each `check` sees all current values (for cross-field rules). */
interface FormField {
  label: string; initial?: string; placeholder?: string; hint?: string; multiline?: boolean; check: (text: string, all: string[]) => string | null;
  /** When another field (`changed`) is edited: this field's new text, or undefined to keep it (e.g. the current value of what field 0 now names). */
  follow?: (all: string[], changed: number) => string | undefined;
}
interface DialogState {
  current: (ConfirmOpts & { field?: NumberField; text?: TextField; fields?: FormField[]; choices?: Choice[]; resolve: (ok: boolean, value?: number, text?: string, choice?: string, values?: string[]) => void }) | null;
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

/** On-theme replacement for window.prompt, for validated text. Resolves null on cancel. */
export function textDialog(opts: ConfirmOpts & { text: TextField }): Promise<string | null> {
  return new Promise((resolve) => useDialog.setState({ current: { ...opts, resolve: (ok, _v, t) => resolve(ok && t !== undefined ? t : null) } }));
}

/** A small form: resolves the trimmed values of the fields, or null on cancel. */
export function formDialog(opts: ConfirmOpts & { fields: FormField[] }): Promise<string[] | null> {
  return new Promise((resolve) => useDialog.setState({ current: { ...opts, resolve: (ok, _v, _t, _c, values) => resolve(ok && values ? values : null) } }));
}

/** A question with several answers; resolves the chosen id, or null on cancel. */
export function choiceDialog(opts: ConfirmOpts & { choices: Choice[] }): Promise<string | null> {
  return new Promise((resolve) => useDialog.setState({ current: { ...opts, resolve: (ok, _v, _t, choice) => resolve(ok && choice ? choice : null) } }));
}

export function ConfirmModal() {
  const current = useDialog((s) => s.current);
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [values, setValues] = useState<string[]>([]);
  const field = current?.field;
  const textField = current?.text;
  const fields = current?.fields;
  const value = Number(text);
  const textError = textField && (text.trim() === '' ? (textField.allowEmpty ? null : '') : textField.check(text.trim()));
  // The fields' current text: on the first render (before the effect below fills `values`) their initial text.
  const vals = fields ? fields.map((f, i) => values[i] ?? f.initial ?? '') : [];
  const edit = (i: number, v: string) => {
    const next = [...vals]; next[i] = v;
    fields?.forEach((f, j) => { if (j !== i && f.follow) { const w = f.follow(next.map((x) => x.trim()), i); if (w !== undefined) next[j] = w; } });
    setValues(next);
  };
  const trimmed = vals.map((v) => v.trim());
  const fieldErrors = fields ? fields.map((f, i) => (trimmed[i] === '' ? '' : f.check(trimmed[i], trimmed))) : [];
  const valid = fields ? fieldErrors.every((e) => e === null)
    : textField ? textError === null
      : !field || (text.trim() !== '' && Number.isFinite(value) && value >= field.min && value <= field.max && (!field.integer || Number.isInteger(value)));
  const close = (ok: boolean, choice?: string) => {
    if (ok && !valid) return;
    current?.resolve(ok, field ? value : undefined, textField ? text.trim() : undefined, choice, fields ? trimmed : undefined);
    useDialog.setState({ current: null });
  };
  useEffect(() => { setText(current?.field?.initial ?? current?.text?.initial ?? ''); setValues(current?.fields?.map((f) => f.initial ?? '') ?? []); }, [current]);
  // Focus the first field (or OK) once, when a dialog opens: not on every render, or typing in another field jumps back.
  useEffect(() => {
    if (!current) return;
    (current.field || current.text || current.fields ? inputRef.current : okRef.current)?.focus();
  }, [current]);
  useEscape(() => close(false), !!current);
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
        {textField && (
          <div className="field">
            <label htmlFor="dlg-text">{textField.label}</label>
            <input id="dlg-text" ref={inputRef} className="input" value={text} autoComplete="off" spellCheck={false}
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') close(true); }} />
            {textError && <span className="hint" style={{ color: 'var(--bad)' }}>{textError}</span>}
          </div>
        )}
        {fields?.map((f, i) => (
          <div className="field" key={f.label}>
            <label htmlFor={`dlg-f${i}`}>{f.label}</label>
            {f.multiline
              ? <textarea id={`dlg-f${i}`} className="input" rows={10} value={vals[i]} spellCheck={false} placeholder={f.placeholder} style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical' }}
                onChange={(e) => edit(i, e.target.value)} />
              : <input id={`dlg-f${i}`} ref={i === 0 ? inputRef : undefined} className="input" value={vals[i]} autoComplete="off" spellCheck={false} placeholder={f.placeholder}
                onChange={(e) => edit(i, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') close(true); }} />}
            {fieldErrors[i] ? <span className="hint" style={{ color: 'var(--bad)' }}>{fieldErrors[i]}</span> : f.hint ? <span className="hint">{f.hint}</span> : null}
          </div>
        ))}
        <div className="actions">
          <button className="btn" onClick={() => close(false)}>Cancel</button>
          {current.choices
            ? current.choices.map((c, i) => (
              <button key={c.id} ref={c.primary || (i === current.choices!.length - 1 && !current.choices!.some((x) => x.primary)) ? okRef : undefined}
                className={`btn${c.primary ? ' primary' : ''}${c.danger ? ' danger' : ''}`} onClick={() => close(true, c.id)}>{c.label}</button>
            ))
            : <button ref={okRef} className="btn primary" disabled={!valid} onClick={() => close(true)}>{current.confirmLabel ?? 'Continue'}</button>}
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
