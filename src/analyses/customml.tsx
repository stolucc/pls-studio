// Custom likelihood card: maximum likelihood for a model written as expressions of named parameters (Mplus's MODEL
// CONSTRAINT) and of data columns that vary by case (Mplus CONSTRAINT = column: definition variables). Three kinds of
// model: a nominal outcome's logits, the means and (co)variances of normal outcomes, and probit models of one or two
// binary outcomes. Computed in R (R/customml.R); the expressions are checked by a grammar on both sides.

import { c, Table } from '../components/results/Table';
import { fmt } from '../format';
import { nameError } from '../model/expr';
import { customMlColumns, customMlExpressions, customMlNames, type BmvregInput, type BmvregResult, type CustomMlInput, type CustomMlResult, type CustomMlType } from '../rengine/customml';
import { OrderedPicker } from '../components/OrderedPicker';
import { Choice, clampNum, columnsFingerprint, isObj, missingColumns, name, names, oneOf, rawData } from './common';
import type { AnalysisType, OptionsProps } from './types';

export type CustomMlOptions = CustomMlInput;

/** The likelihoods the card writes out. */
export const CUSTOMML_TYPES = ['nominal', 'normal', 'probit'] as const;
const TYPES: [CustomMlType, string, string][] = [
  ['nominal', 'Nominal', 'One unordered outcome: the logit of each category against the last (Mplus u#1, u#2, …), each an expression.'],
  ['normal', 'Normal', 'Continuous outcomes: their means, variances and covariances, each an expression (multivariate normal).'],
  ['probit', 'Probit', 'One or two binary (0/1) outcomes: normal latent responses with mean 0, the value 1 above the threshold; thresholds, variances and covariance as expressions.'],
];
const pairsOf = (p: number) => Array.from({ length: p }, (_, i) => Array.from({ length: p - i - 1 }, (_, k) => [i, i + k + 1] as const)).flat();
const lines = (s: string) => s.split('\n');
const fit = (list: string[], n: number) => Array.from({ length: n }, (_, i) => list[i] ?? '');

/** Parameters as text: one "name = start" per line. */
const parsText = (ps: CustomMlOptions['parameters']) => ps.map((p) => `${p.name} = ${p.start}`).join('\n');
function readPars(s: string): CustomMlOptions['parameters'] {
  return lines(s).map((l) => l.trim()).filter(Boolean).map((l) => { const [n, v] = l.split('='); return { name: (n ?? '').trim(), start: Number((v ?? '0').trim()) || 0 }; });
}
const defsText = (ds: CustomMlOptions['defined']) => ds.map((d) => `${d.name} := ${d.expr}`).join('\n');
function readDefs(s: string): CustomMlOptions['defined'] {
  return lines(s).map((l) => l.trim()).filter(Boolean).map((l) => { const at = l.indexOf(':='); return at < 0 ? { name: l, expr: '' } : { name: l.slice(0, at).trim(), expr: l.slice(at + 2).trim() }; });
}

function Area({ id, label, value, rows, onChange, hint }: { id: string; label: string; value: string; rows: number; onChange: (v: string) => void; hint?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} className="input" spellCheck={false} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} style={{ fontFamily: 'var(--mono, monospace)', width: '100%' }} />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function CustomMlForm({ options: o, set, ctx, disabled }: OptionsProps<CustomMlOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  const p = o.outcomes.length, pairs = pairsOf(p);
  const shape = (x: CustomMlOptions): CustomMlOptions => ({ ...x, means: fit(x.means, x.outcomes.length), variances: fit(x.variances, x.outcomes.length), covariances: fit(x.covariances, pairsOf(x.outcomes.length).length) });
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>Maximum likelihood for a model you write: name the parameters and give each part of the model as an expression of them (+ − * / ^, exp, log, sqrt). A data column in an expression varies from case to case (a definition variable, Mplus CONSTRAINT =).</p>
      <Choice label="Model" value={o.type} options={TYPES.map(([id, l]) => [id, l] as const)} onChange={(type) => set(shape({ ...o, type, outcomes: type === 'nominal' ? o.outcomes.slice(0, 1) : type === 'probit' ? o.outcomes.slice(0, 2) : o.outcomes }))} />
      <div className="hint">{TYPES.find(([id]) => id === o.type)![2]}</div>
      <div className="field">
        <label>Outcome{o.type === 'nominal' ? '' : 's'}</label>
        <div className="pick-list">
          {columns.map((n) => <button key={n} className={o.outcomes.includes(n) ? 'on' : ''} onClick={() => {
            const has = o.outcomes.includes(n), max = o.type === 'nominal' ? 1 : o.type === 'probit' ? 2 : 10;
            const outcomes = has ? o.outcomes.filter((x) => x !== n) : max === 1 ? [n] : [...o.outcomes, n].slice(0, max);
            set(shape({ ...o, outcomes }));
          }}>{n}</button>)}
        </div>
      </div>
      <Area id="cml-pars" label="Parameters (one per line: name = start value)" rows={Math.max(2, o.parameters.length)} value={parsText(o.parameters)} onChange={(s) => set({ ...o, parameters: readPars(s) })} />
      {o.type === 'nominal'
        ? <Area id="cml-logits" label="Logits of the categories against the last (one per line, in the categories’ order)" rows={Math.max(2, o.logits.length)} value={o.logits.join('\n')} onChange={(s) => set({ ...o, logits: lines(s) })} />
        : <>
          {o.outcomes.map((y, j) => (
            <div className="field" key={y}>
              <label>{y}</label>
              <input className="input" aria-label={`${o.type === 'probit' ? 'Threshold' : 'Mean'} of ${y}`} placeholder={o.type === 'probit' ? 'threshold' : 'mean'} value={o.means[j] ?? ''} onChange={(e) => set({ ...o, means: fit(o.means, p).map((v, k) => (k === j ? e.target.value : v)) })} />
              <input className="input" aria-label={`Variance of ${y}`} placeholder="variance" value={o.variances[j] ?? ''} onChange={(e) => set({ ...o, variances: fit(o.variances, p).map((v, k) => (k === j ? e.target.value : v)) })} />
            </div>
          ))}
          {pairs.map(([a, b], k) => (
            <div className="field" key={`${a}-${b}`}>
              <label>Covariance of {o.outcomes[a]} and {o.outcomes[b]} (empty: 0)</label>
              <input className="input" value={o.covariances[k] ?? ''} onChange={(e) => set({ ...o, covariances: fit(o.covariances, pairs.length).map((v, q) => (q === k ? e.target.value : v)) })} />
            </div>
          ))}
        </>}
      <Area id="cml-defs" label="Defined parameters (optional; one per line: name := expression)" rows={Math.max(1, o.defined.length)} value={defsText(o.defined)} onChange={(s) => set({ ...o, defined: readDefs(s) })}
        hint="Functions of the parameters, with delta-method standard errors (Mplus MODEL CONSTRAINT: NEW)." />
      <Choice label="Standard errors" value={o.se} options={[['model', 'Observed information (ML)'], ['robust', 'Sandwich (MLR)'], ['mplus', 'Sandwich, Mplus’s information under constraints (MLR)']]} onChange={(se) => set({ ...o, se })} />
    </fieldset>
  );
}

function CustomMlView({ result: r }: { result: CustomMlResult }) {
  const row = (n: string, est: number | null, se: number | null, extra = '') => [c(n), c(est), c(se), c(est !== null && se ? est / se : null), c(extra)];
  const cols = ['Parameter', 'Estimate', 'Std. error', 'z', 'Expression'];
  return (
    <div className="tables">
      <div className="stat-cards">{([['n', String(r.n)], ['Log-likelihood', fmt(r.fit.logLik, 3)], ['Free parameters', String(r.fit.npar)], ['AIC', fmt(r.fit.aic, 3)], ['BIC', fmt(r.fit.bic, 3)]] as [string, string][]).map(([k, v]) => <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}</div>
      <p className="hint" style={{ marginTop: 0 }}>Maximum likelihood ({r.engine.package} {r.engine.version}){r.se === 'robust' ? '; sandwich standard errors from the cases’ scores (Mplus MLR)' : r.se === 'mplus' ? `; sandwich standard errors with Mplus’s information for parameters under MODEL CONSTRAINT (the observed information plus once more the term of the parts’ curvature, as Mplus’s MLR)${r.scaling != null ? `; scaling correction factor ${fmt(r.scaling, 4)}` : ''}` : '; standard errors from the observed information'}.{r.categories ? ` Categories ${r.categories.join(', ')}: the last is the reference.` : ''}{r.converged ? '' : ' The optimiser did not report convergence.'}</p>
      <Table title="Parameters" file="customml-parameters" columns={cols.slice(0, 4)} rows={r.parameters.map((q) => row(q.name, q.est, q.se).slice(0, 4))} />
      <Table title="The model’s parts" file="customml-parts" columns={cols} rows={r.parts.map((q) => row(q.name, q.est, q.se, q.expr))}
        note="Each part at the estimates, with its delta-method standard error; a part that varies from case to case (it uses a data column) has no single value." />
      {r.defined.length > 0 && <Table title="Defined parameters" file="customml-defined" columns={cols} rows={r.defined.map((q) => row(q.name, q.est, q.se, q.expr))} />}
    </div>
  );
}

const exprs = (v: unknown, max = 60) => (Array.isArray(v) ? v.slice(0, max).map((x) => name(x, 500)) : []);

export const customMlAnalysis: AnalysisType<CustomMlOptions, CustomMlResult> = {
  id: 'customml',
  title: 'Custom likelihood',
  sub: 'maximum likelihood for a model written as expressions (nominal, normal, probit)',
  group: 'Regression and causal inference',
  cardTitle: (o) => `Custom likelihood${o.outcomes.length ? `: ${o.outcomes.join(', ')}` : ''}`,
  defaults: () => ({ type: 'normal', outcomes: [], parameters: [{ name: 'mu', start: 0 }, { name: 'v', start: 1 }], logits: [], means: [], variances: [], covariances: [], defined: [], se: 'model' }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const pars = (Array.isArray(raw.parameters) ? raw.parameters.slice(0, 50) : []).filter(isObj).map((p) => ({ name: name(p.name, 31), start: Number.isFinite(Number(p.start)) ? Number(p.start) : 0 }));
    const defs = (Array.isArray(raw.defined) ? raw.defined.slice(0, 50) : []).filter(isObj).map((d) => ({ name: name(d.name, 31), expr: name(d.expr, 500) }));
    return { type: oneOf(raw.type, CUSTOMML_TYPES, 'normal'), outcomes: names(raw.outcomes, 10), parameters: pars,
      logits: exprs(raw.logits), means: exprs(raw.means, 10), variances: exprs(raw.variances, 10), covariances: exprs(raw.covariances, 45), defined: defs, se: oneOf(raw.se, ['model', 'robust', 'mplus'] as const, 'model') };
  },
  Options: CustomMlForm,
  View: ({ result }) => <CustomMlView result={result} />,
  blocked: (o, ctx) => {
    if (!o.outcomes.length) return 'Choose the outcome(s).';
    const gone = missingColumns(ctx, o.outcomes, 'The custom likelihood');
    if (gone) return gone;
    if (o.type === 'nominal' && o.outcomes.length !== 1) return 'A nominal model has one outcome.';
    if (o.type === 'probit' && o.outcomes.length > 2) return 'The probit model takes one or two binary outcomes.';
    if (!o.parameters.length) return 'Name at least one parameter (name = start value).';
    for (const p of o.parameters) { const e = nameError(p.name); if (e) return `Parameter: ${e}`; }
    if (new Set(o.parameters.map((p) => p.name)).size !== o.parameters.length) return 'Each parameter needs its own name.';
    if (o.type === 'nominal' && !o.logits.filter((l) => l.trim()).length) return 'Give the logit of each category but the last, one per line.';
    if (o.type === 'nominal' && o.logits.some((l) => !l.trim())) return 'Every logit needs an expression (no empty lines).';
    if (o.type !== 'nominal' && (o.means.length !== o.outcomes.length || o.means.some((m) => !m.trim()) || o.variances.some((m) => !m.trim()))) return `Give each outcome a ${o.type === 'probit' ? 'threshold' : 'mean'} and a variance.`;
    const columns = rawData(ctx)!.names;
    const known = new Set([...o.parameters.map((p) => p.name), ...columns.filter((n) => !o.outcomes.includes(n))]);
    for (const [what, e] of customMlExpressions(o)) {
      try { const bad = customMlNames(e).filter((n) => !known.has(n)); if (bad.length) return `${what[0].toUpperCase()}${what.slice(1)}: ${bad.join(', ')} is neither a parameter nor a data column.`; }
      catch (err) { return `${what[0].toUpperCase()}${what.slice(1)}: ${(err as Error).message}`; }
    }
    const seen = new Set(o.parameters.map((p) => p.name));
    for (const d of o.defined) {
      const e = nameError(d.name); if (e) return `Defined parameter: ${e}`;
      if (seen.has(d.name) || columns.includes(d.name)) return `“${d.name}” is already a parameter or a column: give the defined parameter a name of its own.`;
      try { const bad = customMlNames(d.expr).filter((n) => !seen.has(n)); if (bad.length) return `Defined parameter ${d.name}: ${bad.join(', ')} is not a parameter (or an earlier defined one).`; }
      catch (err) { return `Defined parameter ${d.name}: ${(err as Error).message}`; }
      seen.add(d.name);
    }
    return null;
  },
  fingerprint: (o, ctx) => { const ds = rawData(ctx); return ds ? columnsFingerprint(ctx, customMlColumns(o, ds.names), [o.type, o.se]) : null; },
  run: async (o, ctx) => (await import('../rengine/customml')).customMlR(rawData(ctx)!, o),
  script: async (o, ctx) => (await import('../rengine/customml')).customMlScriptR(rawData(ctx)!, o),
  summary: (o) => (o.outcomes.length ? `${o.type} · ${o.outcomes.join(', ')} · ${o.parameters.length} parameter${o.parameters.length === 1 ? '' : 's'}${o.se === 'robust' ? ' · MLR' : o.se === 'mplus' ? ' · MLR (Mplus)' : ''}` : 'not set up yet'),
};

// Bayesian multivariate regression with flat priors: the exact posterior (R/customml.R, ps_bmvreg).

export type BmvregOptions = BmvregInput;

function BmvregForm({ options: o, set, ctx, disabled }: OptionsProps<BmvregOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>Outcomes regressed on the same predictors, by Bayes with flat priors (Mplus ESTIMATOR = BAYES with its default priors). The posterior is known exactly, so it is drawn directly: no MCMC, no burn-in, no convergence to check. For a VAR(1) time series, regress the outcomes on their lags (computed columns such as lag(y1)).</p>
      <OrderedPicker label="Outcomes" columns={columns.filter((n) => !o.predictors.includes(n))} value={o.outcomes} onChange={(outcomes) => set({ ...o, outcomes })} />
      <OrderedPicker label="Predictors" columns={columns.filter((n) => !o.outcomes.includes(n))} value={o.predictors} onChange={(predictors) => set({ ...o, predictors })} />
      <div className="field">
        <label htmlFor="bmv-draws">Draws from the posterior</label>
        <input id="bmv-draws" className="input num" type="number" min={1000} max={1000000} value={o.draws} onChange={(e) => set({ ...o, draws: clampNum(e.target.value, 1000, 1e6, 50000, true) })} />
      </div>
      <div className="field">
        <label htmlFor="bmv-seed">Seed</label>
        <input id="bmv-seed" className="input num" type="number" value={o.seed} onChange={(e) => set({ ...o, seed: clampNum(e.target.value, 1, 2 ** 31 - 1, 1, true) })} />
      </div>
    </fieldset>
  );
}

function BmvregView({ result: r }: { result: BmvregResult }) {
  return (
    <div className="tables">
      <div className="stat-cards">{([['n', String(r.n)], ['Draws', String(r.draws)], ['Posterior df (inverse Wishart)', String(r.df)]] as [string, string][]).map(([k, v]) => <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}</div>
      <Table title="Posterior" file="bmvreg-posterior" columns={['Parameter', 'Median', 'Mean', 'SD', '2.5%', '97.5%', 'One-tailed p']}
        rows={r.parameters.map((q) => [c(`${q.name}${q.exact ? '' : ' *'}`), c(q.median), c(q.mean), c(q.sd), c(q.lower), c(q.upper), c(q.pOne)])}
        note={`Flat priors on the coefficients, intercepts and residual covariance matrix: the posterior is inverse Wishart for the residual covariance matrix and matrix normal for the coefficients given it (Box & Tiao 1973; Zellner 1971). Medians are exact (the least-squares coefficients; the inverse-gamma medians of the residual variances), except those marked *, which, with the SDs, intervals and one-tailed p (the posterior probability of the other sign, as Mplus prints), come from ${r.draws.toLocaleString()} independent draws (seed ${r.seed}).`} />
    </div>
  );
}

export const bmvregAnalysis: AnalysisType<BmvregOptions, BmvregResult> = {
  id: 'bmvreg',
  title: 'Bayesian multivariate regression',
  sub: 'several outcomes, flat priors: the exact posterior (also VAR models on lagged columns)',
  group: 'Regression and causal inference',
  cardTitle: (o) => `Bayesian multivariate regression${o.outcomes.length ? `: ${o.outcomes.join(', ')}` : ''}`,
  defaults: () => ({ outcomes: [], predictors: [], draws: 50000, seed: 1 }),
  parseOptions: (raw) => (isObj(raw) ? { outcomes: names(raw.outcomes, 10), predictors: names(raw.predictors, 50), draws: clampNum(raw.draws, 1000, 1e6, 50000, true), seed: clampNum(raw.seed, 1, 2 ** 31 - 1, 1, true) } : null),
  Options: BmvregForm,
  View: ({ result }) => <BmvregView result={result} />,
  blocked: (o, ctx) => {
    if (!o.outcomes.length) return 'Choose the outcomes.';
    if (o.outcomes.some((y) => o.predictors.includes(y))) return 'A column cannot be both an outcome and a predictor.';
    return missingColumns(ctx, [...o.outcomes, ...o.predictors], 'The Bayesian multivariate regression');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [...o.outcomes, ...o.predictors], [o.draws, o.seed, o.outcomes.length]),
  run: async (o, ctx) => (await import('../rengine/customml')).bmvregR(rawData(ctx)!, o),
  script: async (o, ctx) => (await import('../rengine/customml')).bmvregScriptR(rawData(ctx)!, o),
  summary: (o) => (o.outcomes.length ? `${o.outcomes.join(', ')} on ${o.predictors.join(', ') || 'the intercept'} · ${o.draws.toLocaleString()} draws` : 'not set up yet'),
};
