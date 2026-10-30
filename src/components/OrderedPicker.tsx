import { IconX } from './icons';

/** Columns in the order clicked (e.g. measurement occasions, conditions, items). */
export function OrderedPicker({ label, columns, value, onChange, hint = 'Click columns below to add them.' }: {
  label: string; columns: string[]; value: string[]; onChange: (v: string[]) => void; hint?: string;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="pick-list">
        {value.map((v, i) => (
          <span key={v} className="chip accent pick">{i + 1}. {v}
            <button aria-label={`Remove ${v}`} onClick={() => onChange(value.filter((x) => x !== v))}><IconX size={11} /></button>
          </span>
        ))}
        {!value.length && <span className="hint">{hint}</span>}
      </div>
      <div className="pick-source">
        {columns.filter((n) => !value.includes(n)).map((n) => <button key={n} className="btn sm ghost" onClick={() => onChange([...value, n])}>{n}</button>)}
      </div>
    </div>
  );
}
