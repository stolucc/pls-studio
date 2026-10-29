import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { downloadText, safeFileName } from '../format';
import type { Dataset } from '../engine/types';
import type { EndoCoef, EndoInput, EndoMethod, EndoResult, HmType } from '../rengine/endo';
import { useFreshResults, useStore } from '../store';
import { IconX } from './icons';
import { OrderedPicker } from './LongitudinalPanel';
import { c, pCell, Table, type Row } from './results/Table';
import { isCancelled } from '../cancellable';
import { useCancellable } from './useCancellable';

export type EndoPreset = Partial<EndoInput> & { source?: 'data' | 'scores' };
interface EndoState { open: boolean; result: { input: EndoInput; result: EndoResult; source: 'data' | 'scores' } | null; preset: EndoPreset | null; setOpen: (v: boolean) => void }
export const useEndogeneity = create<EndoState>((set) => ({ open: false, result: null, preset: null, setOpen: (open) => set({ open }) }));

const METHODS: { id: EndoMethod; label: string; hint: string }[] = [
  { id: 'iv', label: 'Instrumental variables (2SLS)', hint: 'External instruments: variables that move the endogenous regressor but affect the outcome only through it. Tests: weak instruments (F), Wu–Hausman (is the regressor endogenous?) and Sargan (are surplus instruments valid?).' },
  { id: 'copula', label: 'Gaussian copula', hint: 'No instruments needed (Park & Gupta 2012): the copula term P* models the correlation between the regressor and the error. A significant P* indicates endogeneity. Requires a non-normal, continuous endogenous regressor; bootstrap standard errors.' },
  { id: 'het', label: 'Heteroskedasticity-based instruments', hint: 'No external instruments (Lewbel 2012): instruments built from exogenous regressors and the heteroskedastic residuals of the endogenous one. Requires heteroskedasticity (Breusch–Pagan tests below).' },
  { id: 'hm', label: 'Higher-moment instruments', hint: 'No external instruments (Lewbel 1997): instruments from products of de-meaned variables (g(x) = x²). Requires non-normal, skewed variables.' },
  { id: 'liv', label: 'Latent instrumental variables', hint: 'No instruments (Ebbes et al. 2005): the regressor is split into a latent two-group instrument and an endogenous part; maximum likelihood. For y ~ P only (no other regressors); needs a non-normal regressor.' },
  { id: 'heckman', label: 'Heckman selection model', hint: 'When the outcome is observed only for a selected group (e.g. wages only for people who work): a probit for selection and the outcome equation corrected for it (inverse Mills ratio).' },
];
const HM: { id: HmType; label: string }[] = [
  { id: 'g', label: 'g: (X² − mean)' }, { id: 'gp', label: 'gp: (X² − mean)(P − mean)' }, { id: 'gy', label: 'gy: (X² − mean)(Y − mean)' },
  { id: 'yp', label: 'yp: (Y − mean)(P − mean)' }, { id: 'p2', label: 'p2: (P − mean)²' }, { id: 'y2', label: 'y2: (Y − mean)²' },
];

const coefRow = (x: EndoCoef): Row => [c(x.term), c(x.est), c(x.se), c(x.stat, undefined, 2), pCell(x.p), c(x.ciLow), c(x.ciHigh)];

function EndoView({ r, input }: { r: EndoResult; input: EndoInput }) {
  const level = Math.round(100 * input.boot.confidence);
  const cols = ['Term', 'Estimate', 'Std. error', r.method === 'copula' ? 'z' : 't', 'p', `${level}% CI low`, `${level}% CI high`];
  const ols = (t: string) => r.ols.find((x) => x.term === t);
  const focus = r.method === 'heckman' ? [] : r.coefficients.filter((x) => input.endogenous.includes(x.term));
  return (
    <div className="tables">
      {r.method === 'heckman' ? (
        <>
          {(['selection', 'outcome', 'error terms'] as const).map((eq) => (
            <Table key={eq} title={eq === 'selection' ? 'Selection equation (probit)' : eq === 'outcome' ? 'Outcome equation' : 'Error terms'} file={`heckman-${eq.replace(' ', '-')}`}
              columns={cols} rows={r.coefficients.filter((x) => x.equation === eq).map(coefRow)}
              note={eq === 'error terms' ? 'rho: correlation between the selection and outcome errors (0: no selection bias). The two-step method’s inverse Mills ratio coefficient tests it.' : undefined} />
          ))}
          {r.selection && <div className="hint">{r.selection.selected} of {r.selection.total} cases selected (outcome observed).</div>}
        </>
      ) : (
        <>
          <Table title={METHODS.find((m) => m.id === r.method)!.label} file={`endogeneity-${r.method}`} columns={cols} rows={r.coefficients.map(coefRow)}
            note={r.method === 'liv'
              ? 'Maximum likelihood (Nelder–Mead, optimx); standard errors from the numerical Hessian (delta method for theta5), as REndo::latentIV. The P coefficient is corrected for endogeneity; theta7 ≠ 0 indicates it.'
              : r.method === 'copula'
              ? `Standard errors and percentile intervals from ${r.boot?.samples} bootstrap samples. P* terms: their significance tests whether the regressor is endogenous; the other coefficients are corrected for it.`
              : `${r.n} observations.`} />
          {focus.length > 0 && (
            <Table title="Endogenous regressors: corrected versus OLS" file="endogeneity-vs-ols" columns={['Regressor', 'OLS', 'Corrected', 'Difference']}
              rows={focus.map((x) => { const o = ols(x.term); return [c(x.term), c(o?.est ?? null), c(x.est), c(o ? x.est - o.est : null)]; })}
              note="A large change suggests that OLS was biased by endogeneity; a small one that it was not (given the method’s assumptions)." />
          )}
          {r.diagnostics.length > 0 && (
            <Table title="Diagnostics" file="endogeneity-diagnostics" columns={['Test', 'df1', 'df2', 'Statistic', 'p']}
              rows={r.diagnostics.map((d) => [c(d.test), c(d.df1, undefined, 0), c(d.df2, undefined, 0), c(d.stat, undefined, 3), pCell(d.p)])}
              note="Weak instruments: a small p (large F) means the instruments predict the endogenous regressor well. Wu–Hausman: a small p means the regressor is endogenous (2SLS and OLS differ). Sargan: a small p means not all instruments are valid (needs more instruments than endogenous regressors)." />
          )}
          {r.normality.length > 0 && (
            <Table title="Is the endogenous regressor non-normal? (Shapiro–Wilk)" file="copula-normality" columns={['Regressor', 'p']}
              rows={r.normality.map((x) => [c(x.variable), pCell(x.p)])}
              note="The copula approach needs non-normal regressors: a small p supports it. With a (near) normal regressor P* is (nearly) collinear with it and the correction is unreliable." />
          )}
          {r.heteroskedasticity.length > 0 && (
            <Table title="Heteroskedasticity (Breusch–Pagan)" file="lewbel-heteroskedasticity" columns={['Regressor', 'p']}
              rows={r.heteroskedasticity.map((x) => [c(x.variable), pCell(x.p)])}
              note="Each instrument needs heteroskedasticity related to its regressor: a small p supports it; otherwise that instrument is weak." />
          )}
        </>
      )}
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}

/** Endogeneity tests and corrections for a regression, on data columns or on PLS construct scores. */
export function EndogeneityPanel() {
  const open = useEndogeneity((s) => s.open);
  const saved = useEndogeneity((s) => s.result);
  const preset = useEndogeneity((s) => s.preset);
  const data = useStore((s) => s.data);
  const settings = useStore((s) => s.settings);
  const project = useStore((s) => s.projectName);
  const results = useFreshResults();
  const pls = settings.method === 'pls' ? results?.pls ?? null : null;
  const [source, setSource] = useState<'data' | 'scores'>(saved?.source ?? 'data');
  const [method, setMethod] = useState<EndoMethod>(saved?.input.method ?? 'copula');
  const [outcome, setOutcome] = useState(saved?.input.outcome ?? '');
  const [exogenous, setExogenous] = useState<string[]>(saved?.input.exogenous ?? []);
  const [endogenous, setEndogenous] = useState<string[]>(saved?.input.endogenous ?? []);
  const [instruments, setInstruments] = useState<string[]>(saved?.input.instruments ?? []);
  const [hetRegressors, setHetRegressors] = useState<string[]>(saved?.input.hetRegressors ?? []);
  const [hmTypes, setHmTypes] = useState<HmType[]>(saved?.input.hmTypes ?? ['gp', 'yp']);
  const [selOutcome, setSelOutcome] = useState(saved?.input.selection.outcome ?? '');
  const [selRegs, setSelRegs] = useState<string[]>(saved?.input.selection.regressors ?? []);
  const [heckmanMethod, setHeckmanMethod] = useState<EndoInput['heckmanMethod']>(saved?.input.heckmanMethod ?? 'ml');
  const { busy, setBusy, guard, cancel } = useCancellable();
  useEffect(() => {
    if (!preset) return;
    if (preset.source) setSource(preset.source);
    if (preset.method) setMethod(preset.method);
    if (preset.outcome !== undefined) setOutcome(preset.outcome);
    if (preset.exogenous) setExogenous(preset.exogenous);
    if (preset.endogenous) setEndogenous(preset.endogenous);
    if (preset.instruments) setInstruments(preset.instruments);
    if (preset.hetRegressors) setHetRegressors(preset.hetRegressors);
    if (preset.hmTypes) setHmTypes(preset.hmTypes);
    if (preset.selection) { setSelOutcome(preset.selection.outcome); setSelRegs(preset.selection.regressors); }
    if (preset.heckmanMethod) setHeckmanMethod(preset.heckmanMethod);
  }, [preset]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useEndogeneity.getState().setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  // PLS construct scores as a dataset (Hult et al. 2018: copula on the latent variable scores).
  const scores = useMemo<Dataset | null>(() => (pls ? { names: pls.constructs, cols: pls.scores } : null), [pls]);
  if (!open) return null;
  const close = () => useEndogeneity.getState().setOpen(false);
  const ds = source === 'scores' ? scores : data && !data.moments ? data : null;
  const columns = ds?.names ?? [];
  const input: EndoInput = {
    method, outcome, exogenous: method === 'liv' ? [] : exogenous, endogenous, instruments, hetRegressors: hetRegressors.length ? hetRegressors : exogenous, hmTypes,
    selection: { outcome: selOutcome, regressors: selRegs }, heckmanMethod,
    boot: { samples: Math.max(10, Math.floor(settings.bootSamples)), seed: settings.seed, confidence: settings.confidence },
  };
  const ready = method === 'heckman' ? !!outcome && !!selOutcome && selRegs.length > 0
    : !!outcome && endogenous.length > 0 && (method !== 'iv' || instruments.length >= endogenous.length) && (method !== 'hm' || hmTypes.length > 0)
      && ((method !== 'het' && method !== 'hm' && method !== 'liv') || endogenous.length === 1);
  const fail = (e: unknown) => isCancelled(e) ? Promise.resolve() : import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', rMessage(e)));
  const run = async () => {
    setBusy(true);
    try {
      const { endoR } = await import('../rengine/endo');
      const result = await guard(endoR(ds!, input));
      result.warnings.forEach((w) => useStore.getState().logMessage('warning', w, `${result.engine.package} ${result.engine.version}`));
      useEndogeneity.setState({ result: { input, result, source } });
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  const script = async () => {
    try {
      const { endoScriptR } = await import('../rengine/endo');
      downloadText(`${safeFileName(project)}-endogeneity-${method}.R`, await endoScriptR(ds!, input), 'text/x-r-source');
    } catch (e) { await fail(e); }
  };
  const pick = (label: string, value: string, set: (v: string) => void, exclude: string[]) => (
    <div className="field">
      <label>{label}</label>
      <select className="select" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Choose…</option>
        {columns.filter((n) => n === value || !exclude.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
  const others = (...keep: string[][]) => columns.filter((n) => n !== outcome && !keep.flat().includes(n));
  const m = METHODS.find((x) => x.id === method)!;
  return (
    <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="Endogeneity">
      <div className="sim">
        <header className="sim-head">
          <div><b>Endogeneity</b><span className="muted">{method === 'heckman' ? 'sampleSelection' : method === 'iv' ? 'ivreg' : method === 'copula' ? 'Gaussian copula (as REndo), bootstrap' : method === 'liv' ? 'latent IV (as REndo), optimx' : 'Lewbel instruments (as REndo) with ivreg'}</span></div>
          <button className="btn icon ghost" onClick={close} aria-label="Close"><IconX /></button>
        </header>
        <div className="sim-body long-body">
          <section className="sim-col">
            <div className="field">
              <label>Variables</label>
              <div className="segmented">
                <button className={source === 'data' ? 'on' : ''} onClick={() => setSource('data')}>Data columns</button>
                <button className={source === 'scores' ? 'on' : ''} disabled={!scores} onClick={() => setSource('scores')}
                  title={scores ? 'The construct scores of the last PLS-SEM results' : 'Calculate a PLS-SEM model first'}>PLS construct scores</button>
              </div>
              {source === 'scores' && <div className="hint">The standardised construct scores of the last PLS-SEM results (Hult et al. 2018 apply the copula approach this way).</div>}
            </div>
            <div className="field">
              <label>Method</label>
              <select className="select" value={method} onChange={(e) => setMethod(e.target.value as EndoMethod)}>
                {METHODS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              <div className="hint">{m.hint}</div>
            </div>
            {!ds ? <div className="empty-results">{source === 'scores' ? 'Calculate a PLS-SEM model first.' : 'Import raw data first.'}</div> : method === 'heckman' ? (
              <>
                {pick('Selected (1 = outcome observed, 0 = not)', selOutcome, setSelOutcome, [outcome])}
                <OrderedPicker label="Selection regressors (include at least one not in the outcome equation)" columns={columns.filter((n) => n !== selOutcome)} value={selRegs} onChange={setSelRegs} />
                {pick('Outcome', outcome, setOutcome, [selOutcome])}
                <OrderedPicker label="Outcome regressors" columns={others([selOutcome])} value={exogenous} onChange={setExogenous} />
                <div className="field">
                  <label>Estimation</label>
                  <div className="segmented">
                    <button className={heckmanMethod === 'ml' ? 'on' : ''} onClick={() => setHeckmanMethod('ml')}>Maximum likelihood</button>
                    <button className={heckmanMethod === '2step' ? 'on' : ''} onClick={() => setHeckmanMethod('2step')}>Two-step (Heckit)</button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {pick('Outcome', outcome, setOutcome, [...exogenous, ...endogenous, ...instruments])}
                <OrderedPicker label="Endogenous regressor(s)" columns={others(exogenous, instruments)} value={endogenous} onChange={setEndogenous} />
                {method !== 'liv' && <OrderedPicker label="Exogenous regressors (controls)" columns={others(endogenous, instruments)} value={exogenous} onChange={setExogenous} />}
                {method === 'iv' && <OrderedPicker label="Instruments (not in the outcome equation)" columns={others(endogenous, exogenous)} value={instruments} onChange={setInstruments} />}
                {(method === 'het' || method === 'hm') && (
                  <OrderedPicker label="Exogenous regressors that build the instruments (default: all)" columns={exogenous} value={hetRegressors} onChange={setHetRegressors} />
                )}
                {method === 'hm' && (
                  <div className="field">
                    <label>Internal instruments</label>
                    {HM.map((h) => (
                      <label key={h.id} className="check" style={{ marginBottom: 4 }}>
                        <input type="checkbox" checked={hmTypes.includes(h.id)} onChange={(e) => setHmTypes(e.target.checked ? [...hmTypes, h.id] : hmTypes.filter((x) => x !== h.id))} />
                        <span>{h.label}</span>
                      </label>
                    ))}
                  </div>
                )}
                {(method === 'het' || method === 'hm' || method === 'liv') && endogenous.length > 1 && <div className="issue warning">This method handles one endogenous regressor.</div>}
                {method === 'copula' && <div className="hint">{input.boot.samples} bootstrap samples, seed {input.boot.seed} (from the Model settings).</div>}
              </>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn primary" disabled={!ready || busy || !ds} onClick={() => void run()}>{busy ? 'Estimating…' : 'Estimate'}</button>
              {busy && <button className="btn" onClick={cancel}>Cancel</button>}
              <button className="btn" disabled={!ready || !ds} onClick={() => void script()}>R script</button>
            </div>
          </section>
          <section className="sim-col wide">
            {saved ? <EndoView r={saved.result} input={saved.input} /> : <div className="empty-results">Choose a method and the variables, and press Estimate.</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
