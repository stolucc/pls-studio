// Add a computed column, or edit one's formula: a name, the formula as text (the main way to
// write it), and a formula builder under it: a calculator-style pad, the functions and the
// columns, each inserting at the cursor of the formula field. Below the field, the formula is
// checked as it is typed: the parser's message, or the first computed values.

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { computeColumn, FUNCTIONS, nameError } from '../data/compute';
import {
  backspace,
  insertAt,
  insertColumn,
  insertComma,
  insertFunction,
  insertOperator,
  previewFormula,
  quoteName,
  type Edit,
} from '../data/formulaEdit';
import { transformData } from '../data/pipeline';
import { fmt } from '../format';
import { useStore } from '../store';
import { IconX } from './icons';
import { useEscape } from './useEscape';

/** A key of the pad: what it shows, what it inserts, how it reads aloud. */
interface Key {
  label: string;
  label2?: string;
  insert: string;
  aria: string;
  kind: 'raw' | 'operator' | 'comma';
}

const raw = (label: string, aria = label): Key => ({ label, insert: label, aria, kind: 'raw' });
const op = (label: string, insert: string, aria: string): Key => ({
  label,
  insert,
  aria,
  kind: 'operator',
});

// Digits and arithmetic, as on a calculator (rows of five).
const ARITHMETIC: Key[] = [
  raw('7'),
  raw('8'),
  raw('9'),
  op('÷', '/', 'divided by'),
  raw('(', 'opening parenthesis'),
  raw('4'),
  raw('5'),
  raw('6'),
  op('×', '*', 'times'),
  raw(')', 'closing parenthesis'),
  raw('1'),
  raw('2'),
  raw('3'),
  op('−', '-', 'minus'),
  op('^', '^', 'to the power of'),
  raw('0'),
  raw('.', 'decimal point'),
  { label: ',', insert: ',', aria: 'comma, between the arguments of a function', kind: 'comma' },
  op('+', '+', 'plus'),
  raw('NA', 'NA, a missing value'),
];
// Comparisons give 1 (true) or 0 (false); and, or, not combine them.
const LOGIC: Key[] = [
  op('<', '<', 'less than'),
  op('≤', '<=', 'less than or equal to'),
  op('>', '>', 'greater than'),
  op('≥', '>=', 'greater than or equal to'),
  op('=', '==', 'equal to'),
  op('≠', '!=', 'not equal to'),
  op('and', 'and', 'and'),
  op('or', 'or', 'or'),
  op('not', 'not', 'not'),
];

function showValue(v: number): string {
  if (Number.isNaN(v)) return 'NA';
  if (Number.isInteger(v)) return String(v);
  return fmt(v, 4);
}

export function ComputeDialog({ edit, onClose }: { edit?: string; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const info = useStore((s) => s.dataInfo);
  const current = edit ? info?.computed?.find((c) => c.name === edit) : undefined;
  const [name, setName] = useState(edit ?? '');
  const [formula, setFormula] = useState(current?.expr ?? '');
  const [columnQuery, setColumnQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Where the cursor is in the formula field (kept while a button has the focus).
  const selection = useRef({ start: formula.length, end: formula.length });
  // After a button: where the cursor goes once the new text is in the field.
  const pending = useRef<{ start: number; end: number } | null>(null);
  const [moves, setMoves] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  useEscape(onClose);

  useLayoutEffect(() => {
    const el = field.current;
    const at = pending.current;
    if (!el || !at) return;
    pending.current = null;
    el.focus();
    el.setSelectionRange(at.start, at.end);
    selection.current = at;
  }, [moves]);

  const nameProblem = data && info && name.trim() ? nameError(name.trim(), data, info, edit) : null;
  const preview = useMemo(() => {
    if (!data || !info || formula.trim() === '') return null;
    return previewFormula(data, info, name, formula, edit);
  }, [data, info, name, formula, edit]);

  if (!data || !info) return null;

  const remember = (el: HTMLInputElement) => {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    selection.current = { start, end };
  };

  /** Change the formula with a button, then put the focus and cursor back in the field. */
  const apply = (change: (e: Edit) => Edit) => {
    const length = formula.length;
    const start = Math.min(selection.current.start, length);
    const end = Math.min(Math.max(selection.current.end, start), length);
    const next = change({ text: formula, start, end });
    setFormula(next.text);
    setError(null);
    pending.current = { start: next.start, end: next.end };
    setMoves((m) => m + 1);
  };

  const press = (key: Key) => {
    if (key.kind === 'operator') apply((e) => insertOperator(e, key.insert));
    else if (key.kind === 'comma') apply(insertComma);
    else apply((e) => insertAt(e, key.insert));
  };

  const valid = name.trim() !== '' && !nameProblem && !!preview && !('error' in preview);
  const create = () => {
    if (!valid) return;
    const column = name.trim();
    try {
      // Over every case (the filter applies afterwards); an edited formula changes the columns
      // computed from this one too.
      const r = transformData(data, info, (d, i) => computeColumn(d, i, column, formula), {
        recompute: !!current,
      });
      const s = useStore.getState();
      s.setData(r.data, r.info);
      const values = r.data.cols[r.data.names.indexOf(column)];
      const missing = values.filter(Number.isNaN).length;
      const verb = current ? 'Recomputed' : 'Added';
      const note = missing ? ` (${missing} missing)` : '';
      s.toast('success', `${verb} ${column} = ${formula.trim()}${note}.`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const q = columnQuery.trim().toLowerCase();
  const columns = data.names.filter((n) => n !== edit && n.toLowerCase().includes(q));

  let status: ReactNode;
  if (!preview) {
    status = <span className="hint">Type a formula, or build it with the buttons below.</span>;
  } else if ('error' in preview) {
    status = <span className="formula-error">{preview.error}</span>;
  } else {
    const shown = preview.first.map(showValue).join(', ');
    const more = preview.rows > preview.first.length ? ', …' : '';
    const missing = preview.missing === 1 ? '1 missing' : `${preview.missing} missing`;
    status = (
      <span className="formula-preview">
        <span className="muted">Preview: </span>
        <code>
          {shown}
          {more}
        </code>{' '}
        <span className="muted">
          ({preview.rows} rows, {missing})
        </span>
      </span>
    );
  }

  const keyButton = (key: Key) => (
    <button
      key={key.label}
      type="button"
      className="btn sm pad-key"
      aria-label={key.aria}
      title={key.insert === key.label ? key.aria : `${key.aria}: inserts ${key.insert}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => press(key)}
    >
      {key.label}
    </button>
  );

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal compute-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compute-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="share-head">
          <h3 id="compute-title">
            {current ? `Edit the formula of ${edit}` : 'Add a computed column'}
          </h3>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <p className="hint">
          A new column from a formula over the existing columns. Type the formula, or click the
          buttons to insert at the cursor. Missing values stay missing. The formula is kept with the
          column, so it can be edited later.
        </p>
        <div className="field">
          <label htmlFor="compute-name">Column name</label>
          <input
            id="compute-name"
            className="input"
            value={name}
            autoComplete="off"
            spellCheck={false}
            placeholder="e.g. log_income"
            autoFocus={!current}
            onChange={(e) => setName(e.target.value)}
          />
          {nameProblem && <span className="formula-error">{nameProblem}</span>}
        </div>
        <div className="field">
          <label htmlFor="compute-formula">Formula</label>
          <input
            id="compute-formula"
            ref={field}
            className="input formula-input"
            value={formula}
            autoComplete="off"
            spellCheck={false}
            autoFocus={!!current}
            placeholder="e.g. log(income) or (x1 + x2) / 2 or reverse(q3, 1, 5)"
            aria-describedby="compute-status"
            onChange={(e) => {
              setFormula(e.target.value);
              setError(null);
              remember(e.target);
            }}
            onSelect={(e) => remember(e.currentTarget)}
            onKeyUp={(e) => remember(e.currentTarget)}
            onMouseUp={(e) => remember(e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create();
            }}
          />
          <div id="compute-status" className="formula-status" role="status" aria-live="polite">
            {status}
          </div>
        </div>
        <div className="formula-builder">
          <div className="pad" role="group" aria-label="Numbers and operators">
            <div className="pad-grid">{ARITHMETIC.map(keyButton)}</div>
            <div className="pad-grid logic">{LOGIC.map(keyButton)}</div>
            <div className="pad-grid edit">
              <button
                type="button"
                className="btn sm pad-key"
                aria-label="Backspace"
                title="Backspace: remove the last piece before the cursor"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(backspace)}
              >
                ⌫
              </button>
              <button
                type="button"
                className="btn sm pad-key"
                title="Clear the formula"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(() => ({ text: '', start: 0, end: 0 }))}
              >
                Clear
              </button>
            </div>
          </div>
          <div className="builder-list" role="group" aria-labelledby="compute-columns">
            <div className="builder-list-head">
              <span id="compute-columns">Columns</span>
              {data.names.length > 8 && (
                <input
                  className="input"
                  placeholder="Filter…"
                  aria-label="Filter the columns"
                  value={columnQuery}
                  onChange={(e) => setColumnQuery(e.target.value)}
                />
              )}
            </div>
            <div className="builder-items">
              {columns.map((n) => {
                const quoted = quoteName(n);
                const text = !!data.categories?.[n];
                let title = `Insert ${quoted ?? n}`;
                if (text) title += ' (a text column: compare it with a category, e.g. == "a")';
                if (quoted === null)
                  title =
                    'This name has a backtick, which a formula cannot read: rename the column.';
                return (
                  <button
                    key={n}
                    type="button"
                    className="builder-item"
                    disabled={quoted === null}
                    title={title}
                    aria-label={`Insert the column ${n}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => apply((e) => insertColumn(e, n))}
                  >
                    <code>{n}</code>
                    {text && <span className="muted"> text</span>}
                  </button>
                );
              })}
              {columns.length === 0 && <span className="hint">No column matches.</span>}
            </div>
          </div>
          <div className="builder-list" role="group" aria-labelledby="compute-functions">
            <div className="builder-list-head">
              <span id="compute-functions">Functions</span>
            </div>
            <div className="builder-items">
              {Object.entries(FUNCTIONS).map(([fn, f]) => (
                <button
                  key={fn}
                  type="button"
                  className="builder-item"
                  title={f.doc}
                  aria-label={`Insert ${fn}(): ${f.doc}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => apply((e) => insertFunction(e, fn))}
                >
                  <code>{fn}()</code>
                  <span className="builder-doc">{f.doc}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        {error && <p className="formula-error">{error}</p>}
        <div className="actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid} onClick={create}>
            {current ? 'Recompute' : 'Add column'}
          </button>
        </div>
      </div>
    </div>
  );
}
