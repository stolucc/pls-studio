import { useEffect, useMemo, useState } from 'react';
import { columnSummary } from '../data/summary';
import { fmt } from '../format';
import { useStore } from '../store';
import { c, Table } from './results/Table';
import { FilterBadge } from './FilterBadge';
import { VariablesView } from './VariablesView';
import { labelOf } from '../data/columns';
import { ComputeDialog } from './ComputeDialog';
import { ReverseCodeDialog } from './ReverseCodeDialog';

const PAGE = 100;
const num = (v: number, d?: number) => c(Number.isFinite(v) ? v : null, undefined, d);
function cell(v: number) {
  if (Number.isNaN(v)) return <span className="na">NA</span>;
  if (Number.isInteger(v)) return String(v);
  return fmt(v, 4);
}

/** The Data tab: the dataset itself, its rows (paged) and descriptive statistics per variable. */
export function DataWorkspace() {
  const data = useStore((s) => s.data);
  const info = useStore((s) => s.dataInfo);
  const owner = useStore((s) => s.model.constructs);
  const [tab, setTab] = useState<'rows' | 'summary' | 'variables'>('rows');
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  // The data operations of the header: a computed column, reverse-coding.
  const [dialog, setDialog] = useState<'compute' | 'reverse' | null>(null);
  useEffect(() => {
    setPage(0);
  }, [data]);
  const summaries = useMemo(
    () => (tab === 'summary' && data && data.cols.length ? data.cols.map(columnSummary) : []),
    [tab, data],
  );
  const matrix = !!data?.moments && data.cols.length === 0;
  const groups = data?.moments?.groups;
  const [group, setGroup] = useState(-1); // -1: pooled
  // The chosen group's moments, or the pooled ones.
  const chosen = groups && group >= 0 && group < groups.length ? groups[group] : data?.moments;
  const shownS = chosen?.S;
  const shownN = chosen?.n;
  const shownMeans = chosen?.means;
  const rows = data && !matrix ? (data.cols[0]?.length ?? 0) : 0;
  const pages = Math.max(1, Math.ceil(rows / PAGE));
  const q = query.trim().toLowerCase();
  const shown = data
    ? data.names.map((n, i) => [n, i] as const).filter(([n]) => n.toLowerCase().includes(q))
    : [];
  const assigned = new Map(owner.flatMap((k) => k.indicators.map((i) => [i, k.name] as const)));
  let datasetLine = 'no dataset';
  if (info) {
    let size = `${info.rows} rows`;
    if (matrix)
      size = groups
        ? `${groups.length} covariance matrices, N = ${info.rows}`
        : `covariance matrix, N = ${info.rows}`;
    datasetLine = `${info.fileName} · ${size} · ${data?.names.length ?? 0} variables`;
  }
  return (
    <section className="data-workspace" role="tabpanel" id="ws-data" aria-labelledby="ws-tab-data">
      <header className="sim-head">
        <div>
          <b>Data</b>
          <span className="muted">{datasetLine}</span>
        </div>
        <div className="data-actions">
          {data && !matrix && (
            <>
              <button
                className="btn sm"
                onClick={() => setDialog('compute')}
                title="Add a column computed from a formula over the existing columns (log, z-score, sums, reverse(x, 1, 5)…)"
              >
                ƒ Compute…
              </button>
              <button
                className="btn sm"
                onClick={() => setDialog('reverse')}
                title="For negatively worded items: on a 1–5 scale, 1 becomes 5 and 5 becomes 1"
              >
                ⇅ Reverse-code…
              </button>
            </>
          )}
          <FilterBadge />
        </div>
      </header>
      {dialog === 'compute' && <ComputeDialog onClose={() => setDialog(null)} />}
      {dialog === 'reverse' && <ReverseCodeDialog onClose={() => setDialog(null)} />}
      {!data ? (
        <div className="empty-results">
          No dataset yet: import a CSV file or load an example from the Data panel on the left.
        </div>
      ) : (
        <div className="data-view">
          <div className="table-tools">
            {!matrix && (
              <div className="segmented" style={{ width: 320 }}>
                <button className={tab === 'rows' ? 'on' : ''} onClick={() => setTab('rows')}>
                  Rows
                </button>
                <button
                  className={tab === 'variables' ? 'on' : ''}
                  onClick={() => setTab('variables')}
                  title="Measurement levels and value labels of the columns"
                >
                  Variables
                </button>
                <button className={tab === 'summary' ? 'on' : ''} onClick={() => setTab('summary')}>
                  Descriptives
                </button>
              </div>
            )}
            {groups && (
              <select
                className="select"
                style={{ maxWidth: 260 }}
                value={group}
                onChange={(e) => setGroup(Number(e.target.value))}
                aria-label="Group"
              >
                <option value={-1}>All groups pooled (N = {data.moments!.n})</option>
                {groups.map((g, i) => (
                  <option key={g.label} value={i}>
                    {g.label} (N = {g.n})
                  </option>
                ))}
              </select>
            )}
            <input
              className="input"
              style={{ maxWidth: 220 }}
              placeholder="Filter variables…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="spacer" />
            {!matrix && tab === 'rows' && (
              <div className="pager">
                <button
                  className="btn sm ghost"
                  disabled={page === 0}
                  onClick={() => setPage(page - 1)}
                  aria-label="Previous rows"
                >
                  ‹
                </button>
                <span className="muted">
                  rows {page * PAGE + 1}–{Math.min(rows, (page + 1) * PAGE)} of {rows}
                </span>
                <button
                  className="btn sm ghost"
                  disabled={page >= pages - 1}
                  onClick={() => setPage(page + 1)}
                  aria-label="Next rows"
                >
                  ›
                </button>
              </div>
            )}
          </div>
          {info && info.excluded.length > 0 && (
            <div className="hint">
              Not imported (non-numeric): {info.excluded.map((e) => e.name).join(', ')}.
            </div>
          )}
          {matrix ? (
            <Table
              title={
                groups && group >= 0
                  ? `Covariance matrix: ${groups[group].label}`
                  : groups
                    ? 'Covariance matrix (pooled within groups)'
                    : 'Covariance matrix'
              }
              file="covariances"
              columns={['', ...shown.map(([n]) => n)]}
              rows={[
                ...(shownMeans
                  ? [[c('mean', 'dim'), ...shown.map(([, i]) => num(shownMeans[i]))]]
                  : []),
                ...shown.map(([n, i]) => [c(n), ...shown.map(([, j]) => num(shownS![i][j]))]),
              ]}
              note={
                groups
                  ? `Summary-statistics data of ${groups.length} groups (${groups.map((g) => `${g.label}: N = ${g.n}`).join('; ')}); the pooled matrix weights each group's by N − 1. There are no rows to show.`
                  : `Summary-statistics data: covariances (N = ${shownN}${data.moments!.nacov ? ', with NACOV' : ''}); there are no rows to show.`
              }
            />
          ) : tab === 'variables' && info ? (
            <VariablesView data={data} info={info} shown={shown} />
          ) : tab === 'rows' ? (
            <div className="data-grid-wrap">
              <table className="data-grid">
                <thead>
                  <tr>
                    <th className="rownum">#</th>
                    {shown.map(([n]) => (
                      <th key={n} title={assigned.has(n) ? `${n} → ${assigned.get(n)}` : n}>
                        {n}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from(
                    { length: Math.min(PAGE, rows - page * PAGE) },
                    (_, k) => page * PAGE + k,
                  ).map((r) => (
                    <tr key={r}>
                      <td className="rownum">{r + 1}</td>
                      {shown.map(([n, i]) => {
                        const v = data.cols[i][r];
                        const cats = data.categories?.[n];
                        if (cats)
                          return (
                            <td key={n} className="text">
                              {Number.isNaN(v) ? cell(v) : (cats[v - 1] ?? cell(v))}
                            </td>
                          );
                        // A value label is shown beside the value.
                        const label = Number.isNaN(v) ? null : labelOf(info, n, v);
                        return (
                          <td key={n} title={label ?? undefined}>
                            {cell(v)}
                            {label && <span className="value-label"> {label}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Table
              title="Descriptive statistics"
              file="descriptives"
              columns={[
                'Variable',
                'Construct',
                'n',
                'Missing',
                'Mean',
                'SD',
                'Min',
                'Q1',
                'Median',
                'Q3',
                'Max',
                'Distinct',
                'Skewness',
                'Excess kurtosis',
              ]}
              rows={shown.map(([n, i]) => {
                const s = summaries[i];
                // Text columns: their codes have no mean; count the categories only.
                if (data.categories?.[n])
                  return [
                    c(`${n} (text)`),
                    c(assigned.get(n) ?? ''),
                    num(s.n, 0),
                    num(s.missing, 0),
                    ...Array.from({ length: 7 }, () => c(null)),
                    num(s.distinct, 0),
                    c(null),
                    c(null),
                  ];
                return [
                  c(n),
                  c(assigned.get(n) ?? ''),
                  num(s.n, 0),
                  num(s.missing, 0),
                  num(s.mean),
                  num(s.sd),
                  num(s.min),
                  num(s.q1),
                  num(s.median),
                  num(s.q3),
                  num(s.max),
                  num(s.distinct, 0),
                  num(s.skew),
                  num(s.kurtosis),
                ];
              })}
              note="Text columns are categories coded 1, 2, … (hover the variable in the Data panel for the codes). Quartiles as R's quantile() (type 7). Skewness and excess kurtosis are moment estimators (type 1, as e1071 and psych::describe). Few distinct values hint at categorical or Likert items."
            />
          )}
        </div>
      )}
    </section>
  );
}
