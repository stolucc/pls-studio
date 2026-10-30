// Multilevel regression (lme4) as an analysis card: random intercepts and
// slopes, Satterthwaite tests (lmerTest).

import { fmt } from '../format';
import type { LmmInput, LmmResult } from '../rengine/mixed';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/LongitudinalPanel';
import { c, pCell, Table } from '../components/results/Table';
import { Choice, ColumnSelect, columnsFingerprint, isObj, missingColumns, name, names, oneOf, rawData } from './common';
import type { AnalysisType, OptionsProps } from './types';

/** Cluster-specific regression lines of the focal predictor (other predictors at 0). */
function ClusterLines({ l }: { l: NonNullable<LmmResult['lines']> }) {
  const W = 460, H = 260, pad = { l: 56, r: 14, t: 12, b: 40 };
  const [x0, x1] = l.range;
  const ends = l.intercepts.flatMap((a, i) => [a + l.slopes[i] * x0, a + l.slopes[i] * x1]);
  const lo = Math.min(...ends), hi = Math.max(...ends), span = hi - lo || 1;
  const sx = (x: number) => pad.l + ((x - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi + 0.06 * span - v) / (span * 1.12)) * (H - pad.t - pad.b);
  const shown = l.intercepts.slice(0, 200);
  return (
    <ChartFrame id="lmm:lines" name="multilevel-cluster-lines" width={W} height={H} defaults={{ x: l.predictor, y: 'Predicted outcome' }}>
      {(labels) => (
        <svg className="mc-chart" width={W} height={H} role="img" aria-label="Regression lines per cluster">
          <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(lo)} y2={sy(lo)} />
          <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(hi)} y2={sy(hi)} />
          <text x={pad.l - 6} y={sy(lo) + 4} textAnchor="end">{fmt(lo, 1)}</text>
          <text x={pad.l - 6} y={sy(hi) + 4} textAnchor="end">{fmt(hi, 1)}</text>
          <text x={sx(x0)} y={H - pad.b + 16} textAnchor="middle">{fmt(x0, 2)}</text>
          <text x={sx(x1)} y={H - pad.b + 16} textAnchor="middle">{fmt(x1, 2)}</text>
          {shown.map((a, i) => <line key={i} x1={sx(x0)} x2={sx(x1)} y1={sy(a + l.slopes[i] * x0)} y2={sy(a + l.slopes[i] * x1)} stroke="#94a3b8" strokeWidth={1} opacity={0.7} />)}
          <line x1={sx(x0)} x2={sx(x1)} y1={sy(l.fixed[0] + l.fixed[1] * x0)} y2={sy(l.fixed[0] + l.fixed[1] * x1)} stroke="#6d28d9" strokeWidth={2.6} />
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
          <text transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

export function LmmView({ r }: { r: LmmResult }) {
  const re = (x: LmmResult['random'][number]) => (x.group === 'Residual' ? 'Residual' : x.b ? `${x.a} ↔ ${x.b} (correlation)` : `${x.a} (across ${x.group})`);
  return (
    <div className="tables">
      <div className="stat-cards">
        {([['Observations', r.n, 0], ['Clusters', r.clusters, 0], ['ICC (empty model)', r.icc, 3], ['R² marginal', r.r2.marginal, 3], ['R² conditional', r.r2.conditional, 3]] as const).map(([k, v, d]) => (
          <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{fmt(v, d)}</div></div>
        ))}
      </div>
      <Table title="Fixed effects" file="lmm-fixed" columns={['Term', 'Estimate', 'Std. error', 'df', 't', 'p', 'CI low', 'CI high']}
        rows={r.fixed.map((f) => [c(f.term), c(f.est), c(f.se), c(f.df, undefined, 1), c(f.t, undefined, 2), pCell(f.p), c(f.ciLow), c(f.ciHigh)])}
        note="Degrees of freedom and p-values by Satterthwaite’s approximation (lmerTest); 95% Wald intervals. A “(cluster mean)” term is the between-cluster effect; the predictor itself is then the within-cluster effect." />
      <Table title="Random effects" file="lmm-random" columns={['Component', 'Variance', 'SD / correlation']}
        rows={r.random.map((x) => [c(re(x)), c(x.b ? null : x.variance), c(x.sd)])}
        note={`How much clusters differ in their intercepts${r.random.some((x) => x.a && x.a !== 'Intercept') ? ' and slopes' : ''}, and the residual variance within clusters. ${r.reml ? 'REML estimates.' : 'Maximum likelihood estimates.'}`} />
      {r.slopeTest && (
        <Table title="Random slopes versus random intercepts only" file="lmm-slopes" columns={['χ²', 'df', 'p']} rows={[[c(r.slopeTest.chisq, undefined, 2), c(r.slopeTest.df, undefined, 0), pCell(r.slopeTest.p)]]}
          note="Likelihood-ratio test of the slope variances and covariances. Variances cannot be negative (a boundary), so the p-value is conservative." />
      )}
      <Table title="Model" file="lmm-fit" columns={['Log-likelihood', 'AIC', 'BIC']} rows={[[c(r.logLik, undefined, 2), c(r.aic, undefined, 1), c(r.bic, undefined, 1)]]}
        note="R² after Nakagawa & Schielzeth (2013), with Johnson’s (2014) extension for random slopes: marginal = fixed effects, conditional = fixed and random effects. ICC: share of the outcome’s variance between clusters." />
      {r.singular && <div className="issue warning">The fit is singular: a variance is (near) zero or a correlation is ±1. The random-effects structure is probably more complex than the data support; consider fewer random slopes.</div>}
      {r.lines && <ClusterLines l={r.lines} />}
      {r.lines && <div className="hint">Grey: each cluster’s line for {r.lines.predictor} (other predictors at 0); purple: the average (fixed) line.</div>}
    </div>
  );
}

function LmmOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<LmmInput>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) return <div className="empty-results">Import raw data with a cluster column first (one row per person or occasion).</div>;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <ColumnSelect id="lmm-y" label="Outcome" value={o.outcome} columns={columns} exclude={[o.cluster, ...o.predictors]} onChange={(outcome) => set({ ...o, outcome })} />
      <ColumnSelect id="lmm-g" label="Clusters (e.g. school, person)" value={o.cluster} columns={columns} exclude={[o.outcome, ...o.predictors]} onChange={(cluster) => set({ ...o, cluster })} />
      <OrderedPicker label="Predictors" columns={columns.filter((n) => n !== o.outcome && n !== o.cluster)} value={o.predictors}
        onChange={(predictors) => set({ ...o, predictors, slopes: o.slopes.filter((x) => predictors.includes(x)) })} />
      {o.predictors.length > 0 && (
        <div className="field">
          <label>Random slopes</label>
          {o.predictors.map((p) => (
            <label key={p} className="check" style={{ marginBottom: 4 }}>
              <input type="checkbox" checked={o.slopes.includes(p)} onChange={(e) => set({ ...o, slopes: e.target.checked ? [...o.slopes, p] : o.slopes.filter((x) => x !== p) })} />
              <span>{p} varies across clusters</span>
            </label>
          ))}
          <div className="hint">Every cluster gets its own intercept; a random slope also gives it its own effect of that predictor.</div>
        </div>
      )}
      <Choice label="Centring of the predictors" value={o.center} onChange={(center) => set({ ...o, center })}
        options={[['none', 'None'], ['grand', 'Grand mean'], ['cluster', 'Within / between']]}
        hint="Within / between: each predictor is split into its cluster mean (the between-cluster effect) and the deviation from it (the within-cluster effect)." />
      <Choice label="Estimation" value={o.estimation} onChange={(estimation) => set({ ...o, estimation })}
        options={[['REML', 'REML'], ['ML', 'ML']]}
        hint="REML gives unbiased variance components; ML is needed to compare models that differ in their fixed effects." />
    </fieldset>
  );
}

export const lmmAnalysis: AnalysisType<LmmInput, LmmResult> = {
  id: 'lmm',
  title: 'Multilevel regression',
  sub: 'random intercepts and slopes (lme4)',
  group: 'Regression and causal inference',
  defaults: () => ({ outcome: '', predictors: [], cluster: '', slopes: [], center: 'none', estimation: 'REML' }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const predictors = names(raw.predictors);
    return {
      outcome: name(raw.outcome), predictors, cluster: name(raw.cluster), slopes: names(raw.slopes).filter((x) => predictors.includes(x)),
      center: oneOf(raw.center, ['none', 'grand', 'cluster'] as const, 'none'), estimation: oneOf(raw.estimation, ['REML', 'ML'] as const, 'REML'),
    };
  },
  Options: LmmOptionsForm,
  View: ({ result }) => <LmmView r={result} />,
  blocked: (o, ctx) => {
    if (!o.outcome || !o.cluster) return 'Choose the outcome and the cluster column.';
    if (o.outcome === o.cluster || o.predictors.includes(o.outcome) || o.predictors.includes(o.cluster)) return 'The outcome, the clusters and the predictors must be different columns.';
    return missingColumns(ctx, [o.outcome, o.cluster, ...o.predictors], 'Multilevel regression');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [o.outcome, o.cluster, ...o.predictors]),
  run: async (o, ctx) => (await import('../rengine/mixed')).lmmR(rawData(ctx)!, o),
  script: async (o, ctx) => (await import('../rengine/mixed')).lmmScriptR(rawData(ctx)!, o),
  summary: (o) => (o.outcome ? `${o.predictors.join(', ') || 'intercept only'} → ${o.outcome} | ${o.cluster || '…'}${o.slopes.length ? ` (random slope${o.slopes.length > 1 ? 's' : ''})` : ''} · ${o.estimation}` : 'not set up yet'),
};
