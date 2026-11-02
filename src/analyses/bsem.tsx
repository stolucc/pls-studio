// Bayesian SEM card: the CB-SEM model of the diagram fitted by blavaan (Stan) in
// desktop R through the helper. Convergence first (R-hat, effective sample
// sizes), then blavaan's fit measures and the posterior of every parameter.

import { c, Table, type Row } from '../components/results/Table';
import { fmt } from '../format';
import { toSpec, validateModel } from '../model/project';
import { useCompute } from '../rengine/compute';
import type { BsemOptions, BsemResult } from '../rengine/bsem';
import { Choice, clampNum, columnsFingerprint, isObj, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';
import { fingerprint } from './codec';

const engine = () => import('../rengine/bsem');
const pct = (conf: number) => `${Math.round(conf * 100)}%`;
const modelIndicators = (ctx: AnalysisCtx) => [...new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators))];
const OP_NAME: Record<string, string> = { '=~': 'Loadings', '~': 'Regressions', '~~': 'Variances and covariances', '~1': 'Intercepts and means' };

function BsemForm({ options: o, set, disabled }: OptionsProps<BsemOptions>) {
  const n = (k: 'chains' | 'burnin' | 'sample', lo: number, hi: number) => (e: { target: { value: string } }) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v) && v >= lo && v <= hi) set({ ...o, [k]: v }); };
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>The CB-SEM model on the canvas, fitted by MCMC (blavaan with Stan, its default priors), in desktop R through the PLS Studio Helper: Stan does not run in the browser.</p>
      <Choice label="Identification of the factors" value={o.identification} onChange={(identification) => set({ ...o, identification })}
        options={[['unit', 'Unit factor variances'], ['marker', 'Marker indicators (as the diagram)']]}
        hint={o.identification === 'unit' ? 'Each factor’s variance fixed at 1, every loading estimated (lavaan’s std.lv): the chains mix more reliably. The loadings are then on the standardised-factor scale.' : 'The first loading of each factor fixed at 1, as in the ML fit. Chains can get stuck in a second mode; check R-hat.'} />
      <div className="row2">
        <div className="field"><label htmlFor="bs-ch">Chains</label><input id="bs-ch" className="input num" type="number" min={1} max={8} value={o.chains} onChange={n('chains', 1, 8)} /></div>
        <div className="field"><label htmlFor="bs-bi">Burn-in per chain</label><input id="bs-bi" className="input num" type="number" min={100} max={100000} step={100} value={o.burnin} onChange={n('burnin', 100, 100000)} /></div>
      </div>
      <div className="field"><label htmlFor="bs-s">Draws per chain</label><input id="bs-s" className="input num" type="number" min={100} max={100000} step={100} value={o.sample} onChange={n('sample', 100, 100000)} />
        <div className="hint">blavaan’s defaults: 3 chains, 500 burn-in and 1,000 draws each. The seed is the project’s.</div></div>
    </fieldset>
  );
}

function BsemView({ r }: { r: BsemResult }) {
  const f = r.fit;
  const groups = ['=~', '~', '~~', '~1'].map((op) => [op, r.parameters.filter((p) => p.op === op)] as const).filter(([, ps]) => ps.length);
  const name = (p: BsemResult['parameters'][number]) => (p.op === '~1' ? `${p.lhs} (intercept)` : `${p.lhs} ${p.op} ${p.rhs}`);
  const rhatCell = (v: number | null) => (v === null ? c(null) : { v: fmt(v, 3), cls: v >= 1.05 ? 'bad' : v >= 1.01 ? 'warn' : 'good' });
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>{r.chains} chains × {r.sample.toLocaleString('en')} draws after {r.burnin.toLocaleString('en')} burn-in, seed {r.seed}; n = {r.n}; factors identified by {r.identification === 'unit' ? 'unit variances (std.lv)' : 'marker indicators'}; blavaan {r.engine.version}{r.engine.desktop ? ` in desktop ${r.engine.desktop}` : ''}.</p>
      <div className={`stat-cards`}>
        <div className="stat-card"><div className="k">Converged</div><div className={`v ${r.converged ? 'good' : 'bad'}`}>{r.converged ? 'yes' : 'no'}</div></div>
        <div className="stat-card"><div className="k">Largest R-hat</div><div className={`v ${r.maxRhat >= 1.05 ? 'bad' : r.maxRhat >= 1.01 ? 'warn' : 'good'}`}>{fmt(r.maxRhat, 3)}</div></div>
        <div className="stat-card"><div className="k">Smallest n_eff</div><div className={`v ${r.minNeff < 400 ? 'warn' : ''}`}>{fmt(r.minNeff, 0)}</div></div>
        {f.ppp !== undefined && <div className="stat-card"><div className="k">PPP</div><div className="v">{fmt(f.ppp, 3)}</div></div>}
      </div>
      {!r.converged && <p className="hint" style={{ color: 'var(--bad)' }}>The chains did not converge (an R-hat of 1.05 or more): the estimates below are not reliable. Run more burn-in and draws, another seed, or unit factor variances.</p>}
      <Table title="Fit" file="bsem-fit" columns={['Measure', 'Value']} rows={([
        ['Posterior predictive p (PPP)', f.ppp], ['DIC', f.dic], ['Effective parameters (pD)', f.pDic], ['WAIC', f.waic], ['LOOIC', f.looic], ['SE of LOOIC', f.seLooic], ['Marginal log-likelihood', f.margLogLik], ['BIC', f.bic],
      ] as [string, number | undefined][]).filter(([, v]) => v !== undefined && v !== null).map(([k, v]): Row => [c(k), c(v!, undefined, k.startsWith('Posterior') ? 3 : 1)])}
        note="PPP: the share of draws in which data replicated from the model fit worse than the observed data; near 0.5 is good, below about 0.05 signals misfit. DIC, WAIC and LOOIC compare models: smaller is better." />
      {groups.map(([op, ps]) => (
        <Table key={op} title={OP_NAME[op] ?? op} file={`bsem-${op === '=~' ? 'loadings' : op === '~' ? 'regressions' : op === '~~' ? 'covariances' : 'means'}`}
          columns={['Parameter', 'Posterior mean', 'SD', `${pct(r.confidence)} credible interval`, 'R-hat', 'n_eff']}
          rows={ps.map((p): Row => [c(name(p)), c(p.mean), c(p.sd), c(`[${fmt(p.low)}, ${fmt(p.high)}]`), rhatCell(p.rhat), c(p.neff, undefined, 0)])} />
      ))}
      <p className="hint">R-hat compares the chains with each other (1.00 means they agree; 1.05 or more: not converged). n_eff: the number of independent draws the chains are worth.</p>
    </div>
  );
}

export const bsemAnalysis: AnalysisType<BsemOptions, BsemResult> = {
  id: 'bsem', title: 'Bayesian SEM (blavaan)', sub: 'the CB-SEM model by MCMC (Stan): posterior, R-hat, PPP, WAIC, LOO; desktop R', group: 'CB-SEM model',
  defaults: () => ({ identification: 'unit', chains: 3, burnin: 500, sample: 1000 }),
  parseOptions: (raw) => (isObj(raw) ? {
    identification: oneOf(raw.identification, ['unit', 'marker'] as const, 'unit'), chains: clampNum(raw.chains, 1, 8, 3, true),
    burnin: clampNum(raw.burnin, 100, 100000, 500, true), sample: clampNum(raw.sample, 100, 100000, 1000, true),
  } : null),
  Options: BsemForm,
  View: ({ result }) => <BsemView r={result} />,
  blocked: (o, ctx) => {
    if (ctx.settings.method !== 'cbsem') return 'Bayesian SEM fits a CB-SEM model: switch the model to CB-SEM (Model tab).';
    if (!rawData(ctx)) return 'Bayesian SEM needs raw data: import a dataset (not a covariance matrix).';
    if (!ctx.model?.constructs.length) return 'Draw a CB-SEM model first (Model tab).';
    const m = ctx.model;
    if (m.multigroup || m.multilevel) return 'Bayesian SEM here fits one group without clusters.';
    if (m.moderations.length) return 'Bayesian SEM here does not include latent interactions.';
    if (m.ordered?.length) return 'Bayesian SEM here treats indicators as continuous; ordinal indicators need WLSMV.';
    if (m.constructs.some((k) => k.type === 'composite')) return 'Composites are not available in Bayesian SEM.';
    if (ctx.settings.missing === 'mi') return 'Bayesian SEM handles missing values itself: choose casewise or FIML, not multiple imputation.';
    if (m.constant && o.identification === 'unit') return 'Means and intercepts need marker identification: choose Marker indicators.';
    if (useCompute.getState().backend !== 'helper') return 'Bayesian SEM runs in desktop R (Stan does not run in the browser): choose Desktop R (helper) under R runs in, on the Model tab, with the PLS Studio Helper running.';
    const err = validateModel(m, rawData(ctx)!, { ...ctx.settings, estimator: 'ML' }).find((i) => i.level === 'error');
    return err ? `Fix the model first: ${err.message}` : null;
  },
  fingerprint: (o, ctx) => {
    if (ctx.settings.method !== 'cbsem' || !ctx.model || !rawData(ctx)) return null;
    const cols = columnsFingerprint(ctx, modelIndicators(ctx));
    return cols && fingerprint([cols, JSON.stringify(toSpec(ctx.model)), ctx.settings.missing, o.identification, o.chains, o.burnin, o.sample, ctx.settings.seed, ctx.settings.confidence]);
  },
  run: async (o, ctx) => (await engine()).bsemR(rawData(ctx)!, toSpec(ctx.model!), ctx.settings.missing, o, ctx.settings.seed, ctx.settings.confidence),
  script: async (o, ctx) => (await engine()).bsemScriptR(rawData(ctx)!, toSpec(ctx.model!), ctx.settings.missing, o, ctx.settings.seed, ctx.settings.confidence),
  summary: (o) => `the CB-SEM model on the canvas · ${o.chains} chains × ${o.sample} · ${o.identification === 'unit' ? 'unit variances' : 'markers'}`,
};
