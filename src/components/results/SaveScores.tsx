import { useState } from 'react';
import type { CbEstimator } from '../../engine/cbsem';
import type { PlsResult } from '../../engine/types';
import { toSpec } from '../../model/project';
import { scoreColumns, type FactorScores } from '../../rengine/lavaan';
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

/** CB-SEM factor scores (lavaan::lavPredict), with their standard errors, or plausible values (semTools), as new data columns. */
export function SaveFactorScores() {
  const data = useStore((s) => s.data), info = useStore((s) => s.dataInfo);
  const model = useStore((s) => s.model), settings = useStore((s) => s.settings);
  const [method, setMethod] = useState<FactorScores['method']>('regression');
  const [withSe, setWithSe] = useState(false);
  const [draws, setDraws] = useState(5);
  const [busy, setBusy] = useState(false);
  if (!data || !info || data.moments) return null;
  const save = async () => {
    setBusy(true);
    try {
      const { cbScoresR } = await import('../../rengine/lavaan');
      const r = await cbScoresR(data, toSpec(model), settings.missing, settings.estimator as CbEstimator, method, { se: withSe, draws, seed: settings.seed });
      r.warnings.forEach((w) => useStore.getState().logMessage('warning', w, `${r.engine.package} ${r.engine.version}`));
      const fresh = useStore.getState();
      if (!fresh.data || !fresh.dataInfo) return;
      let d = fresh.data;
      if (r.draws) {
        // Factor by factor: F_pv1 … F_pvM, then the next factor.
        r.names.forEach((name, j) => r.draws!.forEach((draw, k) => { d = scoreColumns(d, [name], r.rows, [draw[j]], `_pv${k + 1}`); }));
      } else {
        d = scoreColumns(d, r.names, r.rows, r.scores);
        if (r.se) d = scoreColumns(d, r.names, r.rows, r.se, '_se');
      }
      fresh.setData(d, fresh.dataInfo);
      const missing = (fresh.data.cols[0]?.length ?? 0) - r.rows.length;
      toast('success', `${added(fresh.data.names.length, d.names)}${missing > 0 ? ` ${missing} rows left out of the analysis have no score.` : ''}`);
    } catch (e) {
      const { rMessage } = await import('../../rengine/bridge');
      toast('error', `${method === 'plausible' ? 'semTools' : 'lavaan'}: ${rMessage(e)}`);
    } finally { setBusy(false); }
  };
  return (
    <div className="table-tools" style={{ gap: 8, flexWrap: 'wrap' }}>
      <span className="muted">Factor scores</span>
      <div className="segmented" style={{ width: 330 }}>
        <button className={method === 'regression' ? 'on' : ''} onClick={() => setMethod('regression')} title="Thurstone's regression scores (as AMOS's factor score imputation)">Regression</button>
        <button className={method === 'Bartlett' ? 'on' : ''} onClick={() => setMethod('Bartlett')} title="Bartlett's scores (unbiased; correlate as the factors do less closely)">Bartlett</button>
        <button className={method === 'plausible' ? 'on' : ''} onClick={() => setMethod('plausible')}
          title="Plausible values (semTools; Mplus SAVEDATA PLAUSIBLE): draws from each case's distribution of the factors given its data. Analyse each set and pool the results (Rubin's rules) to keep the scores' uncertainty.">Plausible values</button>
      </div>
      {method === 'plausible' ? (
        <label className="muted" title="Plausible values per factor and case (seeded by the random seed in Settings)">
          Draws <input className="input num" type="number" min={1} max={100} value={draws} style={{ width: 56 }}
            onChange={(e) => setDraws(Math.min(100, Math.max(1, Math.round(Number(e.target.value)) || 1)))} />
        </label>
      ) : (
        <label className="check" title="lavPredict se = “standard”: for regression scores the SD of the factor given the case's data, for Bartlett scores the SD of the score's error">
          <input type="checkbox" checked={withSe} onChange={(e) => setWithSe(e.target.checked)} /> <span>Standard errors</span>
        </label>
      )}
      <button className="btn sm" disabled={busy} onClick={() => void save()}
        title={method === 'plausible' ? 'semTools::plausibleValues: columns <factor>_pv1 … _pvM' : 'lavaan::lavPredict: one column per latent construct (and <factor>_se), e.g. for polynomial regression or matching'}>
        {busy ? 'Computing…' : 'Save as data columns'}
      </button>
    </div>
  );
}
