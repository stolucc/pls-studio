import { useState } from 'react';
import type { CbEstimator } from '../../engine/cbsem';
import type { PlsResult } from '../../engine/types';
import { toSpec } from '../../model/project';
import { scoreColumns } from '../../rengine/lavaan';
import { useStore } from '../../store';

const toast = (kind: 'success' | 'error', text: string) => useStore.getState().toast(kind, text);
const added = (before: number, names: string[]) => `Saved as data columns: ${names.slice(before).join(', ')}.`;

/** PLS construct scores (standardised) as new data columns. */
export function SavePlsScores({ pls }: { pls: PlsResult }) {
  const data = useStore((s) => s.data), info = useStore((s) => s.dataInfo);
  const rows = data?.cols[0]?.length ?? 0;
  const ok = !!data && !!info && pls.n === rows;
  const save = () => {
    if (!data || !info) return;
    const d = scoreColumns(data, pls.constructs, Array.from({ length: rows }, (_, i) => i + 1), pls.scores.map((c) => Array.from(c)));
    useStore.getState().setData(d, info);
    toast('success', added(data.names.length, d.names));
  };
  return (
    <button className="btn" disabled={!ok} onClick={save}
      title={ok ? 'Add the standardised construct scores as data columns (e.g. for the analyses on the Analyses tab)' : 'Rows were left out (missing values), so the scores cannot be matched to rows; use mean replacement'}>
      Save scores as data columns
    </button>
  );
}

/** CB-SEM factor scores (lavaan::lavPredict) as new data columns. */
export function SaveFactorScores() {
  const data = useStore((s) => s.data), info = useStore((s) => s.dataInfo);
  const model = useStore((s) => s.model), settings = useStore((s) => s.settings);
  const [method, setMethod] = useState<'regression' | 'Bartlett'>('regression');
  const [busy, setBusy] = useState(false);
  if (!data || !info || data.moments) return null;
  const save = async () => {
    setBusy(true);
    try {
      const { cbScoresR } = await import('../../rengine/lavaan');
      const r = await cbScoresR(data, toSpec(model), settings.missing, settings.estimator as CbEstimator, method);
      r.warnings.forEach((w) => useStore.getState().logMessage('warning', w, `lavaan ${r.engine.version}`));
      const fresh = useStore.getState();
      if (!fresh.data || !fresh.dataInfo) return;
      const d = scoreColumns(fresh.data, r.names, r.rows, r.scores);
      fresh.setData(d, fresh.dataInfo);
      const missing = (fresh.data.cols[0]?.length ?? 0) - r.rows.length;
      toast('success', `${added(fresh.data.names.length, d.names)}${missing > 0 ? ` ${missing} rows left out of the analysis have no score.` : ''}`);
    } catch (e) {
      const { rMessage } = await import('../../rengine/bridge');
      toast('error', `lavaan: ${rMessage(e)}`);
    } finally { setBusy(false); }
  };
  return (
    <div className="table-tools" style={{ gap: 8 }}>
      <span className="muted">Factor scores</span>
      <div className="segmented" style={{ width: 210 }}>
        <button className={method === 'regression' ? 'on' : ''} onClick={() => setMethod('regression')} title="Thurstone's regression scores (as AMOS's factor score imputation)">Regression</button>
        <button className={method === 'Bartlett' ? 'on' : ''} onClick={() => setMethod('Bartlett')} title="Bartlett's scores (unbiased; correlate as the factors do less closely)">Bartlett</button>
      </div>
      <button className="btn sm" disabled={busy} onClick={() => void save()} title="lavaan::lavPredict: one column per latent construct, e.g. for polynomial regression or matching">
        {busy ? 'Computing…' : 'Save as data columns'}
      </button>
    </div>
  );
}
