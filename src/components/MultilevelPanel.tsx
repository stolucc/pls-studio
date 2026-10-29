import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { downloadText, fmt, safeFileName } from '../format';
import type { LmmInput, LmmResult } from '../rengine/mixed';
import { useStore } from '../store';
import { ChartFrame } from './ChartFrame';
import { IconX } from './icons';
import { OrderedPicker } from './LongitudinalPanel';
import { c, pCell, Table } from './results/Table';

interface MultilevelState {
  open: boolean;
  lmm: { input: LmmInput; result: LmmResult } | null;
  /** Inputs filled in by an example (applied when it changes). */
  preset: LmmInput | null;
  setOpen: (v: boolean) => void;
}
export const useMultilevel = create<MultilevelState>((set) => ({ open: false, lmm: null, preset: null, setOpen: (open) => set({ open }) }));

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

/** Multilevel regression with random intercepts and slopes (lme4), on the current dataset. */
export function MultilevelPanel() {
  const open = useMultilevel((s) => s.open);
  const lmm = useMultilevel((s) => s.lmm);
  const preset = useMultilevel((s) => s.preset);
  const data = useStore((s) => s.data);
  const project = useStore((s) => s.projectName);
  const [outcome, setOutcome] = useState(lmm?.input.outcome ?? '');
  const [predictors, setPredictors] = useState<string[]>(lmm?.input.predictors ?? []);
  const [cluster, setCluster] = useState(lmm?.input.cluster ?? '');
  const [slopes, setSlopes] = useState<string[]>(lmm?.input.slopes ?? []);
  const [center, setCenter] = useState<LmmInput['center']>(lmm?.input.center ?? 'none');
  const [estimation, setEstimation] = useState<LmmInput['estimation']>(lmm?.input.estimation ?? 'REML');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!preset) return;
    setOutcome(preset.outcome); setPredictors(preset.predictors); setCluster(preset.cluster); setSlopes(preset.slopes); setCenter(preset.center); setEstimation(preset.estimation);
  }, [preset]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') useMultilevel.getState().setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  const columns = data && !data.moments ? data.names : [];
  const input: LmmInput = { outcome, predictors, cluster, slopes: slopes.filter((x) => predictors.includes(x)), center, estimation };
  const ready = !!outcome && !!cluster && outcome !== cluster && !predictors.includes(outcome) && !predictors.includes(cluster);
  const fail = (e: unknown) => import('../rengine/bridge').then(({ rMessage }) => useStore.getState().toast('error', `lme4: ${rMessage(e)}`));
  const run = async () => {
    setBusy(true);
    try {
      const { lmmR } = await import('../rengine/mixed');
      const r = await lmmR(data!, input);
      r.warnings.forEach((w) => useStore.getState().logMessage('warning', w, `lme4 ${r.engine.version}`));
      useMultilevel.setState({ lmm: { input, result: r } });
    } catch (e) { await fail(e); } finally { setBusy(false); }
  };
  const script = async () => {
    try {
      const { lmmScriptR } = await import('../rengine/mixed');
      downloadText(`${safeFileName(project)}-lme4.R`, await lmmScriptR(data!, input), 'text/x-r-source');
    } catch (e) { await fail(e); }
  };
  const select = (label: string, value: string, set: (v: string) => void, exclude: string[]) => (
    <div className="field">
      <label>{label}</label>
      <select className="select" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Choose a column…</option>
        {columns.filter((n) => n === value || !exclude.includes(n)).map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
  return (
    <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="Multilevel regression">
      <div className="sim">
        <header className="sim-head">
          <div><b>Multilevel regression</b><span className="muted">lme4 · random intercepts and slopes · Satterthwaite tests (lmerTest)</span></div>
          <button className="btn icon ghost" onClick={() => useMultilevel.getState().setOpen(false)} aria-label="Close"><IconX /></button>
        </header>
        {!columns.length ? <div className="empty-results">Import raw data with a cluster column first (one row per person or occasion).</div> : (
          <div className="sim-body long-body">
            <section className="sim-col">
              {select('Outcome', outcome, setOutcome, [cluster, ...predictors])}
              {select('Clusters (e.g. school, person)', cluster, setCluster, [outcome, ...predictors])}
              <OrderedPicker label="Predictors" columns={columns.filter((n) => n !== outcome && n !== cluster)} value={predictors} onChange={setPredictors} />
              {predictors.length > 0 && (
                <div className="field">
                  <label>Random slopes</label>
                  {predictors.map((p) => (
                    <label key={p} className="check" style={{ marginBottom: 4 }}>
                      <input type="checkbox" checked={slopes.includes(p)} onChange={(e) => setSlopes(e.target.checked ? [...slopes, p] : slopes.filter((x) => x !== p))} />
                      <span>{p} varies across clusters</span>
                    </label>
                  ))}
                  <div className="hint">Every cluster gets its own intercept; a random slope also gives it its own effect of that predictor.</div>
                </div>
              )}
              <div className="field">
                <label>Centring of the predictors</label>
                <div className="segmented">
                  {([['none', 'None'], ['grand', 'Grand mean'], ['cluster', 'Within / between']] as const).map(([id, l]) => <button key={id} className={center === id ? 'on' : ''} onClick={() => setCenter(id)}>{l}</button>)}
                </div>
                <div className="hint">Within / between: each predictor is split into its cluster mean (the between-cluster effect) and the deviation from it (the within-cluster effect).</div>
              </div>
              <div className="field">
                <label>Estimation</label>
                <div className="segmented">
                  {(['REML', 'ML'] as const).map((id) => <button key={id} className={estimation === id ? 'on' : ''} onClick={() => setEstimation(id)}>{id}</button>)}
                </div>
                <div className="hint">REML gives unbiased variance components; ML is needed to compare models that differ in their fixed effects.</div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn primary" disabled={!ready || busy} onClick={() => void run()}>{busy ? 'Estimating…' : 'Estimate'}</button>
                <button className="btn" disabled={!ready} onClick={() => void script()}>R script</button>
              </div>
            </section>
            <section className="sim-col wide">
              {lmm ? <LmmView r={lmm.result} /> : <div className="empty-results">Choose the outcome, clusters and predictors, and press Estimate.</div>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
