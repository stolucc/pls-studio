// Generalized linear mixed models as an analysis card: count (Poisson, negative binomial, zero-inflated) and
// binomial outcomes with random intercepts and slopes, by adaptive Gauss-Hermite quadrature (GLMMadaptive).

import { fmt } from '../format';
import { GLMM_FAMILIES, glmmColumns, zeroInflated, type GlmmCoef, type GlmmFamily, type GlmmInput, type GlmmResult } from '../rengine/glmm';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table } from '../components/results/Table';
import { Choice, ColumnSelect, clampNum, columnsFingerprint, isObj, missingColumns, name, names, oneOf, rawData } from './common';
import type { AnalysisType, OptionsProps } from './types';

export type GlmmOptions = GlmmInput;

const FAMILIES: { id: GlmmFamily; label: string; hint: string }[] = [
  { id: 'poisson', label: 'Poisson (counts)', hint: 'Counts 0, 1, 2, … with a log link.' },
  { id: 'negbin', label: 'Negative binomial (overdispersed counts)', hint: 'Counts whose variance exceeds the mean: μ + μ²/θ.' },
  { id: 'zip', label: 'Zero-inflated Poisson', hint: 'Counts with extra zeros: a zero part (logit of a structural zero) with its own predictors and random intercept.' },
  { id: 'zinb', label: 'Zero-inflated negative binomial', hint: 'Overdispersed counts with extra zeros.' },
  { id: 'binomial', label: 'Binomial (binary or successes of trials)', hint: 'A binary outcome, or the number of successes out of a trials column, with a logit link.' },
];

const coefRows = (rows: GlmmCoef[]) => rows.map((f) => [c(f.term), c(f.est), c(f.se), c(f.z, undefined, 2), pCell(f.p)]);

export function GlmmView({ r }: { r: GlmmResult }) {
  const lab = (x: string, zero: boolean) => `${x}${zero ? ' (zero part)' : ''}`;
  const link = r.family === 'binomial' ? 'logit' : 'log';
  return (
    <div className="tables">
      <div className="stat-cards">
        {([['Observations', r.n, 0], [r.layout === 'wide' ? 'Persons' : 'Clusters', r.clusters, 0], ['Log-likelihood', r.logLik, 3], ['Parameters', r.npar, 0], ['AIC', r.aic, 2], ['BIC', r.bic, 2]] as const).map(([k, v, d]) => (
          <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{fmt(v, d)}</div></div>
        ))}
      </div>
      <Table title={`Fixed effects (${link} scale)`} file="glmm-fixed" columns={['Term', 'Estimate', r.robust ? 'Robust SE' : 'Std. error', 'z', 'p']} rows={coefRows(r.fixed)}
        note={`${r.layout === 'wide' ? 'The intercept is the mean of the random intercept (Mplus’s i), time that of the random slope (s). ' : ''}${r.robust ? 'Robust (sandwich) standard errors over the clusters, as Mplus’s MLR.' : 'Standard errors from the inverse Hessian.'}`} />
      {r.zero && <Table title="Zero part (logit of a structural zero)" file="glmm-zero" columns={['Term', 'Estimate', r.robust ? 'Robust SE' : 'Std. error', 'z', 'p']} rows={coefRows(r.zero)}
        note="The probability that an observation is an excess zero, whatever the count part predicts (Mplus’s u#1 intercepts and the slope of its zero-inflation growth factor)." />}
      <Table title="Random effects" file="glmm-random" columns={['Component', 'Estimate', r.robust ? 'Robust SE' : 'Std. error']}
        rows={r.random.map((x) => [c(x.b ? `${lab(x.a, x.zeroA)} ↔ ${lab(x.b, x.zeroB)} (covariance)` : `${lab(x.a, x.zeroA)} (variance)`), c(x.est), c(x.se)])}
        note={`Variances and covariances of the random effects across ${r.layout === 'wide' ? 'persons' : 'clusters'}; standard errors by the delta method from GLMMadaptive’s log-Cholesky parameters.`} />
      {r.logPhi && <Table title="Dispersion" file="glmm-dispersion" columns={['Parameter', 'Estimate', 'Std. error']} rows={[[c('log θ'), c(r.logPhi.est), c(r.logPhi.se)], [c('θ'), c(Math.exp(r.logPhi.est)), c(null)]]}
        note="Negative binomial: variance μ + μ²/θ; a large θ is close to Poisson." />}
      <div className="hint">Maximum likelihood by adaptive Gauss-Hermite quadrature, {r.quadrature} points per random effect (GLMMadaptive).{r.converged ? '' : ' The optimiser did not report convergence.'}</div>
    </div>
  );
}

function Checks({ label, items, value, onChange, hint }: { label: string; items: string[]; value: string[]; onChange: (v: string[]) => void; hint?: string }) {
  if (!items.length) return null;
  return (
    <div className="field">
      <label>{label}</label>
      {items.map((p) => (
        <label key={p} className="check" style={{ marginBottom: 4 }}>
          <input type="checkbox" checked={value.includes(p)} onChange={(e) => onChange(e.target.checked ? [...value, p] : value.filter((x) => x !== p))} />
          <span>{p}</span>
        </label>
      ))}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function GlmmOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<GlmmOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) return <div className="empty-results">Import raw data first: one row per observation (long) or per person with a column per occasion (wide).</div>;
  const wide = o.layout === 'wide';
  const fixed = wide ? ['time', ...o.predictors] : o.predictors;
  const numeric = wide ? fixed : o.predictors.filter((p) => !o.categorical.includes(p));
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice label="Data layout" value={o.layout} onChange={(layout) => set({ ...o, layout, slopes: [], ziPredictors: [] })}
        options={[['long', 'Long (a row per observation)'], ['wide', 'Wide (a column per occasion)']]}
        hint="Wide: repeated measures in columns, each with a time score (Mplus’s growth models for counts, i s | u1@0 u2@1 …); the person is the cluster." />
      <div className="field">
        <label htmlFor="glmm-family">Outcome distribution</label>
        <select id="glmm-family" className="select" value={o.family} onChange={(e) => set({ ...o, family: e.target.value as GlmmFamily })}>
          {FAMILIES.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <div className="hint">{FAMILIES.find((f) => f.id === o.family)!.hint}</div>
      </div>
      {wide ? (
        <>
          <OrderedPicker label="Occasions (in time order)" columns={columns.filter((n) => !o.predictors.includes(n))} value={o.occasions} onChange={(occasions) => set({ ...o, occasions })} />
          <div className="field">
            <label htmlFor="glmm-times">Time scores</label>
            <input id="glmm-times" className="input" defaultValue={o.times.join(', ')} placeholder={o.occasions.map((_, i) => i).join(', ') || '0, 1, 2, 3'}
              onChange={(e) => { const v = e.target.value.trim() ? e.target.value.split(/[,\s]+/).filter(Boolean).map(Number) : []; if (v.every(Number.isFinite)) set({ ...o, times: v }); }} />
            <div className="hint">One per occasion; empty: 0, 1, 2, …</div>
          </div>
        </>
      ) : (
        <>
          <ColumnSelect id="glmm-y" label="Outcome" value={o.outcome} columns={columns} exclude={[o.cluster, ...o.predictors]} onChange={(outcome) => set({ ...o, outcome })} />
          <ColumnSelect id="glmm-g" label="Clusters (e.g. school, person)" value={o.cluster} columns={columns} exclude={[o.outcome, ...o.predictors]} onChange={(cluster) => set({ ...o, cluster })} />
          {o.family === 'binomial' && <ColumnSelect id="glmm-trials" label="Trials (optional)" value={o.trials ?? ''} columns={columns} exclude={[o.outcome, o.cluster, ...o.predictors]} optional="None: a binary outcome"
            onChange={(trials) => set({ ...o, trials: trials || undefined })} />}
        </>
      )}
      <OrderedPicker label={wide ? 'Covariates (time-invariant)' : 'Predictors'} columns={columns.filter((n) => n !== o.outcome && n !== o.cluster && n !== o.trials && !o.occasions.includes(n))} value={o.predictors}
        onChange={(predictors) => set({ ...o, predictors, categorical: o.categorical.filter((x) => predictors.includes(x)), slopes: o.slopes.filter((x) => x === 'time' || predictors.includes(x)), ziPredictors: o.ziPredictors.filter((x) => x === 'time' || predictors.includes(x)) })} />
      {!wide && <Checks label="Categorical predictors" items={o.predictors} value={o.categorical} onChange={(categorical) => set({ ...o, categorical, slopes: o.slopes.filter((x) => !categorical.includes(x)) })} hint="Entered as dummies against the first category." />}
      <Checks label="Random slopes" items={numeric} value={o.slopes} onChange={(slopes) => set({ ...o, slopes })}
        hint={`Every ${wide ? 'person' : 'cluster'} has its own intercept; a random slope also gives it its own effect of that predictor (correlated with the intercept).`} />
      {zeroInflated(o.family) && (
        <>
          <Checks label="Predictors of the zero part" items={fixed} value={o.ziPredictors} onChange={(ziPredictors) => set({ ...o, ziPredictors })} />
          <label className="check"><input type="checkbox" checked={o.ziRandom} onChange={(e) => set({ ...o, ziRandom: e.target.checked })} />
            <span>Random intercept in the zero part (correlated with the count part’s random effects)</span></label>
        </>
      )}
      <div className="field">
        <label htmlFor="glmm-quad">Quadrature points</label>
        <input id="glmm-quad" className="input num" type="number" min={1} max={51} value={o.quadrature}
          onChange={(e) => set({ ...o, quadrature: Math.max(1, Math.min(51, Math.round(Number(e.target.value)) || 11)) })} />
        <div className="hint">Adaptive Gauss-Hermite points per random effect (GLMMadaptive’s default 11; 1 is the Laplace approximation). The work grows as points^(random effects); check that more points leave the log-likelihood unchanged.</div>
      </div>
      <label className="check"><input type="checkbox" checked={o.robust} onChange={(e) => set({ ...o, robust: e.target.checked })} />
        <span>Robust standard errors (sandwich; Mplus’s MLR)</span></label>
    </fieldset>
  );
}

const DEFAULTS: GlmmOptions = { layout: 'long', outcome: '', cluster: '', occasions: [], times: [], predictors: [], categorical: [], slopes: [], family: 'poisson', ziPredictors: [], ziRandom: false, quadrature: 11, robust: false };

export const glmmAnalysis: AnalysisType<GlmmOptions, GlmmResult> = {
  id: 'glmm',
  title: 'Generalized linear mixed model',
  sub: 'count and binary outcomes with random effects (GLMMadaptive)',
  group: 'Regression and causal inference',
  defaults: () => ({ ...DEFAULTS }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const predictors = names(raw.predictors);
    const layout = oneOf(raw.layout, ['long', 'wide'] as const, 'long');
    const okSlope = (x: string) => predictors.includes(x) || (layout === 'wide' && x === 'time');
    const o: GlmmOptions = {
      layout, outcome: name(raw.outcome), cluster: name(raw.cluster), occasions: names(raw.occasions),
      times: Array.isArray(raw.times) ? raw.times.slice(0, 500).map(Number).filter(Number.isFinite) : [],
      predictors, categorical: names(raw.categorical).filter((x) => predictors.includes(x)), slopes: names(raw.slopes).filter(okSlope),
      family: oneOf(raw.family, GLMM_FAMILIES, 'poisson'), ziPredictors: names(raw.ziPredictors).filter(okSlope), ziRandom: raw.ziRandom === true,
      quadrature: clampNum(raw.quadrature, 1, 51, 11, true), robust: raw.robust === true,
    };
    if (raw.trials !== undefined && name(raw.trials)) o.trials = name(raw.trials);
    return o;
  },
  Options: GlmmOptionsForm,
  View: ({ result }) => <GlmmView r={result} />,
  blocked: (o, ctx) => {
    if (o.layout === 'wide') {
      if (o.occasions.length < 2) return 'Choose at least two occasions.';
      if (o.times.length && o.times.length !== o.occasions.length) return 'Give one time score per occasion.';
      if (o.predictors.some((p) => o.occasions.includes(p))) return 'A covariate cannot be one of the occasions.';
      if (o.predictors.some((p) => ['id', 'time', 'y'].includes(p))) return 'In wide data a covariate cannot be named id, time or y.';
      if (o.categorical.length) return 'Categorical covariates are available with long data.';
    } else {
      if (!o.outcome || !o.cluster) return 'Choose the outcome and the cluster column.';
      if (o.outcome === o.cluster || o.predictors.includes(o.outcome) || o.predictors.includes(o.cluster)) return 'The outcome, the clusters and the predictors must be different columns.';
      if (o.slopes.some((s) => o.categorical.includes(s))) return 'A random slope needs a numeric predictor.';
    }
    return missingColumns(ctx, glmmColumns(o), 'Generalized linear mixed model');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, glmmColumns(o)),
  run: async (o, ctx) => (await import('../rengine/glmm')).glmmR(rawData(ctx)!, o),
  script: async (o, ctx) => (await import('../rengine/glmm')).glmmScriptR(rawData(ctx)!, o),
  summary: (o) => {
    const f = FAMILIES.find((x) => x.id === o.family)!.label.replace(/ \(.*\)$/, '');
    if (o.layout === 'wide') return o.occasions.length ? `${f} growth over ${o.occasions.length} occasions${o.slopes.length ? ' (random slope)' : ''}` : 'not set up yet';
    return o.outcome ? `${f}: ${o.predictors.join(', ') || 'intercept only'} → ${o.outcome} | ${o.cluster || '…'}${o.slopes.length ? ' (random slopes)' : ''}` : 'not set up yet';
  },
};
