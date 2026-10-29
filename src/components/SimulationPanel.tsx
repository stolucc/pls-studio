import { useEffect, useMemo, useState } from 'react';
import type { McDesign, McSummaryRow } from '../engine/montecarlo';
import { buildPopulation, type PopulationSpec } from '../engine/population';
import { fmt } from '../format';
import { defaultDesign, ESTIMATOR_CHOICES, populationFromModel } from '../model/simulation';
import { cancelSimulation, runSimulation, workerCount } from '../runner';
import { exportSimulationScript } from '../io';
import { useSim } from '../simStore';
import { useFreshResults, useStore } from '../store';
import { IconPlay, IconRepeat, IconX } from './icons';
import { c, Table, type Row } from './results/Table';
import { ChartFrame } from './ChartFrame';

/** Number input that keeps the typed text until blur (so "-0." can be typed). */
function Num({ value, onChange, step = 0.05, min, max, width = 64 }: {
  value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; width?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (!Number.isFinite(v)) { setText(String(value)); return; }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    onChange(clamped);
    setText(String(clamped));
  };
  return (
    <input className="input num" style={{ width, height: 26, padding: '0 6px' }} type="number" step={step} value={text}
      onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
  );
}

const COLORS = ['#4f46e5', '#0f9d63', '#d97706', '#db2777', '#0891b2', '#7c3aed', '#64748b', '#b91c1c'];

function PowerChart({ rows, paramKey, estimators, metric }: { rows: McSummaryRow[]; paramKey: string; estimators: string[]; metric: 'rejection' | 'relBias' | 'coverage' }) {
  const W = 460, H = 240, pad = { l: 54, r: 12, t: 12, b: 36 };
  const sel = rows.filter((r) => r.param.key === paramKey);
  const ns = [...new Set(sel.map((r) => r.n))].sort((a, b) => a - b);
  if (ns.length === 0) return null;
  const val = (r: McSummaryRow) => (metric === 'rejection' ? r.rejection : metric === 'coverage' ? r.coverage : r.relBias);
  const vals = sel.map(val).filter((v): v is number => v !== null && Number.isFinite(v));
  const [lo, hi] = metric === 'relBias'
    ? [Math.min(-0.1, ...vals) * 1.1, Math.max(0.1, ...vals) * 1.1]
    : [metric === 'coverage' ? Math.min(0.8, ...vals) : 0, 1];
  const sx = (n: number) => pad.l + (ns.length === 1 ? 0.5 : (Math.log(n) - Math.log(ns[0])) / (Math.log(ns[ns.length - 1]) - Math.log(ns[0]))) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  const ref = metric === 'rejection' ? 0.8 : metric === 'coverage' ? 0.95 : 0;
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const yTitle = metric === 'rejection' ? 'Power (rejection rate)' : metric === 'coverage' ? 'CI coverage' : 'Relative bias';
  return (
    <ChartFrame id={`mc:${metric}`} name={`simulation-${metric}`} width={W} height={H} defaults={{ x: 'Sample size', y: yTitle }}>
    {(labels) => (
    <svg className="mc-chart" width={W} height={H} role="img" aria-label={`${metric} by sample size`}>
      {ticks.map((v) => (
        <g key={v}><line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} /><text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">{metric === 'relBias' ? `${(v * 100).toFixed(0)}%` : v.toFixed(2)}</text></g>
      ))}
      <line className="ref-line" x1={pad.l} x2={W - pad.r} y1={sy(ref)} y2={sy(ref)} />
      {ns.map((n) => <text key={n} x={sx(n)} y={H - pad.b + 16} textAnchor="middle">{n}</text>)}
      <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
      <text transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
      {estimators.map((e, k) => {
        const pts = ns.map((n) => sel.find((r) => r.n === n && r.estimator === e)).filter((r): r is McSummaryRow => !!r && val(r) !== null);
        if (!pts.length) return null;
        return (
          <g key={e}>
            <path d={pts.map((r, i) => `${i ? 'L' : 'M'} ${sx(r.n)} ${sy(val(r)!)}`).join(' ')} stroke={COLORS[k % COLORS.length]} strokeWidth={2.2} fill="none" />
            {pts.map((r) => <circle key={r.n} cx={sx(r.n)} cy={sy(val(r)!)} r={3.5} fill={COLORS[k % COLORS.length]} />)}
          </g>
        );
      })}
    </svg>
    )}
    </ChartFrame>
  );
}

export function SimulationPanel() {
  const engine = useStore((st) => st.settings.engine);
  const sim = useSim();
  const model = useStore((s) => s.model);
  const method = useStore((s) => s.settings.method);
  const results = useFreshResults();
  const design = sim.design;
  const [paramKey, setParamKey] = useState('');
  const [metric, setMetric] = useState<'rejection' | 'relBias' | 'coverage'>('rejection');
  const [sizesText, setSizesText] = useState('');

  useEffect(() => {
    if (sim.open && !design && model.constructs.length) {
      sim.setDesign(defaultDesign(populationFromModel(model, method === 'pls' ? results?.pls ?? null : null, method === 'cbsem' ? results?.cb ?? null : null)));
    }
  }, [sim.open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (design) setSizesText(design.sampleSizes.join(', ')); }, [design?.sampleSizes]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sim.open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); sim.setOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [sim.open]); // eslint-disable-line react-hooks/exhaustive-deps

  const check = useMemo(() => {
    if (!design) return null;
    try { return { pop: buildPopulation(design.population), error: null as string | null }; } catch (e) { return { pop: null, error: e instanceof Error ? e.message : String(e) }; }
  }, [design]);

  if (!sim.open) return null;
  const close = () => sim.setOpen(false);
  const set = (patch: Partial<McDesign>) => design && sim.setDesign({ ...design, ...patch });
  const setPop = (fn: (p: PopulationSpec) => PopulationSpec) => design && set({ population: fn(design.population) });
  const fromEstimates = () => sim.setDesign({
    ...(design ?? defaultDesign(populationFromModel(model, null, null))),
    population: populationFromModel(model, method === 'pls' ? results?.pls ?? null : null, method === 'cbsem' ? results?.cb ?? null : null),
  });
  const stale = sim.rows && design && sim.rowsFor !== JSON.stringify(design);
  const params = sim.rows ? [...new Map(sim.rows.map((r) => [r.param.key, r.param])).values()] : [];
  const activeParam = params.find((p) => p.key === paramKey) ?? params[0];
  const workUnits = design ? design.replications * design.sampleSizes.length * design.estimators.reduce((s, e) => s + (e.method === 'pls' ? Math.max(1, design.bootSamples) : 1), 0) : 0;

  return (
    <div className="sim-backdrop" role="dialog" aria-modal="true" aria-label="Monte Carlo simulation">
      <div className="sim">
        <header className="sim-head">
          <div><b>Monte Carlo simulation</b> <span className="muted">power, sample size and estimator comparison</span></div>
          <button className="btn icon ghost" onClick={close} aria-label="Close"><IconX /></button>
        </header>
        {!design ? <div className="empty-results" style={{ padding: 24 }}>Build a model first: the population uses its constructs, indicators and paths.</div> : (
          <div className="sim-body">
            <section className="sim-col">
              <div className="table-tools">
                <h3>Population model</h3>
                <button className="btn sm" onClick={fromEstimates} title="Use the current estimates as population values">{results ? 'Use current estimates' : 'Reset to defaults'}</button>
              </div>
              {model.moderations.length > 0 && <div className="issue warning">Interaction effects are not simulated; moderations are ignored.</div>}
              {(model.correlations?.length ?? 0) > 0 && <div className="issue warning">Correlated errors and disturbances are not simulated: the population has uncorrelated errors and the replications are estimated without the correlation arrows.</div>}
              {method === 'pls' && results?.pls && !results.pls.consistent && model.constructs.some((k) => k.type === 'factor') && (
                <div className="hint" style={{ marginBottom: 8 }}>Tip: plain PLS estimates of common factors are inconsistent (loadings too high, paths too low). For a common-factor population, take values from PLSc or CB-SEM estimates.</div>
              )}
              {check?.error && <div className="issue error">{check.error}</div>}
              {design.population.constructs.map((k, ci) => (
                <div className="pop-block" key={k.name}>
                  <div className="pop-head"><b>{k.name}</b> <span className="chip">{k.type === 'composite' ? 'composite: weights' : 'common factor: loadings'}</span>
                    {check?.pop && check.pop.r2[ci] !== null && <span className="muted num" style={{ marginLeft: 'auto' }}>R² {fmt(check.pop.r2[ci])}</span>}
                  </div>
                  <div className="pop-items">
                    {k.indicators.map((ind, ii) => (
                      <label key={ind}><span title={ind}>{ind}</span>
                        <Num value={(k.type === 'factor' ? k.loadings?.[ii] : k.weights?.[ii]) ?? 0} min={k.type === 'factor' ? -0.99 : -100} max={k.type === 'factor' ? 0.99 : 100}
                          onChange={(v) => setPop((p) => ({ ...p, constructs: p.constructs.map((x, j) => (j !== ci ? x : k.type === 'factor'
                            ? { ...x, loadings: (x.loadings ?? x.indicators.map(() => 0.75)).map((l, a) => (a === ii ? v : l)) }
                            : { ...x, weights: (x.weights ?? x.indicators.map(() => 1)).map((w, a) => (a === ii ? v : w)) })) }))} />
                      </label>
                    ))}
                    {k.type === 'composite' && (
                      <label><span>indicator r</span><Num value={k.withinCor ?? 0.5} min={-0.5} max={0.99}
                        onChange={(v) => setPop((p) => ({ ...p, constructs: p.constructs.map((x, j) => (j === ci ? { ...x, withinCor: v } : x)) }))} /></label>
                    )}
                  </div>
                </div>
              ))}
              <div className="pop-block">
                <div className="pop-head"><b>Structural paths</b> <span className="muted">standardised; 0 tests Type I error</span></div>
                <div className="pop-items">
                  {design.population.paths.map((p, pi) => (
                    <label key={`${p.from}-${p.to}`}><span title={`${p.from} → ${p.to}`}>{p.from} → {p.to}</span>
                      <Num value={p.value} min={-0.99} max={0.99} onChange={(v) => setPop((pp) => ({ ...pp, paths: pp.paths.map((x, i) => (i === pi ? { ...x, value: v } : x)) }))} />
                    </label>
                  ))}
                  {design.population.exoCor.map((r, ri) => (
                    <label key={`${r.a}-${r.b}`}><span title={`${r.a} ↔ ${r.b} (correlation)`}>{r.a} ↔ {r.b}</span>
                      <Num value={r.value} min={-0.99} max={0.99} onChange={(v) => setPop((pp) => ({ ...pp, exoCor: pp.exoCor.map((x, i) => (i === ri ? { ...x, value: v } : x)) }))} />
                    </label>
                  ))}
                </div>
              </div>
            </section>

            <section className="sim-col narrow">
              <h3>Design</h3>
              <div className="field"><label>Sample sizes</label>
                <input className="input" value={sizesText} onChange={(e) => setSizesText(e.target.value)}
                  onBlur={() => {
                    const sizes = [...new Set(sizesText.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 10 && n <= 100000))].sort((a, b) => a - b).slice(0, 20);
                    if (sizes.length) set({ sampleSizes: sizes }); else setSizesText(design.sampleSizes.join(', '));
                  }} />
              </div>
              <div className="row2">
                <div className="field"><label>Replications</label><Num value={design.replications} step={50} min={2} max={100000} width={90} onChange={(v) => set({ replications: Math.round(v) })} /></div>
                <div className="field"><label>α</label><Num value={design.alpha} step={0.01} min={0.001} max={0.2} width={90} onChange={(v) => set({ alpha: v })} /></div>
              </div>
              <div className="field"><label>Estimators</label>
                <div className="est-grid">
                  {ESTIMATOR_CHOICES.map((e) => (
                    <label key={e.id} className="check" style={{ margin: 0 }}>
                      <input type="checkbox" checked={design.estimators.some((x) => x.id === e.id)}
                        onChange={(ev) => set({ estimators: ev.target.checked ? ESTIMATOR_CHOICES.filter((x) => x.id === e.id || design.estimators.some((y) => y.id === x.id)) : design.estimators.filter((x) => x.id !== e.id) })} />
                      {e.id}
                    </label>
                  ))}
                </div>
              </div>
              <div className="row2">
                <div className="field"><label>Bootstrap / rep (PLS)</label><Num value={design.bootSamples} step={50} min={0} max={10000} width={90} onChange={(v) => set({ bootSamples: Math.round(v) })} /></div>
                <div className="field"><label>MC draws (CB indirect)</label><Num value={design.mcDraws} step={500} min={0} max={1000000} width={90} onChange={(v) => set({ mcDraws: Math.round(v) })} /></div>
              </div>
              <div className="field"><label>Indicator distribution</label>
                <div className="segmented">
                  <button className={!(design.population.skew || design.population.kurtosis) ? 'on' : ''}
                    onClick={() => setPop((p) => ({ ...p, skew: 0, kurtosis: 0 }))}>Normal</button>
                  <button className={design.population.skew || design.population.kurtosis ? 'on' : ''}
                    onClick={() => setPop((p) => ({ ...p, skew: p.skew || 1, kurtosis: p.kurtosis || 3 }))}>Non-normal</button>
                </div>
              </div>
              {(design.population.skew || design.population.kurtosis) ? (
                <div className="row2">
                  <div className="field"><label>Skewness</label><Num value={design.population.skew ?? 0} step={0.25} min={-5} max={5} width={90} onChange={(v) => setPop((p) => ({ ...p, skew: v }))} /></div>
                  <div className="field"><label>Excess kurtosis</label><Num value={design.population.kurtosis ?? 0} step={0.5} min={-1.2} max={60} width={90} onChange={(v) => setPop((p) => ({ ...p, kurtosis: v }))} /></div>
                </div>
              ) : null}
              <div className="field"><label>Random seed</label><Num value={design.seed} step={1} min={0} max={2 ** 31} width={110} onChange={(v) => set({ seed: Math.round(v) })} /></div>
              <div className="hint" style={{ marginBottom: 10 }}>
                CB-SEM analyses every construct as a common factor, so composite populations show its misspecification bias.
                Non-normal data use the Vale–Maurelli method (Fleishman polynomials, population correlations preserved); compare ML with MLM/MLMV/MLR via the model χ² test. PLS with 0 bootstrap samples reports bias and RMSE only.
                {engine === 'r'
                  ? <> Data: lavaan::simulateData; estimation: cSEM (PLS) and lavaan (CB-SEM), in your browser. About {workUnits.toLocaleString()} model estimations, one at a time.</>
                  : <> About {workUnits.toLocaleString()} model estimations on {workerCount()} cores (built-in engine).</>}
              </div>
              {sim.job ? (
                <div className="progress" style={{ minWidth: 0 }}>
                  <span className="muted">{sim.job.done}/{sim.job.total}</span>
                  <div className="bar"><div className="fill" style={{ width: `${(100 * sim.job.done) / sim.job.total}%` }} /></div>
                  <button className="btn sm" onClick={cancelSimulation}>Cancel</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primary" disabled={!check?.pop || design.estimators.length === 0} onClick={() => void runSimulation(design)}>
                    {sim.rows ? <IconRepeat size={14} /> : <IconPlay size={14} />} Run simulation
                  </button>
                  {engine === 'r' && (
                    <button className="btn" disabled={!check?.pop || design.estimators.length === 0} onClick={() => void exportSimulationScript(design)}
                      title="Download the R script for the whole simulation (lavaan::simulateData, cSEM, lavaan), to run it in R or RStudio.">
                      R script
                    </button>
                  )}
                </div>
              )}
            </section>

            <section className="sim-col wide">
              <div className="table-tools">
                <h3>Results</h3>
                {stale && <span className="verdict bad">design changed since this run</span>}
              </div>
              {!sim.rows ? <div className="empty-results">Run the simulation to see power curves and bias.</div> : activeParam && (
                <>
                  <div className="ipma-controls">
                    <label>Parameter
                      <select className="select" value={activeParam.key} onChange={(e) => setParamKey(e.target.value)}>
                        {params.map((p) => (
                          <option key={p.key} value={p.key}>
                            {p.kind === 'fit' ? 'Model χ² test (CB-SEM, correct model)' : `${p.kind === 'indirect' ? 'indirect ' : ''}${p.from} → ${p.to} (true ${fmt(p.value)})`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="segmented" style={{ width: 270 }}>
                      <button className={metric === 'rejection' ? 'on' : ''} onClick={() => setMetric('rejection')}>{Math.abs(activeParam.value) < 1e-12 ? 'Type I' : 'Power'}</button>
                      <button className={metric === 'relBias' ? 'on' : ''} onClick={() => setMetric('relBias')} disabled={Math.abs(activeParam.value) < 1e-12}>Rel. bias</button>
                      <button className={metric === 'coverage' ? 'on' : ''} onClick={() => setMetric('coverage')}>Coverage</button>
                    </div>
                  </div>
                  <PowerChart rows={sim.rows} paramKey={activeParam.key} estimators={(design.estimators ?? []).map((e) => e.id)} metric={metric} />
                  <div className="legend">
                    {design.estimators.map((e, k) => <span key={e.id}><i style={{ background: COLORS[k % COLORS.length] }} />{e.id}</span>)}
                  </div>
                  <Table title={activeParam.kind === 'fit' ? 'Model χ² test' : `${activeParam.from} → ${activeParam.to}${activeParam.kind === 'indirect' ? ' (indirect)' : ''}`} file="simulation"
                    columns={['Estimator', 'N', 'Reps', 'Mean', 'Bias', 'Rel. bias', 'SD', 'RMSE', 'Coverage', Math.abs(activeParam.value) < 1e-12 ? 'Type I' : 'Power']}
                    rows={sim.rows.filter((r) => r.param.key === activeParam.key).map((r): Row => [
                      c(r.estimator), c(String(r.n)), c(`${r.reps}${r.failed ? ` (−${r.failed})` : ''}`), c(r.mean), c(r.bias),
                      c(r.relBias === null ? null : `${(r.relBias * 100).toFixed(1)}%`, r.relBias !== null && Math.abs(r.relBias) > 0.1 ? 'bad' : ''),
                      c(r.sd), c(r.rmse),
                      c(r.coverage, r.coverage !== null && (r.coverage < 0.9 || r.coverage > 0.98) ? 'warn' : ''),
                      c(r.rejection, r.rejection !== null && Math.abs(activeParam.value) > 1e-12 && r.rejection >= 0.8 ? 'good' : ''),
                    ])}
                    note={activeParam.kind === 'fit' ? <>Mean: average (scaled) χ². Type I: share of replications rejecting the correct model at α = {design.alpha}; it should be close to α. Robust estimators use their scaled statistic.</> : <>Bias and RMSE against the true standardised value. Coverage: share of {Math.round((1 - design.alpha) * 100)}% intervals containing the true value (PLS: bootstrap percentile; CB: Wald for paths, Monte Carlo for indirect effects). Power: share of replications rejecting H₀ at α = {design.alpha}; 0.80 is the usual target. Failed replications (non-convergence) are excluded and counted.</>} />
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
