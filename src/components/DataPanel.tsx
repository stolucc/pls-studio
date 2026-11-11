import { useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { mean, sd } from '../engine/stats';
import {
  computeColumn,
  FUNCTIONS,
  nameError,
  parseFormula,
  columnsIn,
  removeComputed,
} from '../data/compute';
import { observedRange, reverseCode } from '../data/recode';
import { restoreCases, transformData } from '../data/pipeline';
import { editFilter, FilterBadge } from './FilterBadge';
import { importCsv, loadSample } from '../io';
import { formDialog, confirmDialog, textDialog } from './Overlays';
import { useStore } from '../store';
import { VARS_MIME } from './dnd';
import { IconEye, IconUpload } from './icons';

export function DataPanel() {
  const data = useStore((s) => s.data);
  const info = useStore((s) => s.dataInfo);
  const constructs = useStore((s) => s.model.constructs);
  const selected = useStore((s) => s.selectedVars);
  const setSelected = useStore((s) => s.setSelectedVars);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'free'>('all');
  const [over, setOver] = useState(false);
  const anchor = useRef<string | null>(null);

  const owner = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of constructs) for (const i of c.indicators) m.set(i, c.name);
    return m;
  }, [constructs]);

  const stats = useMemo(() => {
    if (!data) return [];
    if (data.moments && data.cols.length === 0) {
      return data.names.map((name, i) => ({
        name,
        mean: data.moments!.means?.[i] ?? NaN,
        sd: Math.sqrt(data.moments!.S[i][i]),
        missing: 0,
      }));
    }
    return data.names.map((name, i) => {
      const present = data.cols[i].filter((v) => !Number.isNaN(v));
      return {
        name,
        mean: mean(present),
        sd: sd(present),
        missing: data.cols[i].length - present.length,
      };
    });
  }, [data]);

  const visible = stats.filter(
    (v) =>
      v.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (filter === 'all' || !owner.has(v.name)),
  );

  const onClick = (e: MouseEvent, name: string) => {
    if (e.shiftKey && anchor.current) {
      const names = visible.map((v) => v.name);
      const a = names.indexOf(anchor.current);
      const b = names.indexOf(name);
      if (a >= 0 && b >= 0) {
        const range = names.slice(Math.min(a, b), Math.max(a, b) + 1);
        setSelected([...new Set([...selected, ...range])]);
        return;
      }
    }
    anchor.current = name;
    if (e.metaKey || e.ctrlKey)
      setSelected(
        selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name],
      );
    else setSelected([name]);
  };

  const onDragStart = (e: DragEvent, name: string) => {
    const names = selected.includes(name)
      ? visible.map((v) => v.name).filter((n) => selected.includes(n))
      : [name];
    if (!selected.includes(name)) setSelected([name]);
    e.dataTransfer.setData(VARS_MIME, JSON.stringify(names));
    e.dataTransfer.setData('text/plain', names.join(', '));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const reversed = new Map((info?.reversed ?? []).map((r) => [r.name, r]));
  /** Reverse-code the selected items on a scale the user confirms (defaults to the observed range). */
  const reverseSelected = async () => {
    if (!data || !info) return;
    const names = visible.map((v) => v.name).filter((n) => selected.includes(n));
    const done = names.filter((n) => reversed.has(n));
    const known =
      done.length === names.length &&
      new Set(done.map((n) => `${reversed.get(n)!.min},${reversed.get(n)!.max}`)).size === 1
        ? reversed.get(done[0])
        : undefined;
    const range = known ? [known.min, known.max] : observedRange(data, names);
    const parse = (t: string) => {
      const m = t
        .split(/[\s,;–-]+/)
        .filter(Boolean)
        .map(Number);
      return m.length === 2 && m.every(Number.isFinite) && m[0] < m[1] ? m : null;
    };
    // Every chosen item already reversed: the dialog offers to undo it.
    const undo = done.length === names.length;
    const what = names.length === 1 ? names[0] : `${names.length} items`;
    const itemList = names.length > 1 ? ` Items: ${names.join(', ')}.` : '';
    const text = await textDialog({
      title: undo ? `Undo the reverse-coding of ${what}?` : `Reverse-code ${what}?`,
      body:
        'Each value x becomes lowest + highest − x on the answer scale (on 1–5: 1 ↔ 5, 2 ↔ 4), for negatively worded items. ' +
        `Doing it again on the same scale undoes it.${itemList}`,
      confirmLabel: undo ? 'Undo' : 'Reverse-code',
      text: {
        label: 'Answer scale: lowest, highest',
        initial: range ? `${range[0]}, ${range[1]}` : '1, 5',
        check: (t) =>
          parse(t) ? null : 'Enter the lowest and highest value of the scale, e.g. 1, 5.',
      },
    });
    if (text === null) return;
    const [min, max] = parse(text)!;
    try {
      // (on the base dataset: the cases the filter leaves out are reverse-coded too)
      let undone: string[] = [];
      const r = transformData(data, info, (d, i) => {
        const rc = reverseCode(d, i, names, min, max);
        undone = rc.undone;
        return rc;
      });
      useStore.getState().setData(r.data, r.info);
      const changed = names.filter((n) => !undone.includes(n));
      useStore
        .getState()
        .toast(
          'success',
          [
            changed.length ? `Reverse-coded ${changed.join(', ')} (${min}–${max}).` : '',
            undone.length ? `Back to the original coding: ${undone.join(', ')}.` : '',
          ]
            .filter(Boolean)
            .join(' '),
        );
    } catch (e) {
      useStore.getState().toast('error', (e as Error).message);
    }
  };

  const computed = new Map((info?.computed ?? []).map((c) => [c.name, c]));
  /** Add a column from a formula, or edit the formula of the selected computed column. */
  const computeNew = async (edit?: string) => {
    if (!data || !info) return;
    const current = edit ? computed.get(edit) : undefined;
    const values = await formDialog({
      title: current ? `Edit the formula of ${edit}` : 'Add a computed column',
      body: `A formula over the existing columns: + − × ÷ ^, comparisons (<, >=, ==), & and |, and ${Object.keys(FUNCTIONS).join(', ')}. Names with spaces or dots in backticks: \`my var\`. Missing values stay missing.`,
      confirmLabel: current ? 'Recompute' : 'Add column',
      fields: [
        {
          label: 'Column name',
          initial: edit ?? '',
          placeholder: 'e.g. log_income',
          check: (t) => nameError(t, data, info, edit),
        },
        {
          label: 'Formula',
          initial: current?.expr ?? '',
          placeholder: 'e.g. log(income) or (x1 + x2) / 2 or z(score)',
          hint: 'Examples: log(x), sqrt(x), z(x), center(x), ifelse(age >= 18, 1, 0), mean(x1, x2, x3), x^2.',
          check: (t, all) => {
            try {
              const n = parseFormula(t);
              for (const c of columnsIn(n)) {
                if (c === all[0]) return 'A column cannot be computed from itself.';
                if (!data.names.includes(c)) return `“${c}” is not a column of the dataset.`;
              }
              return null;
            } catch (e) {
              return (e as Error).message;
            }
          },
        },
      ],
    });
    if (!values) return;
    try {
      // Over every case (the filter applies afterwards); an edited formula changes the columns
      // computed from this one too.
      const r = transformData(
        data,
        info,
        (d, i) => computeColumn(d, i, values[0], values[1]),
        !!current,
      );
      useStore.getState().setData(r.data, r.info);
      const col = r.data.cols[r.data.names.indexOf(values[0])];
      const miss = col.filter(Number.isNaN).length;
      useStore
        .getState()
        .toast(
          'success',
          `${current ? 'Recomputed' : 'Added'} ${values[0]} = ${values[1].trim()}${miss ? ` (${miss} missing)` : ''}.`,
        );
    } catch (e) {
      useStore.getState().toast('error', (e as Error).message);
    }
  };
  const removeSelectedComputed = async () => {
    if (!data || !info) return;
    const names = selected.filter((n) => computed.has(n));
    const used = names.filter((n) => owner.has(n));
    if (used.length) {
      useStore
        .getState()
        .toast(
          'error',
          `${used.join(', ')} ${used.length === 1 ? 'is' : 'are'} in the model; remove ${used.length === 1 ? 'it' : 'them'} from the construct first.`,
        );
      return;
    }
    if (
      !(await confirmDialog({
        title: `Remove ${names.length === 1 ? names[0] : `${names.length} computed columns`}?`,
        body: 'The column and its formula are removed from the dataset.',
        confirmLabel: 'Remove',
        danger: true,
      }))
    )
      return;
    try {
      const r = transformData(data, info, (d, i) => {
        let out = { data: d, info: i };
        for (const n of names) out = removeComputed(out.data, out.info, n);
        return out;
      });
      useStore.getState().setData(r.data, r.info);
      setSelected(selected.filter((n) => !names.includes(n)));
    } catch (e) {
      useStore.getState().toast('error', (e as Error).message);
    }
  };

  // Exclusions other than the filter's rows (the filter has its own badge).
  const exclusions = (info?.droppedRows ?? []).filter((d) => !d.filter);

  const onFileDrop = (e: DragEvent) => {
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    e.preventDefault();
    void importCsv(f);
  };

  return (
    <aside className="panel left" aria-label="Data">
      <div className="panel-head">
        <span>Data</span>
        {data && (
          <span className="panel-actions">
            <button
              className="btn sm ghost"
              onClick={() => useStore.getState().setWorkspace('data')}
              title="See the rows and descriptive statistics of the dataset"
            >
              <IconEye size={13} /> Inspect
            </button>
            {info?.kind !== 'matrix' && (
              <button
                className="btn sm ghost"
                onClick={() => void computeNew()}
                title="Add a column computed from a formula over the existing columns (log, z-score, sums, recodes…)"
              >
                ƒ Compute…
              </button>
            )}
            <button
              className="btn sm ghost"
              onClick={() => void importCsv()}
              title="Replace dataset"
            >
              <IconUpload size={13} /> Replace
            </button>
          </span>
        )}
      </div>
      <div className="panel-body">
        {!data || !info ? (
          <div
            className={`dropzone${over ? ' over' : ''}`}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                setOver(true);
              }
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onFileDrop}
          >
            <IconUpload size={20} />
            <div>Drop a data file here</div>
            <button className="btn primary" onClick={() => void importCsv()}>
              Choose file
            </button>
            <div style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
              <span className="hint">or load an example</span>
              <button className="btn ghost sm" onClick={() => void loadSample('customer')}>
                Customer survey (PLS, raw data)
              </button>
              <button className="btn ghost sm" onClick={() => void loadSample('emse')}>
                Gamification in SE · Stol et al. 2022 (CB-SEM, matrix)
              </button>
            </div>
            <div className="hint">
              CSV (comma, semicolon or tab separated, with a header row), SPSS (.sav), Stata (.dta)
              or Excel (.xlsx, .xls; first row = names). Empty cells, NA and “.” count as missing;
              text columns with few values (groups, cluster ids) become categories. Data stays in
              your browser.
            </div>
          </div>
        ) : (
          <>
            <div className="section">
              <div className="data-meta">
                <span>File</span>
                <b
                  title={info.fileName}
                  style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {info.fileName}
                </b>
                {info.kind === 'matrix' && (
                  <>
                    <span>Type</span>
                    <b>covariance matrix{info.hasNacov ? ' + NACOV' : ''}</b>
                  </>
                )}
                <span>{info.kind === 'matrix' ? 'Sample size N' : 'Observations'}</span>
                <b>{info.rows}</b>
                <span>Variables</span>
                <b>{data.names.length}</b>
                {info.kind !== 'matrix' && (
                  <>
                    <span>Missing values</span>
                    <b>{info.missingCells}</b>
                  </>
                )}
              </div>
              {info.kind !== 'matrix' && (
                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {info.filter ? (
                    <FilterBadge />
                  ) : (
                    <button
                      className="btn sm ghost"
                      onClick={() => void editFilter()}
                      title="Analyse only the cases where a condition holds, e.g. age >= 18"
                    >
                      Filter cases…
                    </button>
                  )}
                </div>
              )}
              {exclusions.length ? (
                <div
                  className="hint"
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <span>
                    Excluded: {exclusions.reduce((n, d) => n + d.at.length, 0)} cases (
                    {[...new Set(exclusions.map((d) => d.reason))].join('; ')})
                  </span>
                  <button
                    className="btn sm"
                    onClick={() => {
                      const s = useStore.getState();
                      if (!s.data || !s.dataInfo) return;
                      const r = restoreCases(s.data, s.dataInfo);
                      s.setData(r.data, r.info);
                      s.toast('success', 'The excluded cases are back in the dataset.');
                    }}
                  >
                    Restore
                  </button>
                </div>
              ) : null}
              {info.excluded.length > 0 && (
                <div className="hint" style={{ marginTop: 8 }}>
                  Skipped: {info.excluded.map((e) => `${e.name} (${e.reason})`).join(', ')}
                </div>
              )}
            </div>
            <div className="section">
              <input
                className="input"
                placeholder="Filter variables…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="segmented" style={{ marginTop: 8 }}>
                <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
                  All ({stats.length})
                </button>
                <button className={filter === 'free' ? 'on' : ''} onClick={() => setFilter('free')}>
                  Unassigned ({stats.filter((v) => !owner.has(v.name)).length})
                </button>
              </div>
              <div className="hint" style={{ margin: '8px 0 2px' }}>
                Shift/⌘-click to select several, then drag onto the canvas or a construct.
              </div>
              {selected.length > 0 && info.kind !== 'matrix' && (
                <div className="selection-bar">
                  <span className="muted">{selected.length} selected</span>
                  <button
                    className="btn sm ghost"
                    onClick={() => void reverseSelected()}
                    title="For negatively worded items: x becomes lowest + highest − x on the answer scale"
                  >
                    Reverse-code…
                  </button>
                  {selected.length === 1 && computed.has(selected[0]) && (
                    <button
                      className="btn sm ghost"
                      onClick={() => void computeNew(selected[0])}
                      title={`Edit the formula: ${computed.get(selected[0])!.expr}`}
                    >
                      Edit formula…
                    </button>
                  )}
                  {selected.some((n) => computed.has(n)) && (
                    <button
                      className="btn sm ghost"
                      onClick={() => void removeSelectedComputed()}
                      title="Remove the computed column(s) and their formulas"
                    >
                      Remove computed
                    </button>
                  )}
                </div>
              )}
              <div className="var-list" role="listbox" aria-multiselectable="true">
                {visible.map((v) => (
                  <div
                    key={v.name}
                    role="option"
                    aria-selected={selected.includes(v.name)}
                    className={`var${selected.includes(v.name) ? ' sel' : ''}`}
                    draggable
                    onDragStart={(e) => onDragStart(e, v.name)}
                    onClick={(e) => onClick(e, v.name)}
                    title={
                      Number.isNaN(v.mean)
                        ? `sd ${v.sd.toFixed(2)}`
                        : `mean ${v.mean.toFixed(2)} · sd ${v.sd.toFixed(2)} · missing ${v.missing}`
                    }
                  >
                    <span className="vname">
                      {v.name}
                      {computed.has(v.name) && (
                        <span
                          className="comp-mark"
                          title={`Computed: ${computed.get(v.name)!.expr}`}
                        >
                          {' '}
                          ƒ
                        </span>
                      )}
                      {reversed.has(v.name) && (
                        <span
                          className="rev-mark"
                          title={`Reverse-coded on ${reversed.get(v.name)!.min}–${reversed.get(v.name)!.max}`}
                        >
                          {' '}
                          (R)
                        </span>
                      )}
                    </span>
                    {owner.has(v.name) ? (
                      <span className="chip accent">{owner.get(v.name)}</span>
                    ) : data.categories?.[v.name] ? (
                      <span
                        className="chip"
                        title={data.categories[v.name].map((l, k) => `${k + 1} = ${l}`).join('\n')}
                      >
                        text · {data.categories[v.name].length}
                      </span>
                    ) : (
                      <span className="vstat">
                        {Number.isNaN(v.mean) ? `sd ${v.sd.toFixed(2)}` : v.mean.toFixed(2)}
                      </span>
                    )}
                  </div>
                ))}
                {visible.length === 0 && <div className="hint">No matching variables.</div>}
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
