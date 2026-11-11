// Recode a numeric column into a new one: bins (equal width, equal counts or
// cut points) or old values to new ones. The new column is a computed column
// whose formula the dialog shows before it is created (data/binning.ts).

import { useMemo, useState } from 'react';
import { nameError, evaluate, parseFormula } from '../data/compute';
import {
  addRecodedColumn,
  binFormula,
  binLabels,
  equalCountCuts,
  equalWidthCuts,
  parseCuts,
  parseRecode,
  recodeFormula,
  recodeLabels,
} from '../data/binning';
import { freeColumnName } from '../analyses/common';
import type { MeasurementLevel, ValueLabel } from '../data/columns';
import { toBase } from '../data/pipeline';
import { useStore } from '../store';
import { IconX } from './icons';
import { useEscape } from './useEscape';

type Mode = 'width' | 'count' | 'cuts' | 'values';
const MODES: [Mode, string][] = [
  ['width', 'Equal width'],
  ['count', 'Equal counts'],
  ['cuts', 'Cut points'],
  ['values', 'Values'],
];

interface Plan {
  expr: string;
  labels: ValueLabel[];
  level: MeasurementLevel;
}

/** The new column's formula, labels and level for the chosen recode; throws when it cannot be made. */
function makePlan(
  mode: Mode,
  column: string,
  values: Float64Array,
  bins: number,
  cutsText: string,
  rulesText: string,
): Plan {
  if (mode === 'values') {
    const { rules, otherwise } = parseRecode(rulesText);
    return {
      expr: recodeFormula(column, rules, otherwise),
      labels: recodeLabels(rules),
      level: 'nominal',
    };
  }
  let cuts: number[];
  if (mode === 'width') cuts = equalWidthCuts(values, bins);
  else if (mode === 'count') cuts = equalCountCuts(values, bins);
  else cuts = parseCuts(cutsText);
  if (!cuts.length) throw new Error('The values do not split into bins.');
  return { expr: binFormula(column, cuts), labels: binLabels(cuts), level: 'ordinal' };
}

export function RecodeDialog({ column, onClose }: { column: string; onClose: () => void }) {
  const data = useStore((s) => s.data);
  const info = useStore((s) => s.dataInfo);
  const [mode, setMode] = useState<Mode>('width');
  const [bins, setBins] = useState(4);
  const [cutsText, setCutsText] = useState('');
  const [rulesText, setRulesText] = useState('');
  const [name, setName] = useState(() =>
    freeColumnName(data?.names ?? [], `${column.replace(/[^A-Za-z0-9_.]/g, '_')}_rec`),
  );
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose);

  // Over every case, as the column will be computed (the filter applies afterwards).
  const base = useMemo(() => (data && info ? toBase(data, info).data : null), [data, info]);
  const values = base?.cols[base.names.indexOf(column)];

  const plan = useMemo((): Plan | string => {
    if (!values) return 'The column is not in the dataset.';
    try {
      return makePlan(mode, column, values, bins, cutsText, rulesText);
    } catch (e) {
      return (e as Error).message;
    }
  }, [mode, column, values, bins, cutsText, rulesText]);

  // How many cases each new value gets (a preview of the result).
  const counts = useMemo(() => {
    if (typeof plan === 'string' || !base) return null;
    try {
      const out = new Map<number, number>();
      let missing = 0;
      for (const v of evaluate(parseFormula(plan.expr), base)) {
        if (Number.isNaN(v)) missing++;
        else out.set(v, (out.get(v) ?? 0) + 1);
      }
      return { values: [...out.entries()].sort((a, b) => a[0] - b[0]), missing };
    } catch {
      return null;
    }
  }, [plan, base]);

  const nameProblem = data && info ? nameError(name, data, info) : null;

  const create = () => {
    if (!data || !info || typeof plan === 'string' || nameProblem) return;
    try {
      const r = addRecodedColumn(data, info, { name, ...plan });
      const s = useStore.getState();
      s.setData(r.data, r.info);
      s.toast('success', `Added ${name} = ${plan.expr}.`);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const labelOf = (v: number) =>
    typeof plan === 'string' ? '' : (plan.labels.find((l) => l.value === v)?.label ?? '');

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal recode-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recode-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="share-head">
          <h3 id="recode-title">Recode {column}</h3>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </div>
        <p className="hint">
          Makes a new computed column from {column}: bins of its values, or old values to new ones.
          The formula is shown below and kept with the column, so it can be edited later.
        </p>
        <div className="field">
          <label>Recode into</label>
          <div className="segmented">
            {MODES.map(([id, label]) => (
              <button key={id} className={mode === id ? 'on' : ''} onClick={() => setMode(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {(mode === 'width' || mode === 'count') && (
          <div className="field">
            <label htmlFor="recode-bins">Number of bins</label>
            <input
              id="recode-bins"
              className="input num"
              type="number"
              min={2}
              max={50}
              value={bins}
              onChange={(e) => {
                const k = Math.round(Number(e.target.value));
                setBins(Number.isFinite(k) ? Math.min(50, Math.max(2, k)) : 4);
              }}
            />
          </div>
        )}
        {mode === 'cuts' && (
          <div className="field">
            <label htmlFor="recode-cuts">Cut points</label>
            <input
              id="recode-cuts"
              className="input"
              placeholder="e.g. 18, 30, 50"
              value={cutsText}
              onChange={(e) => setCutsText(e.target.value)}
            />
            <div className="hint">A value equal to a cut point goes to the bin above it.</div>
          </div>
        )}
        {mode === 'values' && (
          <div className="field">
            <label htmlFor="recode-rules">Rules: old = new (one per line)</label>
            <textarea
              id="recode-rules"
              className="input"
              rows={6}
              placeholder={'1, 2 = 1 low\n3 to 5 = 2 high\nelse = missing'}
              value={rulesText}
              onChange={(e) => setRulesText(e.target.value)}
            />
            <div className="hint">
              Values (1, 2), ranges (3 to 5, lowest to 2, 6 to highest); text after the new value is
              its label. else = copy (default), missing or a number. The first matching rule
              decides; missing values stay missing.
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="recode-name">New column</label>
          <input
            id="recode-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {nameProblem && <div className="hint bad">{nameProblem}</div>}
        </div>
        {typeof plan === 'string' ? (
          <div className="hint bad" role="alert">
            {plan}
          </div>
        ) : (
          <div className="field">
            <label>Formula</label>
            <code className="recode-formula">{plan.expr}</code>
            {counts && (
              <table className="data-grid recode-preview">
                <thead>
                  <tr>
                    <th>New value</th>
                    <th>Label</th>
                    <th>Cases</th>
                  </tr>
                </thead>
                <tbody>
                  {counts.values.map(([v, n]) => (
                    <tr key={v}>
                      <td>{v}</td>
                      <td className="text">{labelOf(v)}</td>
                      <td>{n}</td>
                    </tr>
                  ))}
                  {counts.missing > 0 && (
                    <tr>
                      <td>missing</td>
                      <td />
                      <td>{counts.missing}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
        {error && (
          <div className="hint bad" role="alert">
            {error}
          </div>
        )}
        <div className="actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={typeof plan === 'string' || !!nameProblem}
            onClick={create}
          >
            Create column
          </button>
        </div>
      </div>
    </div>
  );
}
