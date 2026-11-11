import { isValidElement, type ReactNode } from 'react';
import { toLatex } from '../../latex';
import { registerTable } from '../../report/tableRegistry';
import { copyText, csvCell, downloadText, fmt, fmtP, safeFileName, stars } from '../../format';
import type { BootstrapResult, BootstrapStat } from '../../engine/types';
import { useStore } from '../../store';
import { IconCopy, IconDownload } from '../icons';

export type Cell = {
  v: number | string | null;
  cls?: string;
  d?: number;
  bold?: boolean;
  /** background (shading, e.g. a correlation's size) */ bg?: string;
};
export type Row = Cell[];
export const c = (v: number | string | null, cls?: string, d?: number): Cell => ({ v, cls, d });

export function Table({
  title,
  columns,
  rows,
  note,
  file,
}: {
  title: string;
  columns: string[];
  rows: Row[];
  note?: ReactNode;
  file: string;
}) {
  const toast = useStore((s) => s.toast);
  const project = useStore((s) => s.projectName);
  const raw = (cell: Cell) => (cell.v === null ? '' : String(cell.v));
  const copy = async () => {
    const tsv = [columns, ...rows.map((r) => r.map(raw))].map((r) => r.join('\t')).join('\n');
    const ok = await copyText(tsv);
    toast(
      ok ? 'success' : 'error',
      ok ? 'Table copied. Paste it into Excel or Word.' : 'Clipboard access was blocked.',
    );
  };
  const csv = () => {
    const text = [columns, ...rows.map((r) => r.map(raw))]
      .map((r) => r.map(csvCell).join(','))
      .join('\n');
    downloadText(`${safeFileName(project)}-${file}.csv`, text, 'text/csv');
  };
  const latex = async () => {
    const tex = toLatex({
      title,
      label: file,
      columns,
      rows: rows.map((r) => r.map((cell) => ({ v: cell.v, d: cell.d }))),
      note: textOf(note),
    });
    downloadText(`${safeFileName(project)}-${file}.tex`, tex, 'application/x-tex');
    const ok = await copyText(tex);
    toast(
      'success',
      `LaTeX table saved${ok ? ' and copied' : ''}. It uses the booktabs package (\\usepackage{booktabs}).`,
    );
  };
  // The report reads the table's values from here (report/tableRegistry.ts).
  const register = (el: HTMLTableElement | null) => {
    if (!el) return;
    registerTable(el, {
      title,
      columns,
      rows: rows.map((r) => r.map((cell) => ({ v: cell.v, d: cell.d, bold: cell.bold }))),
      note: textOf(note),
    });
  };
  return (
    <div>
      <div className="table-tools">
        <h3>{title}</h3>
        <button
          className="btn sm ghost"
          onClick={() => void copy()}
          title="Copy as tab-separated text"
        >
          <IconCopy size={13} /> Copy
        </button>
        <button className="btn sm ghost" onClick={csv} title="Download CSV">
          <IconDownload size={13} /> CSV
        </button>
        <button
          className="btn sm ghost"
          onClick={() => void latex()}
          title="LaTeX table (booktabs: \\toprule, \\midrule, \\bottomrule): downloaded and copied"
        >
          <IconDownload size={13} /> LaTeX
        </button>
      </div>
      <table className="grid" ref={register}>
        <thead>
          <tr>
            {columns.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, k) => (
                <td
                  key={k}
                  className={`${typeof cell.v === 'number' ? 'num ' : ''}${cell.cls ?? ''}`}
                  style={cellStyle(cell)}
                >
                  {typeof cell.v === 'number' ? fmt(cell.v, cell.d ?? 3) : (cell.v ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <div className="table-note">{note}</div>}
    </div>
  );
}

/** Inline style of a bold or shaded cell; none for a plain one. */
function cellStyle(cell: Cell) {
  if (!cell.bold && !cell.bg) return undefined;
  return {
    ...(cell.bold ? { fontWeight: 600 } : {}),
    ...(cell.bg ? { background: cell.bg } : {}),
  };
}

/** Plain text of a table note (string or simple JSX), for exports. */
function textOf(node: ReactNode): string | undefined {
  const walk = (n: ReactNode): string => {
    if (n === null || n === undefined || typeof n === 'boolean') return '';
    if (typeof n === 'string' || typeof n === 'number') return String(n);
    if (Array.isArray(n)) return n.map(walk).join('');
    if (isValidElement<{ children?: ReactNode }>(n)) return walk(n.props.children);
    return '';
  };
  const s = walk(node).replace(/\s+/g, ' ').trim();
  return s || undefined;
}

/** Reliability: .70 to .95 is good; above .95 (redundant items) or .60 to .70 is a warning. */
export function relCls(v: number): string {
  if (v > 0.95) return 'warn';
  if (v >= 0.7) return 'good';
  if (v >= 0.6) return 'warn';
  return 'bad';
}
/** A reflective loading: at least .708 is good, .40 to .708 a warning, below .40 bad. */
export function loadingCls(loading: number): string {
  const size = Math.abs(loading);
  if (size >= 0.708) return 'good';
  if (size >= 0.4) return 'warn';
  return 'bad';
}
/** Collinearity: a VIF above 5 is critical, above 3 a warning. */
export function vifCls(vif: number): string {
  if (vif > 5) return 'bad';
  if (vif > 3) return 'warn';
  return '';
}
export const pCls = (p: number) => (p < 0.05 ? 'good' : 'dim');
export const pCell = (p: number | null): Cell =>
  p === null ? c(null) : { v: `${fmtP(p)} ${stars(p)}`, cls: pCls(p) };

export function bootCells(s: BootstrapStat | undefined): Row {
  if (!s) return [c(null), c(null), c(null), c(null), c(null), c(null)];
  return [c(s.mean), c(s.sd), c(s.t), pCell(s.p), c(s.ciLow), c(s.ciHigh)];
}
export function bootCols(b: BootstrapResult): string[] {
  const oneTailed = b.tails === 1;
  let interval = '';
  if (b.interval === 'bca') interval = ' (BCa)';
  else if (b.interval === 'studentized') interval = ' (studentized)';
  const ciLow = `${Math.round(b.confidence * 100)}% CI low${interval}${oneTailed ? ' (one-sided)' : ''}`;
  return ['Sample mean', 'Std. error', 't', oneTailed ? 'p (one-tailed)' : 'p', ciLow, 'CI high'];
}

/** Lower-triangular matrix table (HTMT, correlations). */
export function matrixRows(
  names: string[],
  get: (i: number, j: number) => number | null,
  cls?: (v: number, i: number, j: number) => string,
): Row[] {
  return names.map((name, i) => [
    c(name),
    ...names.map((_, j) => {
      const v = j > i ? null : get(i, j);
      return v === null ? c(null, 'dim') : c(v, cls?.(v, i, j) ?? '');
    }),
  ]);
}

/** HTMT above .90 is bad, above .85 a warning (the stricter cut-off). */
export function htmtCls(v: number): string {
  if (v > 0.9) return 'bad';
  if (v > 0.85) return 'warn';
  return '';
}
