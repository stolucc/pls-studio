import { useEffect, useState } from 'react';
import { create } from 'zustand';
import {
  DEFAULT_REPORT_OPTIONS,
  MAX_DATA_ROWS,
  type ReportFormat,
  type ReportOptions,
} from '../../report/options';
import { useStore } from '../../store';

/** Whether the report dialog is open (from the Analyses tab or the File menu). */
export const useReportDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openReportDialog = () => {
  useStore.getState().setWorkspace('analyses');
  useReportDialog.setState({ open: true });
};

const PARTS: { key: keyof ReportOptions; label: string; hint: string }[] = [
  { key: 'diagram', label: 'Model diagram', hint: 'The path diagram, as in the figure export' },
  {
    key: 'modelResults',
    label: 'Model results',
    hint: 'Fit, estimates and quality criteria of the current model: every results tab',
  },
  {
    key: 'log',
    label: 'Analysis log',
    hint: 'Every card in order: headings, notes, tables and charts',
  },
  {
    key: 'methods',
    label: 'Methods text and references',
    hint: 'The drafted methods paragraph and the works it cites',
  },
  { key: 'software', label: 'Software versions', hint: 'R, webR and the R packages used' },
];

/** Choose what goes into the report and its format, then build and download it. */
export function ReportDialog() {
  const open = useReportDialog((s) => s.open);
  const hasRows = useStore((s) => !!s.data && s.data.cols.length > 0);
  const [options, setOptions] = useState<ReportOptions>(DEFAULT_REPORT_OPTIONS);
  const [format, setFormat] = useState<ReportFormat>('html');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setError(null);
    setBusy(false);
    // Raw data are never included unless asked for, each time.
    setOptions((o) => ({ ...o, data: false }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useReportDialog.setState({ open: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const close = () => {
    if (!busy) useReportDialog.setState({ open: false });
  };
  const set = (key: keyof ReportOptions, value: boolean) => {
    setOptions((o) => ({ ...o, [key]: value }));
  };
  const nothing = !Object.values(options).some(Boolean);
  const create_ = async () => {
    setBusy(true);
    setError(null);
    try {
      const { exportReport } = await import('../../report/build');
      await exportReport(format, options);
      const what = format === 'html' ? 'HTML' : 'Word';
      useStore.getState().toast('success', `Report saved (${what}).`);
      useReportDialog.setState({ open: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal replication"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="report-title">Export report</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          The whole session as one document: tables as real tables, charts and the diagram as
          figures. HTML is a single self-contained file (opens in any browser, prints to PDF); Word
          is a .docx you can edit.
        </p>
        <div className="field">
          <label>Format</label>
          <div className="segmented" role="radiogroup" aria-label="Format">
            <button
              role="radio"
              aria-checked={format === 'html'}
              className={format === 'html' ? 'on' : ''}
              disabled={busy}
              onClick={() => setFormat('html')}
            >
              HTML
            </button>
            <button
              role="radio"
              aria-checked={format === 'docx'}
              className={format === 'docx' ? 'on' : ''}
              disabled={busy}
              onClick={() => setFormat('docx')}
            >
              Word (.docx)
            </button>
          </div>
        </div>
        <div className="rep-list">
          {PARTS.map((p) => (
            <label key={p.key} className="check">
              <input
                type="checkbox"
                checked={options[p.key]}
                disabled={busy}
                onChange={(e) => set(p.key, e.target.checked)}
              />
              <span>
                {p.label}
                <br />
                <span className="hint">{p.hint}</span>
              </span>
            </label>
          ))}
          <label className="check">
            <input
              type="checkbox"
              checked={options.data && hasRows}
              disabled={busy || !hasRows}
              onChange={(e) => set('data', e.target.checked)}
            />
            <span>
              The data
              <br />
              <span className="hint">
                The raw values as a table (at most {MAX_DATA_ROWS.toLocaleString()} cases). Off
                unless you tick it.
              </span>
            </span>
          </label>
        </div>
        {error && (
          <div className="card-bar bad" role="alert">
            {error}
          </div>
        )}
        <div className="actions">
          <button className="btn" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || nothing} onClick={() => void create_()}>
            {busy ? 'Creating…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
