import { useMemo, useState } from 'react';
import { create } from 'zustand';
import type { CbEstimator } from '../engine/cbsem';
import { downloadText, fmt, safeFileName } from '../format';
import { toSpec, validateModel } from '../model/project';
import { farOut, flaggedCases, influentialCases, mardiaVerdict, normalityLevel } from '../model/screen';
import type { InfluenceResult, ScreenResult } from '../rengine/screen';
import { useStore } from '../store';
import { isCancelled } from '../cancellable';
import { IconX } from './icons';
import { c, pCell, Table } from './results/Table';
import { useCancellable } from './useCancellable';
import { VariablePicker } from './VariablePicker';

type Tab = 'univariate' | 'normality' | 'outliers' | 'influence';
interface ScreenState { open: boolean; vars: string[]; alpha: number; result: ScreenResult | null; influence: InfluenceResult | null; tab: Tab; setOpen: (v: boolean) => void }
export const useScreen = create<ScreenState>((set) => ({ open: false, vars: [], alpha: 0.001, result: null, influence: null, tab: 'univariate', setOpen: (open) => set({ open }) }));

const ALPHAS = [0.001, 0.01, 0.05];
const fail = (pkg: string) => (e: unknown) => (isCancelled(e) ? Promise.resolve() : import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', `${pkg}: ${rMessage(e)}`)));

function Univariate({ r }: { r: ScreenResult }) {
  return (
    <Table title="Distributions" file="screening-univariate" columns={['Variable', 'n', 'Missing', 'Mean', 'SD', 'Min', 'Max', 'Skewness', 'Kurtosis']}
      rows={r.variables.map((v, i) => {
        const d = r.describe[i], lvl = normalityLevel(d.skew, d.kurtosis);
        const tone = lvl === 'severe' ? 'bad' : lvl === 'moderate' ? 'warn' : '';
        return [c(v), c(d.n, undefined, 0), c(d.missing, d.missing ? 'warn' : 'dim', 0), c(d.mean), c(d.sd), c(d.min), c(d.max), c(d.skew, tone), c(d.kurtosis, tone)];
      })}
      note="Skewness and excess kurtosis as psych::describe (type 3). |skew| > 2 or |kurtosis| > 7 is severe (red), above 1 or 3 moderate (West, Finch & Curran 1995; Kline 2016)." />
  );
}

function Normality({ r }: { r: ScreenResult }) {
  const m = r.mardia, v = mardiaVerdict(m);
  return (
    <div className="tables">
      <Table title={`Mardia’s test: ${v.normal ? 'multivariate normality not rejected' : 'multivariate normality rejected'}`} file="screening-mardia"
        columns={['', 'Statistic', 'Test', 'df', 'p']}
        rows={[
          [c('Multivariate skewness b₁,ₚ'), c(m.b1p), c(m.n < 20 ? m.smallSkew : m.skew, undefined, 2), c(m.df, undefined, 0), pCell(v.skewP)],
          [c('Multivariate kurtosis b₂,ₚ'), c(m.b2p), c(m.kurtosis, undefined, 2), c('z', 'dim'), pCell(m.pKurt)],
        ]}
        note={`${m.n} complete cases, ${m.p} variables (psych::mardia). Under normality b₂,ₚ = p(p + 2) = ${m.p * (m.p + 2)}. ${v.text}${m.n < 20 ? ' Skewness: small-sample corrected test.' : ''}`} />
    </div>
  );
}

function Outliers({ r }: { r: ScreenResult }) {
  const alpha = useScreen((s) => s.alpha);
  const flagged = flaggedCases(r.cases, alpha);
  const data = useStore((s) => s.data), info = useStore((s) => s.dataInfo);
  const save = async () => {
    if (!data || !info) return;
    const { scoreColumns } = await import('../rengine/lavaan');
    const d = scoreColumns(data, ['mahal_d2', 'mahal_p'], r.cases.rows, [r.cases.d2, r.cases.p], '');
    useStore.getState().setData(d, info);
    useStore.getState().toast('success', `Saved as data columns: ${d.names.slice(data.names.length).join(', ')}. Rows with missing values have none.`);
  };
  return (
    <div className="tables">
      <Table title={`Multivariate outliers: ${flagged.length} of ${r.cases.rows.length} cases`} file="screening-outliers" columns={['Row', 'Mahalanobis D²', 'p']}
        rows={flagged.map((x) => [c(x.row, undefined, 0), c(x.d2, 'bad', 2), pCell(x.p)])}
        note={`Cases whose Mahalanobis distance from the centroid is significant at p < ${alpha} (χ², df = ${r.df}; Tabachnick & Fidell). Inspect them before deciding: a data-entry error, a case outside the population, or a legitimate extreme response.`} />
      <div><button className="btn" onClick={() => void save()} title="Add D² and its p for every complete case as data columns (to filter or inspect them)">Save D² and p as data columns</button></div>
    </div>
  );
}

function Influence() {
  const method = useStore((s) => s.settings.method), settings = useStore((s) => s.settings);
  const model = useStore((s) => s.model), data = useStore((s) => s.data);
  const inf = useScreen((s) => s.influence);
  const { busy, setBusy, guard, cancel } = useCancellable();
  const errors = data ? validateModel(model, data, settings).filter((i) => i.level === 'error') : [];
  const ready = method === 'cbsem' && !!data && !data.moments && errors.length === 0 && (settings.engine ?? 'r') === 'r';
  const go = async () => {
    setBusy(true);
    try {
      const { influenceR } = await import('../rengine/screen');
      const r = await guard(influenceR(data!, toSpec(model), settings.missing, settings.estimator as CbEstimator));
      r.warnings.forEach((w) => useStore.getState().logMessage('warning', w, `semfindr ${r.engine.version}`));
      useScreen.setState({ influence: r });
    } catch (e) { await fail('semfindr')(e); } finally { setBusy(false); }
  };
  const top = inf ? influentialCases(inf, 15) : [];
  const at = (row: number) => inf!.rows.indexOf(row);
  return (
    <div className="tables">
      <div className="hint" style={{ maxWidth: 640 }}>
        Influence of each case on the CB-SEM model on the canvas: the model is refitted without each case in turn (semfindr; n refits, so this takes a while).
        {method !== 'cbsem' ? ' Switch to CB-SEM to use it.' : errors.length ? ` Fix the model first: ${errors[0].message}` : ''}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary" disabled={!ready || busy} onClick={() => void go()}>{busy ? 'Refitting…' : 'Compute case influence'}</button>
        {busy && <button className="btn" onClick={cancel}>Cancel</button>}
      </div>
      {inf && <Table title="Most influential cases" file="screening-influence" columns={['Row', 'Generalized Cook’s distance', 'Mahalanobis', 'Δχ²', 'ΔCFI', 'ΔRMSEA']}
        rows={top.map((x) => [c(x.row, undefined, 0), c(x.gcd, x.flagged ? 'bad' : ''), c(inf.md[at(x.row)], undefined, 2), c(inf.chisq[at(x.row)]), c(inf.cfi[at(x.row)]), c(inf.rmsea[at(x.row)])])}
        note={`Generalized Cook’s distance (Pek & MacCallum 2011): how far the parameter estimates move without the case. It has no conventional cutoff; red: far out from the other cases (above Q3 + 3 IQR = ${fmt(farOut(inf.gcd))}). Δ: fit with the case minus without it. ${inf.engine.package} ${inf.engine.version}.`} />}
    </div>
  );
}

/** Data screening: distributions, multivariate normality, outliers and influential cases. */
export function DataScreeningPanel() {
  const s = useScreen();
  const data = useStore((st) => st.data), model = useStore((st) => st.model), project = useStore((st) => st.projectName);
  const { busy, setBusy, guard, cancel } = useCancellable();
  const columns = useMemo(() => (data && !data.moments ? data.names : []), [data]);
  const indicators = useMemo(() => [...new Set(model.constructs.flatMap((k) => k.indicators))].filter((v) => columns.includes(v)), [model, columns]);
  const [touched, setTouched] = useState(false);
  if (!s.open) return null;
  const vars = (touched ? s.vars : s.vars.length ? s.vars : indicators).filter((v) => columns.includes(v));
  const ready = !!data && vars.length >= 2;
  const run = async () => {
    setBusy(true);
    try {
      const { screenR } = await import('../rengine/screen');
      useScreen.setState({ result: await guard(screenR(data!, vars, s.alpha)), influence: null });
    } catch (e) { await fail('psych')(e); } finally { setBusy(false); }
  };
  const script = async () => {
    try {
      const { screenScriptR } = await import('../rengine/screen');
      downloadText(`${safeFileName(project)}-screening.R`, await screenScriptR(data!, vars, s.alpha), 'text/x-r-source');
    } catch (e) { await fail('psych')(e); }
  };
  const tabs: [Tab, string][] = [['univariate', 'Distributions'], ['normality', 'Multivariate normality'], ['outliers', 'Outliers'], ['influence', 'Influential cases']];
  return (
    <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="Data screening">
      <div className="sim">
        <header className="sim-head">
          <div><b>Data screening</b><span className="muted">Distributions, Mardia’s test, multivariate outliers and influential cases</span></div>
          <button className="btn icon ghost" onClick={() => s.setOpen(false)} aria-label="Close"><IconX /></button>
        </header>
        <div className="sim-body long-body">
          <section className="sim-col">
            {!data || data.moments ? <div className="empty-results">Import raw data first.</div> : (
              <>
                <VariablePicker columns={columns} value={vars} onChange={(v) => { setTouched(true); useScreen.setState({ vars: columns.filter((x) => v.includes(x)) }); }} />
                {indicators.length >= 2 && <button className="btn sm ghost" onClick={() => { setTouched(true); useScreen.setState({ vars: indicators }); }}>Use the model’s indicators ({indicators.length})</button>}
                <div className="field">
                  <label>Outliers at</label>
                  <div className="segmented" role="radiogroup" aria-label="Outlier significance level">
                    {ALPHAS.map((a) => <button key={a} role="radio" aria-checked={s.alpha === a} className={s.alpha === a ? 'on' : ''} onClick={() => useScreen.setState({ alpha: a })}>p &lt; {a}</button>)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primary" disabled={!ready || busy} onClick={() => void run()}>{busy ? 'Calculating…' : 'Calculate'}</button>
                  {busy && <button className="btn" onClick={cancel}>Cancel</button>}
                  <button className="btn" disabled={!ready || busy} onClick={() => void script()}>R script</button>
                </div>
              </>
            )}
          </section>
          <section className="sim-col wide">
            <div className="segmented efa-tabs" role="tablist" aria-label="Screening results">
              {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={s.tab === id} className={s.tab === id ? 'on' : ''} onClick={() => useScreen.setState({ tab: id })}>{label}</button>)}
            </div>
            {s.tab === 'influence' ? <Influence /> : !s.result ? <div className="empty-results">Choose variables and press Calculate.</div>
              : s.tab === 'univariate' ? <Univariate r={s.result} /> : s.tab === 'normality' ? <Normality r={s.result} /> : <Outliers r={s.result} />}
          </section>
        </div>
      </div>
    </div>
  );
}
