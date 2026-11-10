// Helpers shared by the analysis cards: option parsing, inputs, form fields.

import type { Dataset } from '../engine/types';
import { fingerprint } from './codec';
import type { AnalysisCtx } from './types';

export { clampNum, flag, isObj, name, names, oneOf } from '../parse';

/** The raw data, or null for none or a covariance matrix. */
export const rawData = (ctx: AnalysisCtx): Dataset | null => (ctx.data && !(ctx.data.moments && ctx.data.cols.length === 0) ? ctx.data : null);

/** Data columns, or the construct scores of the current PLS-SEM results. */
export const sourceData = (source: 'data' | 'scores', ctx: AnalysisCtx): Dataset | null =>
  source === 'scores' ? (ctx.pls ? { names: ctx.pls.constructs, cols: ctx.pls.scores } : null) : rawData(ctx);

/** Fingerprint of the columns read from data or construct scores. */
export function sourceFingerprint(source: 'data' | 'scores', ctx: AnalysisCtx, cols: string[], extra: (string | number | null)[] = []): string | null {
  const ds = sourceData(source, ctx);
  if (!ds) return null;
  const ks = [...new Set(cols.filter(Boolean))].map((c) => ds.names.indexOf(c));
  if (ks.some((k) => k < 0)) return null;
  return fingerprint([source, ...extra, ...ks.flatMap((k) => [ds.names[k], ds.cols[k]])]);
}

/** Why raw-data columns cannot be used (null when they can). */
export function missingColumns(ctx: AnalysisCtx, cols: string[], what: string): string | null {
  const ds = rawData(ctx);
  if (!ds) return `${what} needs raw data: import a dataset (not a covariance matrix).`;
  const gone = cols.filter((c) => c && !ds.names.includes(c));
  return gone.length ? `Not in the data: ${gone.join(', ')}.` : null;
}

/** Fingerprint of the raw-data columns an analysis reads, plus settings it depends on. */
export function columnsFingerprint(ctx: AnalysisCtx, cols: string[], extra: (string | number | null)[] = []): string | null {
  const ds = rawData(ctx);
  if (!ds) return null;
  const ks = [...new Set(cols.filter(Boolean))].map((c) => ds.names.indexOf(c));
  if (ks.some((k) => k < 0)) return null;
  return fingerprint([...extra, ...ks.flatMap((k) => [ds.names[k], ds.cols[k]])]);
}

/** A data column name not yet in use: base, base_2, base_3, … */
export function freeColumnName(names: string[], base: string): string {
  let name = base, i = 2;
  while (names.includes(name)) name = `${base}_${i++}`;
  return name;
}

/** A column chooser; columns in `exclude` are left out (except the current value). */
export function ColumnSelect({ id, label, value, columns, exclude = [], onChange, optional }: {
  id: string; label: string; value: string; columns: string[]; exclude?: string[]; onChange: (v: string) => void; optional?: string;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{optional ?? 'Choose…'}</option>
        {columns.filter((n) => n === value || !exclude.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
}

/** A segmented choice between a few options. */
export function Choice<T extends string>({ label, value, options, onChange, hint }: { label: string; value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; hint?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="segmented">
        {options.map(([id, l]) => <button key={id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>{l}</button>)}
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
