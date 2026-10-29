import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { columnSummary } from '../data/summary';
import { fmt } from '../format';
import { useStore } from '../store';
import { IconX } from './icons';
import { c, Table } from './results/Table';

export const useDataView = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));

const PAGE = 100;
const num = (v: number, d?: number) => c(Number.isFinite(v) ? v : null, undefined, d);
const cell = (v: number) => (Number.isNaN(v) ? <span className="na">NA</span> : Number.isInteger(v) ? String(v) : fmt(v, 4));

/** The dataset itself: its rows (paged) and descriptive statistics per variable. */
export function DataViewer() {
  const open = useDataView((s) => s.open);
  const data = useStore((s) => s.data);
  const info = useStore((s) => s.dataInfo);
  const owner = useStore((s) => s.model.constructs);
  const [tab, setTab] = useState<'rows' | 'summary'>('rows');
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  useEffect(() => { setPage(0); }, [data]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useDataView.getState().setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const summaries = useMemo(() => (open && data && data.cols.length ? data.cols.map(columnSummary) : []), [open, data]);
  if (!open) return null;
  const close = () => useDataView.getState().setOpen(false);
  const matrix = !!data?.moments && data.cols.length === 0;
  const rows = data && !matrix ? data.cols[0]?.length ?? 0 : 0;
  const pages = Math.max(1, Math.ceil(rows / PAGE));
  const q = query.trim().toLowerCase();
  const shown = data ? data.names.map((n, i) => [n, i] as const).filter(([n]) => n.toLowerCase().includes(q)) : [];
  const assigned = new Map(owner.flatMap((k) => k.indicators.map((i) => [i, k.name] as const)));
  return (
    <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="Inspect data" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="sim">
        <header className="sim-head">
          <div><b>Data</b><span className="muted">{info ? `${info.fileName} · ${matrix ? `covariance matrix, N = ${info.rows}` : `${info.rows} rows`} · ${data?.names.length ?? 0} variables` : 'no dataset'}</span></div>
          <button className="btn icon ghost" onClick={close} aria-label="Close"><IconX /></button>
        </header>
        {!data ? <div className="empty-results">Import a dataset first.</div> : (
          <div className="data-view">
            <div className="table-tools">
              {!matrix && (
                <div className="segmented" style={{ width: 220 }}>
                  <button className={tab === 'rows' ? 'on' : ''} onClick={() => setTab('rows')}>Rows</button>
                  <button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>Descriptives</button>
                </div>
              )}
              <input className="input" style={{ maxWidth: 220 }} placeholder="Filter variables…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <div className="spacer" />
              {!matrix && tab === 'rows' && (
                <div className="pager">
                  <button className="btn sm ghost" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous rows">‹</button>
                  <span className="muted">rows {page * PAGE + 1}–{Math.min(rows, (page + 1) * PAGE)} of {rows}</span>
                  <button className="btn sm ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next rows">›</button>
                </div>
              )}
            </div>
            {info && info.excluded.length > 0 && <div className="hint">Not imported (non-numeric): {info.excluded.map((e) => e.name).join(', ')}.</div>}
            {matrix ? (
              <Table title="Covariance matrix" file="covariances" columns={['', ...shown.map(([n]) => n)]}
                rows={shown.map(([n, i]) => [c(n), ...shown.map(([, j]) => num(data.moments!.S[i][j]))])}
                note={`Summary-statistics data: covariances (N = ${data.moments!.n}${data.moments!.nacov ? ', with NACOV' : ''}); there are no rows to show.`} />
            ) : tab === 'rows' ? (
              <div className="data-grid-wrap">
                <table className="data-grid">
                  <thead><tr><th className="rownum">#</th>{shown.map(([n]) => <th key={n} title={assigned.has(n) ? `${n} → ${assigned.get(n)}` : n}>{n}</th>)}</tr></thead>
                  <tbody>
                    {Array.from({ length: Math.min(PAGE, rows - page * PAGE) }, (_, k) => page * PAGE + k).map((r) => (
                      <tr key={r}><td className="rownum">{r + 1}</td>{shown.map(([n, i]) => <td key={n}>{cell(data.cols[i][r])}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Table title="Descriptive statistics" file="descriptives"
                columns={['Variable', 'Construct', 'n', 'Missing', 'Mean', 'SD', 'Min', 'Q1', 'Median', 'Q3', 'Max', 'Distinct', 'Skewness', 'Excess kurtosis']}
                rows={shown.map(([n, i]) => { const s = summaries[i]; return [c(n), c(assigned.get(n) ?? ''), num(s.n, 0), num(s.missing, 0), num(s.mean), num(s.sd), num(s.min), num(s.q1), num(s.median), num(s.q3), num(s.max), num(s.distinct, 0), num(s.skew), num(s.kurtosis)]; })}
                note="Quartiles as R's quantile() (type 7). Skewness and excess kurtosis are moment estimators (type 1, as e1071 and psych::describe). Few distinct values hint at categorical or Likert items." />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
