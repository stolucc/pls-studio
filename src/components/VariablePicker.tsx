import { useState } from 'react';
import { toggleVariables } from '../model/efa';
import { useStore } from '../store';

/**
 * Many variables at once: a checkbox list with a filter, all / none (of the
 * visible ones), shift-click for a range, and the variables selected in the
 * data list.
 */
export function VariablePicker({
  columns,
  value,
  onChange,
}: {
  columns: string[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [filter, setFilter] = useState('');
  const [anchor, setAnchor] = useState<string | null>(null);
  const fromData = useStore((s) => s.selectedVars).filter((v) => columns.includes(v));
  const q = filter.trim().toLowerCase();
  const shown = q ? columns.filter((v) => v.toLowerCase().includes(q)) : columns;
  const chosen = new Set(value);
  const keepOrder = (vs: Set<string>) => columns.filter((v) => vs.has(v));
  return (
    <div className="field">
      <label>
        Variables{' '}
        <span className="muted">
          ({value.length} of {columns.length} chosen)
        </span>
      </label>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <input
          className="input"
          style={{ flex: '1 1 120px' }}
          placeholder="Filter…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter variables"
        />
        <button
          className="btn sm"
          onClick={() => onChange(keepOrder(new Set([...value, ...shown])))}
          title={q ? 'Choose all variables matching the filter' : 'Choose all variables'}
        >
          All{q ? ' shown' : ''}
        </button>
        <button
          className="btn sm ghost"
          onClick={() => onChange(q ? value.filter((v) => !shown.includes(v)) : [])}
        >
          None{q ? ' shown' : ''}
        </button>
        {fromData.length > 0 && (
          <button
            className="btn sm ghost"
            onClick={() => onChange(keepOrder(new Set([...value, ...fromData])))}
            title="Add the variables selected in the data list (shift/⌘-click there)"
          >
            Use selection ({fromData.length})
          </button>
        )}
      </div>
      <div className="var-check-list" role="group" aria-label="Variables">
        {shown.map((v) => (
          <label
            key={v}
            className="check var-check"
            onClick={(e) => {
              e.preventDefault();
              onChange(
                toggleVariables(shown, value, v, anchor, e.shiftKey)
                  .concat(value.filter((x) => !shown.includes(x)))
                  .filter((x, i, a) => a.indexOf(x) === i),
              );
              setAnchor(v);
            }}
          >
            <input type="checkbox" checked={chosen.has(v)} readOnly tabIndex={-1} />
            <span>{v}</span>
          </label>
        ))}
        {shown.length === 0 && <span className="hint">No variable matches.</span>}
      </div>
      <div className="hint" style={{ marginTop: 4 }}>
        Shift-click to choose a range.
      </div>
    </div>
  );
}
