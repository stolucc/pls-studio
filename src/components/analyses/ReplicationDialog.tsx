import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { packageItems, type DataSharing, type PackageItem } from '../../replication/package';
import { covarianceOnlyBlocked } from '../../io';
import { useStore } from '../../store';

/** Whether the replication package dialog is open (from the Analyses tab or the File menu). */
export const useReplication = create<{ open: boolean }>(() => ({ open: false }));
export const openReplication = () => {
  useStore.getState().setWorkspace('analyses');
  useReplication.setState({ open: true });
};

/** Choose what goes into the replication package, then build and download it. */
export function ReplicationDialog() {
  const open = useReplication((s) => s.open);
  const hasData = useStore((s) => !!s.data);
  const [items, setItems] = useState<PackageItem[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [data, setData] = useState<DataSharing>('full');
  const rawCb = useStore(
    (s) =>
      !!s.data && !(s.data.moments && s.data.cols.length === 0) && s.settings.method === 'cbsem',
  );
  const [covWhy, setCovWhy] = useState<string | null>(null);
  const [report, setReport] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const list = packageItems();
    setItems(list);
    setChosen(new Set(list.map((i) => i.id)));
    setError(null);
    setBusy(null);
    setData('full');
    setCovWhy(rawCb ? covarianceOnlyBlocked() : null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) useReplication.setState({ open: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, rawCb]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const close = () => {
    if (!busy) useReplication.setState({ open: false });
  };
  const toggle = (id: string) =>
    setChosen((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const create_ = async () => {
    setError(null);
    try {
      const { createPackage } = await import('../../replication/package');
      const r = await createPackage(chosen, { data: hasData ? data : 'none', report }, setBusy);
      useStore
        .getState()
        .toast(
          'success',
          `Replication package saved: ${r.scripts} R script${r.scripts === 1 ? '' : 's'}, ${r.files.length} files.`,
        );
      useReplication.setState({ open: false });
    } catch (e) {
      const { rMessage } = await import('../../rengine/bridge');
      setError(rMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal replication"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rep-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 id="rep-title">Create replication package</h3>
        <p className="hint" style={{ marginTop: 0 }}>
          A zip with the data, an R script for each chosen analysis (self-contained, with seeds), a
          script that runs them all, the PLS Studio project and a README listing the R and package
          versions.
        </p>
        <div className="rep-list">
          {items.length === 0 && (
            <div className="muted">Nothing to include yet: draw a model or add analyses.</div>
          )}
          {items.map((it) => (
            <label key={it.id} className="check">
              <input
                type="checkbox"
                checked={chosen.has(it.id)}
                onChange={() => toggle(it.id)}
                disabled={!!busy}
              />
              <span>
                {it.title}
                <br />
                <span className="hint">
                  {it.detail}
                  {it.scriptable
                    ? ''
                    : ' · computed in PLS Studio, no R script (described in the README)'}
                </span>
              </span>
            </label>
          ))}
        </div>
        {rawCb ? (
          <div className="field">
            <label>The data</label>
            <div className="segmented">
              <button
                className={data === 'full' ? 'on' : ''}
                disabled={!!busy}
                onClick={() => setData('full')}
              >
                Full dataset
              </button>
              <button
                className={data === 'covariance' ? 'on' : ''}
                disabled={!!busy || !!covWhy}
                title={
                  covWhy ??
                  'The covariance matrix of the model’s indicators and N: lavaan refits the model from them'
                }
                onClick={() => setData('covariance')}
              >
                Covariance matrix only
              </button>
              <button
                className={data === 'none' ? 'on' : ''}
                disabled={!!busy}
                onClick={() => setData('none')}
              >
                No data
              </button>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>
              {data === 'covariance'
                ? 'For publication without sharing the raw data: the covariance matrix of the model’s indicators (listwise, N − 1) and N go into the package, the project file and the model’s script; lavaan reproduces the estimation exactly. The bootstrap and the analysis cards need cases, so they are listed in the README as not included.'
                : data === 'full'
                  ? 'The dataset as CSV, and in the project file.'
                  : 'Scripts without data: they will not run as they are.'}
              {covWhy && data !== 'covariance' && (
                <> Covariance matrix only is unavailable: {covWhy}</>
              )}
            </div>
          </div>
        ) : (
          <label className="check">
            <input
              type="checkbox"
              checked={data !== 'none' && hasData}
              disabled={!hasData || !!busy}
              onChange={(e) => setData(e.target.checked ? 'full' : 'none')}
            />
            <span>The data (CSV, and in the project file)</span>
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={report}
            disabled={!!busy}
            onChange={(e) => setReport(e.target.checked)}
          />
          <span>The HTML report of the Analyses tab</span>
        </label>
        {error && (
          <div className="card-bar bad" role="alert">
            {error}
          </div>
        )}
        {busy && <div className="hint">{busy}</div>}
        <div className="actions">
          <button className="btn" onClick={close} disabled={!!busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!!busy || chosen.size === 0}
            onClick={() => void create_()}
          >
            {busy ? 'Creating…' : 'Create zip'}
          </button>
        </div>
      </div>
    </div>
  );
}
