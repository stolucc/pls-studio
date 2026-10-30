import { useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { mean, sd } from '../engine/stats';
import { observedRange, reverseCode } from '../data/recode';
import { importCsv, loadSample } from '../io';
import { textDialog } from './Overlays';
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

  const reversed = new Map((info?.reversed ?? []).map((r) => [r.name, r]));
  /** Reverse-code the selected items on a scale the user confirms (defaults to the observed range). */
  const reverseSelected = async () => {
    if (!data || !info) return;
    const names = visible.map((v) => v.name).filter((n) => selected.includes(n));
    const done = names.filter((n) => reversed.has(n));
    const known = done.length === names.length && new Set(done.map((n) => `${reversed.get(n)!.min},${reversed.get(n)!.max}`)).size === 1 ? reversed.get(done[0]) : undefined;
    const range = known ? [known.min, known.max] : observedRange(data, names);
    const parse = (t: string) => { const m = t.split(/[\s,;–-]+/).filter(Boolean).map(Number); return m.length === 2 && m.every(Number.isFinite) && m[0] < m[1] ? m : null; };
    const text = await textDialog({
      title: done.length === names.length ? `Undo the reverse-coding of ${names.length === 1 ? names[0] : `${names.length} items`}?` : `Reverse-code ${names.length === 1 ? names[0] : `${names.length} items`}?`,
      body: `Each value x becomes lowest + highest − x on the answer scale (on 1–5: 1 ↔ 5, 2 ↔ 4), for negatively worded items. Doing it again on the same scale undoes it.${names.length > 1 ? ` Items: ${names.join(', ')}.` : ''}`,
      confirmLabel: done.length === names.length ? 'Undo' : 'Reverse-code',
      text: { label: 'Answer scale: lowest, highest', initial: range ? `${range[0]}, ${range[1]}` : '1, 5', check: (t) => (parse(t) ? null : 'Enter the lowest and highest value of the scale, e.g. 1, 5.') },
    });
    if (text === null) return;
    const [min, max] = parse(text)!;
    try {
      const r = reverseCode(data, info, names, min, max);
      useStore.getState().setData(r.data, r.info);
      const changed = names.filter((n) => !r.undone.includes(n));
      useStore.getState().toast('success', [changed.length ? `Reverse-coded ${changed.join(', ')} (${min}–${max}).` : '', r.undone.length ? `Back to the original coding: ${r.undone.join(', ')}.` : ''].filter(Boolean).join(' '));
    } catch (e) {
      useStore.getState().toast('error', (e as Error).message);
    }
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
            <button className="btn sm ghost" onClick={() => useStore.getState().setWorkspace('data')} title="See the rows and descriptive statistics of the dataset"><IconEye size={13} /> Inspect</button>
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
            <div className="hint">Comma, semicolon or tab separated, with a header row. Empty cells, NA and “.” count as missing; text columns with few values (groups, cluster ids) become categories. Data stays in your browser.</div>
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
              {info.droppedRows?.length ? (
                <div className="hint" style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span>Excluded: {info.droppedRows.reduce((n, d) => n + d.at.length, 0)} cases ({[...new Set(info.droppedRows.map((d) => d.reason))].join('; ')})</span>
                  <button className="btn sm" onClick={() => void import('../model/rows').then(({ restoreRows }) => {
                    const s = useStore.getState();
                    if (!s.data || !s.dataInfo) return;
                    const r = restoreRows(s.data, s.dataInfo);
                    s.setData(r.data, r.info);
                    s.toast('success', 'The excluded cases are back in the dataset.');
                  })}>Restore</button>
                </div>
              ) : null}
              {info.excluded.length > 0 && (
                <div className="hint" style={{ marginTop: 8 }}>
                  Skipped: {info.excluded.map((e) => `${e.name} (${e.reason})`).join(', ')}
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
              {selected.length > 0 && info.kind !== 'matrix' && (
                <div className="selection-bar">
                  <span className="muted">{selected.length} selected</span>
                  <button className="btn sm ghost" onClick={() => void reverseSelected()} title="For negatively worded items: x becomes lowest + highest − x on the answer scale">Reverse-code…</button>
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
                    title={Number.isNaN(v.mean) ? `sd ${v.sd.toFixed(2)}` : `mean ${v.mean.toFixed(2)} · sd ${v.sd.toFixed(2)} · missing ${v.missing}`}
                  >
                    <span className="vname">{v.name}{reversed.has(v.name) && <span className="rev-mark" title={`Reverse-coded on ${reversed.get(v.name)!.min}–${reversed.get(v.name)!.max}`}> (R)</span>}</span>
                    {owner.has(v.name)
                      ? <span className="chip accent">{owner.get(v.name)}</span>
                      : data.categories?.[v.name]
                        ? <span className="chip" title={data.categories[v.name].map((l, k) => `${k + 1} = ${l}`).join('\n')}>text · {data.categories[v.name].length}</span>
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
