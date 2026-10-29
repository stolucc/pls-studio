import { useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { mean, sd } from '../engine/stats';
import { importCsv, loadSample } from '../io';
import { useStore } from '../store';
import { VARS_MIME } from './dnd';
import { useDataView } from './DataViewer';
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
      return data.names.map((name, i) => ({ name, mean: NaN, sd: Math.sqrt(data.moments!.S[i][i]), missing: 0 }));
    }
    return data.names.map((name, i) => {
      const present = data.cols[i].filter((v) => !Number.isNaN(v));
      return { name, mean: mean(present), sd: sd(present), missing: data.cols[i].length - present.length };
    });
  }, [data]);

  const visible = stats.filter((v) =>
    v.name.toLowerCase().includes(query.trim().toLowerCase()) && (filter === 'all' || !owner.has(v.name)));

  const onClick = (e: MouseEvent, name: string) => {
    if (e.shiftKey && anchor.current) {
      const names = visible.map((v) => v.name);
      const a = names.indexOf(anchor.current), b = names.indexOf(name);
      if (a >= 0 && b >= 0) {
        const range = names.slice(Math.min(a, b), Math.max(a, b) + 1);
        setSelected([...new Set([...selected, ...range])]);
        return;
      }
    }
    anchor.current = name;
    if (e.metaKey || e.ctrlKey) setSelected(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);
    else setSelected([name]);
  };

  const onDragStart = (e: DragEvent, name: string) => {
    const names = selected.includes(name) ? visible.map((v) => v.name).filter((n) => selected.includes(n)) : [name];
    if (!selected.includes(name)) setSelected([name]);
    e.dataTransfer.setData(VARS_MIME, JSON.stringify(names));
    e.dataTransfer.setData('text/plain', names.join(', '));
    e.dataTransfer.effectAllowed = 'copy';
  };

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
          <span style={{ display: 'flex', gap: 4 }}>
            <button className="btn sm ghost" onClick={() => useDataView.getState().setOpen(true)} title="See the rows and descriptive statistics of the dataset"><IconEye size={13} /> Inspect</button>
            <button className="btn sm ghost" onClick={() => void importCsv()} title="Replace dataset"><IconUpload size={13} /> Replace</button>
          </span>
        )}
      </div>
      <div className="panel-body">
        {!data || !info ? (
          <div
            className={`dropzone${over ? ' over' : ''}`}
            onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
            onDragLeave={() => setOver(false)}
            onDrop={onFileDrop}
          >
            <IconUpload size={20} />
            <div>Drop a CSV file here</div>
            <button className="btn primary" onClick={() => void importCsv()}>Choose file</button>
            <div style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
              <span className="hint">or load an example</span>
              <button className="btn ghost sm" onClick={() => void loadSample('customer')}>Customer survey (PLS, raw data)</button>
              <button className="btn ghost sm" onClick={() => void loadSample('emse')}>Gamification in SE · Stol et al. 2022 (CB-SEM, matrix)</button>
            </div>
            <div className="hint">Comma, semicolon or tab separated, with a header row. Empty cells, NA and “.” count as missing. Data stays in your browser.</div>
          </div>
        ) : (
          <>
            <div className="section">
              <div className="data-meta">
                <span>File</span><b title={info.fileName} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.fileName}</b>
                {info.kind === 'matrix' && <><span>Type</span><b>covariance matrix{info.hasNacov ? ' + NACOV' : ''}</b></>}
                <span>{info.kind === 'matrix' ? 'Sample size N' : 'Observations'}</span><b>{info.rows}</b>
                <span>Variables</span><b>{data.names.length}</b>
                {info.kind !== 'matrix' && <><span>Missing values</span><b>{info.missingCells}</b></>}
              </div>
              {info.excluded.length > 0 && (
                <div className="hint" style={{ marginTop: 8 }}>
                  Skipped: {info.excluded.map((e) => e.name).join(', ')} (non-numeric)
                </div>
              )}
            </div>
            <div className="section">
              <input className="input" placeholder="Filter variables…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <div className="segmented" style={{ marginTop: 8 }}>
                <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All ({stats.length})</button>
                <button className={filter === 'free' ? 'on' : ''} onClick={() => setFilter('free')}>Unassigned ({stats.filter((v) => !owner.has(v.name)).length})</button>
              </div>
              <div className="hint" style={{ margin: '8px 0 2px' }}>Shift/⌘-click to select several, then drag onto the canvas or a construct.</div>
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
                    title={Number.isNaN(v.mean) ? `sd ${v.sd.toFixed(2)}` : `mean ${v.mean.toFixed(2)} · sd ${v.sd.toFixed(2)} · missing ${v.missing}`}
                  >
                    <span className="vname">{v.name}</span>
                    {owner.has(v.name)
                      ? <span className="chip accent">{owner.get(v.name)}</span>
                      : <span className="vstat">{Number.isNaN(v.mean) ? `sd ${v.sd.toFixed(2)}` : v.mean.toFixed(2)}</span>}
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
