// Endogeneity as an analysis card: instrumental variables, Gaussian copula,
// Lewbel's instruments, latent IVs and Heckman selection, on data columns or
// on PLS construct scores (Hult et al. 2018).

import type { EndoCoef, EndoInput, EndoMethod, EndoResult, HmType } from '../rengine/endo';
import { OrderedPicker } from '../components/LongitudinalPanel';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { ColumnSelect, isObj, name, names, oneOf, sourceData, sourceFingerprint } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export type EndoPreset = Partial<EndoInput> & { source?: 'data' | 'scores' };
export type EndoOptions = Omit<EndoInput, 'boot'> & { source: 'data' | 'scores' };
type EndoCardResult = EndoResult & { input: EndoInput };

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

/** What R gets: settings that do not apply to the method left out; bootstrap settings from the project. */
export function toInput(o: EndoOptions, ctx: Pick<AnalysisCtx, 'settings'>): EndoInput {
  const { source: _s, ...rest } = o;
  return {
    ...rest, exogenous: o.method === 'liv' ? [] : o.exogenous, hetRegressors: o.hetRegressors.length ? o.hetRegressors : o.exogenous,
    boot: { samples: Math.max(10, Math.floor(ctx.settings.bootSamples)), seed: ctx.settings.seed, confidence: ctx.settings.confidence },
  };
}

/** Every column the options read. */
const used = (o: EndoOptions) => o.method === 'heckman'
  ? [o.outcome, ...o.exogenous, o.selection.outcome, ...o.selection.regressors]
  : [o.outcome, ...o.endogenous, ...(o.method === 'liv' ? [] : o.exogenous), ...(o.method === 'iv' ? o.instruments : []), ...(o.method === 'het' || o.method === 'hm' ? o.hetRegressors : [])];

function EndoOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<EndoOptions>) {
  const ds = sourceData(o.source, ctx);
  const columns = ds?.names ?? [];
  const others = (...keep: string[][]) => columns.filter((n) => n !== o.outcome && !keep.flat().includes(n));
  const m = METHODS.find((x) => x.id === o.method)!;
  const boot = toInput(o, ctx).boot;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <div className="field">
        <label>Variables</label>
        <div className="segmented">
          <button className={o.source === 'data' ? 'on' : ''} onClick={() => set({ ...o, source: 'data' })}>Data columns</button>
          <button className={o.source === 'scores' ? 'on' : ''} disabled={!ctx.pls} onClick={() => set({ ...o, source: 'scores' })}
            title={ctx.pls ? 'The construct scores of the current PLS-SEM results' : 'Calculate a PLS-SEM model first'}>PLS construct scores</button>
        </div>
        {o.source === 'scores' && <div className="hint">The standardised construct scores of the current PLS-SEM results (Hult et al. 2018 apply the copula approach this way).</div>}
      </div>
      <div className="field">
        <label htmlFor="endo-m">Method</label>
        <select id="endo-m" className="select" value={o.method} onChange={(e) => set({ ...o, method: e.target.value as EndoMethod })}>
          {METHODS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <div className="hint">{m.hint}</div>
      </div>
      {!ds ? <div className="empty-results">{o.source === 'scores' ? 'Calculate a PLS-SEM model first.' : 'Import raw data first.'}</div> : o.method === 'heckman' ? (
        <>
          <ColumnSelect id="endo-sel" label="Selected (1 = outcome observed, 0 = not)" value={o.selection.outcome} columns={columns} exclude={[o.outcome]} onChange={(v) => set({ ...o, selection: { ...o.selection, outcome: v } })} />
          <OrderedPicker label="Selection regressors (include at least one not in the outcome equation)" columns={columns.filter((n) => n !== o.selection.outcome)} value={o.selection.regressors} onChange={(regressors) => set({ ...o, selection: { ...o.selection, regressors } })} />
          <ColumnSelect id="endo-y" label="Outcome" value={o.outcome} columns={columns} exclude={[o.selection.outcome]} onChange={(outcome) => set({ ...o, outcome })} />
          <OrderedPicker label="Outcome regressors" columns={others([o.selection.outcome])} value={o.exogenous} onChange={(exogenous) => set({ ...o, exogenous })} />
          <div className="field">
            <label>Estimation</label>
            <div className="segmented">
              <button className={o.heckmanMethod === 'ml' ? 'on' : ''} onClick={() => set({ ...o, heckmanMethod: 'ml' })}>Maximum likelihood</button>
              <button className={o.heckmanMethod === '2step' ? 'on' : ''} onClick={() => set({ ...o, heckmanMethod: '2step' })}>Two-step (Heckit)</button>
            </div>
          </div>
        </>
      ) : (
        <>
          <ColumnSelect id="endo-y" label="Outcome" value={o.outcome} columns={columns} exclude={[...o.exogenous, ...o.endogenous, ...o.instruments]} onChange={(outcome) => set({ ...o, outcome })} />
          <OrderedPicker label="Endogenous regressor(s)" columns={others(o.exogenous, o.instruments)} value={o.endogenous} onChange={(endogenous) => set({ ...o, endogenous })} />
          {o.method !== 'liv' && <OrderedPicker label="Exogenous regressors (controls)" columns={others(o.endogenous, o.instruments)} value={o.exogenous} onChange={(exogenous) => set({ ...o, exogenous })} />}
          {o.method === 'iv' && <OrderedPicker label="Instruments (not in the outcome equation)" columns={others(o.endogenous, o.exogenous)} value={o.instruments} onChange={(instruments) => set({ ...o, instruments })} />}
          {(o.method === 'het' || o.method === 'hm') && (
            <OrderedPicker label="Exogenous regressors that build the instruments (default: all)" columns={o.exogenous} value={o.hetRegressors} onChange={(hetRegressors) => set({ ...o, hetRegressors })} />
          )}
          {o.method === 'hm' && (
            <div className="field">
              <label>Internal instruments</label>
              {HM.map((h) => (
                <label key={h.id} className="check" style={{ marginBottom: 4 }}>
                  <input type="checkbox" checked={o.hmTypes.includes(h.id)} onChange={(e) => set({ ...o, hmTypes: e.target.checked ? [...o.hmTypes, h.id] : o.hmTypes.filter((x) => x !== h.id) })} />
                  <span>{h.label}</span>
                </label>
              ))}
            </div>
          )}
          {o.method === 'copula' && <div className="hint">{boot.samples} bootstrap samples, seed {boot.seed} (from the Model settings).</div>}
        </>
      )}
    </fieldset>
  );
}

const METHOD_IDS = ['iv', 'copula', 'het', 'hm', 'liv', 'heckman'] as const;
const HM_IDS = ['g', 'gp', 'gy', 'yp', 'p2', 'y2'] as const;

export const endoAnalysis: AnalysisType<EndoOptions, EndoCardResult> = {
  id: 'endo',
  title: 'Endogeneity',
  sub: 'instruments (2SLS), Gaussian copula, Lewbel, Heckman',
  group: 'Regression and causal inference',
  defaults: () => ({ source: 'data', method: 'copula', outcome: '', exogenous: [], endogenous: [], instruments: [], hetRegressors: [], hmTypes: ['gp', 'yp'], selection: { outcome: '', regressors: [] }, heckmanMethod: 'ml' }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const sel = isObj(raw.selection) ? raw.selection : {};
    return {
      source: raw.source === 'scores' ? 'scores' : 'data', method: oneOf(raw.method, METHOD_IDS, 'copula'),
      outcome: name(raw.outcome), exogenous: names(raw.exogenous), endogenous: names(raw.endogenous), instruments: names(raw.instruments), hetRegressors: names(raw.hetRegressors),
      hmTypes: [...new Set((Array.isArray(raw.hmTypes) ? raw.hmTypes : []).filter((h): h is HmType => HM_IDS.includes(h as HmType)))],
      selection: { outcome: name(sel.outcome), regressors: names(sel.regressors) },
      heckmanMethod: oneOf(raw.heckmanMethod, ['ml', '2step'] as const, 'ml'),
    };
  },
  Options: EndoOptionsForm,
  View: ({ result }) => <EndoView r={result} input={result.input} />,
  blocked: (o, ctx) => {
    const ds = sourceData(o.source, ctx);
    if (!ds) return o.source === 'scores' ? 'Calculate a PLS-SEM model first: this runs on its construct scores.' : 'Endogeneity needs raw data: import a dataset (not a covariance matrix).';
    if (o.method === 'heckman') {
      if (!o.selection.outcome || !o.selection.regressors.length) return 'Choose the selection indicator and its regressors.';
      if (!o.outcome) return 'Choose the outcome.';
    } else {
      if (!o.outcome) return 'Choose the outcome.';
      if (!o.endogenous.length) return 'Choose the endogenous regressor.';
      if (o.method === 'iv' && o.instruments.length < o.endogenous.length) return 'Instrumental variables need at least as many instruments as endogenous regressors.';
      if (o.method === 'hm' && !o.hmTypes.length) return 'Choose at least one internal instrument.';
      if ((o.method === 'het' || o.method === 'hm' || o.method === 'liv') && o.endogenous.length !== 1) return 'This method handles one endogenous regressor.';
    }
    const gone = used(o).filter((n) => n && !ds.names.includes(n));
    return gone.length ? `Not in the ${o.source === 'scores' ? 'construct scores' : 'data'}: ${[...new Set(gone)].join(', ')}.` : null;
  },
  fingerprint: (o, ctx) => {
    const b = toInput(o, ctx).boot;
    return sourceFingerprint(o.source, ctx, used(o), o.method === 'copula' ? [b.samples, b.seed, b.confidence] : [b.confidence]);
  },
  run: async (o, ctx) => {
    const input = toInput(o, ctx);
    return { ...(await (await import('../rengine/endo')).endoR(sourceData(o.source, ctx)!, input)), input };
  },
  script: async (o, ctx) => (await import('../rengine/endo')).endoScriptR(sourceData(o.source, ctx)!, toInput(o, ctx)),
  summary: (o) => (o.outcome ? `${METHODS.find((m) => m.id === o.method)!.label} · ${(o.method === 'heckman' ? o.exogenous : o.endogenous).join(', ') || '…'} → ${o.outcome}${o.source === 'scores' ? ' (construct scores)' : ''}` : 'not set up yet'),
};
