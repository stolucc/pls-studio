// Monte Carlo simulation as an analysis card: power, sample size and
// estimator comparison for a population built from the model (lavaan's
// simulateData with cSEM and lavaan, or the built-in engine).

import { useEffect, useMemo, useState } from 'react';
import type { McDesign, McParam, McSummaryRow } from '../engine/montecarlo';
import { buildPopulation, type PopulationSpec } from '../engine/population';
import { fmt } from '../format';
import {
  defaultDesign,
  ESTIMATOR_CHOICES,
  parseDesign,
  populationFromModel,
} from '../model/simulation';
import { cancelSimulation, workerCount } from '../runner';
import { ChartFrame } from '../components/ChartFrame';
import { c, Table, type Row } from '../components/results/Table';
import { emptyModel } from '../store';
import { fingerprint } from './codec';
import type { AnalysisType, OptionsProps } from './types';
import { seriesColor } from '../figure/palette';

/** Number input that keeps the typed text until blur (so "-0." can be typed). */
function Num({
  value,
  onChange,
  step = 0.05,
  min,
  max,
  width = 64,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  width?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (!Number.isFinite(v)) {
      setText(String(value));
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
    onChange(clamped);
    setText(String(clamped));
  };
  return (
    <input
      className="input num"
      style={{ width, height: 26, padding: '0 6px' }}
      type="number"
      step={step}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

/** Each chart's reference line (80% power, 95% coverage, no bias) and axis title. */
const METRIC_AXIS = {
  rejection: { ref: 0.8, title: 'Power (rejection rate)' },
  coverage: { ref: 0.95, title: 'CI coverage' },
  relBias: { ref: 0, title: 'Relative bias' },
} as const;

/** A parameter in the menu, with its true value. */
function paramOption(p: McParam): string {
  if (p.kind === 'fit') return 'Model χ² test (CB-SEM, correct model)';
  if (p.kind === 'covariance') return `${p.from} ↔ ${p.to} (correlation, true ${fmt(p.value)})`;
  const indirect = p.kind === 'indirect' ? 'indirect ' : '';
  return `${indirect}${p.from} → ${p.to} (true ${fmt(p.value)})`;
}

/** A parameter as the title of its table. */
function paramTitle(p: McParam): string {
  if (p.kind === 'fit') return 'Model χ² test';
  if (p.kind === 'covariance') return `${p.from} ↔ ${p.to} (correlation)`;
  return `${p.from} → ${p.to}${p.kind === 'indirect' ? ' (indirect)' : ''}`;
}

function PowerChart({
  rows,
  paramKey,
  estimators,
  metric,
}: {
  rows: McSummaryRow[];
  paramKey: string;
  estimators: string[];
  metric: 'rejection' | 'relBias' | 'coverage';
}) {
  const W = 460;
  const H = 240;
  const pad = { l: 54, r: 12, t: 12, b: 36 };
  const sel = rows.filter((r) => r.param.key === paramKey);
  const ns = [...new Set(sel.map((r) => r.n))].sort((a, b) => a - b);
  if (ns.length === 0) return null;
  const val = (r: McSummaryRow) => r[metric];
  const vals = sel.map(val).filter((v): v is number => v !== null && Number.isFinite(v));
  // The y range: symmetric around 0 for the bias (at least ±.1), up to 1 for the rates.
  let lo = 0;
  let hi = 1;
  if (metric === 'relBias') {
    lo = Math.min(-0.1, ...vals) * 1.1;
    hi = Math.max(0.1, ...vals) * 1.1;
  } else if (metric === 'coverage') lo = Math.min(0.8, ...vals);
  // N on a log scale; a single N in the middle.
  const xShare = (n: number) => {
    if (ns.length === 1) return 0.5;
    return (Math.log(n) - Math.log(ns[0])) / (Math.log(ns[ns.length - 1]) - Math.log(ns[0]));
  };
  const sx = (n: number) => pad.l + xShare(n) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi - v) / (hi - lo)) * (H - pad.t - pad.b);
  const { ref, title: yTitle } = METRIC_AXIS[metric];
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  return (
    <ChartFrame
      id={`mc:${metric}`}
      name={`simulation-${metric}`}
      width={W}
      height={H}
      defaults={{ x: 'Sample size', y: yTitle }}
    >
      {(labels) => (
        <svg
          className="mc-chart"
          width={W}
          height={H}
          role="img"
          aria-label={`${metric} by sample size`}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} />
              <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">
                {metric === 'relBias' ? `${(v * 100).toFixed(0)}%` : v.toFixed(2)}
              </text>
            </g>
          ))}
          <line className="ref-line" x1={pad.l} x2={W - pad.r} y1={sy(ref)} y2={sy(ref)} />
          {ns.map((n) => (
            <text key={n} x={sx(n)} y={H - pad.b + 16} textAnchor="middle">
              {n}
            </text>
          ))}
          <text
            x={pad.l + (W - pad.l - pad.r) / 2}
            y={H - 4}
            textAnchor="middle"
            className="axis-title"
          >
            {labels.x}
          </text>
          <text
            transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`}
            textAnchor="middle"
            className="axis-title"
          >
            {labels.y}
          </text>
          {estimators.map((e, k) => {
            const pts = ns
              .map((n) => sel.find((r) => r.n === n && r.estimator === e))
              .filter((r): r is McSummaryRow => !!r && val(r) !== null);
            if (!pts.length) return null;
            return (
              <g key={e}>
                <path
                  d={pts.map((r, i) => `${i ? 'L' : 'M'} ${sx(r.n)} ${sy(val(r)!)}`).join(' ')}
                  stroke={seriesColor(k)}
                  strokeWidth={2.2}
                  fill="none"
                />
                {pts.map((r) => (
                  <circle key={r.n} cx={sx(r.n)} cy={sy(val(r)!)} r={3.5} fill={seriesColor(k)} />
                ))}
              </g>
            );
          })}
        </svg>
      )}
    </ChartFrame>
  );
}

function McOptionsForm({ options: design, set: setDesign, ctx, disabled }: OptionsProps<McDesign>) {
  const model = ctx.model ?? emptyModel();
  const method = ctx.settings.method;
  const engine = ctx.settings.engine;
  const results = ctx.pls || ctx.cb ? { pls: ctx.pls, cb: ctx.cb ?? null } : null;
  const [sizesText, setSizesText] = useState(design.sampleSizes.join(', '));
  const check = useMemo(() => {
    try {
      return { pop: buildPopulation(design.population), error: null as string | null };
    } catch (e) {
      return { pop: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [design]);
  const set = (patch: Partial<McDesign>) => setDesign({ ...design, ...patch });
  const setPop = (fn: (p: PopulationSpec) => PopulationSpec) =>
    set({ population: fn(design.population) });
  const fromEstimates = () =>
    setDesign({ ...design, population: populationFromModel(model, ctx.pls, ctx.cb ?? null) });
  const workUnits = workUnitsOf(design);
  return (
    <fieldset className="card-options sim-options" disabled={disabled}>
      <div className="table-tools">
        <h3>Population model</h3>
        <button
          className="btn sm"
          onClick={fromEstimates}
          title="Use the current estimates as population values"
        >
          {results ? 'Use current estimates' : 'Reset to defaults'}
        </button>
      </div>
      {model.moderations.length > 0 && (
        <div className="issue warning">
          Interaction effects are not simulated; moderations are ignored.
        </div>
      )}
      {(model.correlations?.length ?? 0) > 0 && (
        <div className="issue warning">
          Correlated errors and disturbances are not simulated: the population has uncorrelated
          errors and the replications are estimated without the correlation arrows.
        </div>
      )}
      {method === 'pls' &&
        results?.pls &&
        !results.pls.consistent &&
        model.constructs.some((k) => k.type === 'factor') && (
          <div className="hint" style={{ marginBottom: 8 }}>
            Tip: plain PLS estimates of common factors are inconsistent (loadings too high, paths
            too low). For a common-factor population, take values from PLSc or CB-SEM estimates.
          </div>
        )}
      {check?.error && <div className="issue error">{check.error}</div>}
      {design.population.constructs.map((k, ci) => (
        <div className="pop-block" key={k.name}>
          <div className="pop-head">
            <b>{k.name}</b>{' '}
            <span className="chip">
              {k.type === 'composite' ? 'composite: weights' : 'common factor: loadings'}
            </span>
            {check?.pop && check.pop.r2[ci] !== null && (
              <span className="muted num" style={{ marginLeft: 'auto' }}>
                R² {fmt(check.pop.r2[ci])}
              </span>
            )}
          </div>
          <div className="pop-items">
            {k.indicators.map((ind, ii) => (
              <label key={ind}>
                <span title={ind}>{ind}</span>
                <Num
                  value={(k.type === 'factor' ? k.loadings?.[ii] : k.weights?.[ii]) ?? 0}
                  min={k.type === 'factor' ? -0.99 : -100}
                  max={k.type === 'factor' ? 0.99 : 100}
                  onChange={(v) =>
                    setPop((p) => ({
                      ...p,
                      constructs: p.constructs.map((x, j) => {
                        if (j !== ci) return x;
                        // Set the ii-th loading (factor) or weight (composite), filling in the defaults.
                        if (k.type === 'factor') {
                          const loadings = x.loadings ?? x.indicators.map(() => 0.75);
                          return { ...x, loadings: loadings.map((l, a) => (a === ii ? v : l)) };
                        }
                        const weights = x.weights ?? x.indicators.map(() => 1);
                        return { ...x, weights: weights.map((w, a) => (a === ii ? v : w)) };
                      }),
                    }))
                  }
                />
              </label>
            ))}
            {k.type === 'composite' && (
              <label>
                <span>indicator r</span>
                <Num
                  value={k.withinCor ?? 0.5}
                  min={-0.5}
                  max={0.99}
                  onChange={(v) =>
                    setPop((p) => ({
                      ...p,
                      constructs: p.constructs.map((x, j) =>
                        j === ci ? { ...x, withinCor: v } : x,
                      ),
                    }))
                  }
                />
              </label>
            )}
          </div>
        </div>
      ))}
      <div className="pop-block">
        <div className="pop-head">
          <b>Structural paths</b> <span className="muted">standardised; 0 tests Type I error</span>
        </div>
        <div className="pop-items">
          {design.population.paths.map((p, pi) => (
            <label key={`${p.from}-${p.to}`}>
              <span title={`${p.from} → ${p.to}`}>
                {p.from} → {p.to}
              </span>
              <Num
                value={p.value}
                min={-0.99}
                max={0.99}
                onChange={(v) =>
                  setPop((pp) => ({
                    ...pp,
                    paths: pp.paths.map((x, i) => (i === pi ? { ...x, value: v } : x)),
                  }))
                }
              />
            </label>
          ))}
          {design.population.exoCor.map((r, ri) => (
            <label key={`${r.a}-${r.b}`}>
              <span title={`${r.a} ↔ ${r.b} (correlation)`}>
                {r.a} ↔ {r.b}
              </span>
              <Num
                value={r.value}
                min={-0.99}
                max={0.99}
                onChange={(v) =>
                  setPop((pp) => ({
                    ...pp,
                    exoCor: pp.exoCor.map((x, i) => (i === ri ? { ...x, value: v } : x)),
                  }))
                }
              />
            </label>
          ))}
        </div>
      </div>
      <h3 style={{ marginTop: 14 }}>Design</h3>
      <div className="field">
        <label>Sample sizes</label>
        <input
          className="input"
          value={sizesText}
          onChange={(e) => setSizesText(e.target.value)}
          onBlur={() => {
            const sizes = [
              ...new Set(
                sizesText
                  .split(/[,\s]+/)
                  .map(Number)
                  .filter((n) => Number.isInteger(n) && n >= 10 && n <= 100000),
              ),
            ]
              .sort((a, b) => a - b)
              .slice(0, 20);
            if (sizes.length) set({ sampleSizes: sizes });
            else setSizesText(design.sampleSizes.join(', '));
          }}
        />
      </div>
      <div className="row2">
        <div className="field">
          <label>Replications</label>
          <Num
            value={design.replications}
            step={50}
            min={2}
            max={100000}
            width={90}
            onChange={(v) => set({ replications: Math.round(v) })}
          />
        </div>
        <div className="field">
          <label>α</label>
          <Num
            value={design.alpha}
            step={0.01}
            min={0.001}
            max={0.2}
            width={90}
            onChange={(v) => set({ alpha: v })}
          />
        </div>
      </div>
      <div className="field">
        <label>Estimators</label>
        <div className="est-grid">
          {ESTIMATOR_CHOICES.map((e) => (
            <label key={e.id} className="check" style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={design.estimators.some((x) => x.id === e.id)}
                onChange={(ev) =>
                  set({
                    estimators: ev.target.checked
                      ? ESTIMATOR_CHOICES.filter(
                          (x) => x.id === e.id || design.estimators.some((y) => y.id === x.id),
                        )
                      : design.estimators.filter((x) => x.id !== e.id),
                  })
                }
              />
              {e.id}
            </label>
          ))}
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label>Bootstrap / rep (PLS)</label>
          <Num
            value={design.bootSamples}
            step={50}
            min={0}
            max={10000}
            width={90}
            onChange={(v) => set({ bootSamples: Math.round(v) })}
          />
        </div>
        <div className="field">
          <label>MC draws (CB indirect)</label>
          <Num
            value={design.mcDraws}
            step={500}
            min={0}
            max={1000000}
            width={90}
            onChange={(v) => set({ mcDraws: Math.round(v) })}
          />
        </div>
      </div>
      <div className="field">
        <label>Indicator distribution</label>
        <div className="segmented">
          <button
            className={!(design.population.skew || design.population.kurtosis) ? 'on' : ''}
            onClick={() => setPop((p) => ({ ...p, skew: 0, kurtosis: 0 }))}
          >
            Normal
          </button>
          <button
            className={design.population.skew || design.population.kurtosis ? 'on' : ''}
            onClick={() => setPop((p) => ({ ...p, skew: p.skew || 1, kurtosis: p.kurtosis || 3 }))}
          >
            Non-normal
          </button>
        </div>
      </div>
      {design.population.skew || design.population.kurtosis ? (
        <div className="row2">
          <div className="field">
            <label>Skewness</label>
            <Num
              value={design.population.skew ?? 0}
              step={0.25}
              min={-5}
              max={5}
              width={90}
              onChange={(v) => setPop((p) => ({ ...p, skew: v }))}
            />
          </div>
          <div className="field">
            <label>Excess kurtosis</label>
            <Num
              value={design.population.kurtosis ?? 0}
              step={0.5}
              min={-1.2}
              max={60}
              width={90}
              onChange={(v) => setPop((p) => ({ ...p, kurtosis: v }))}
            />
          </div>
        </div>
      ) : null}
      <div className="field">
        <label>Random seed</label>
        <Num
          value={design.seed}
          step={1}
          min={0}
          max={2 ** 31}
          width={110}
          onChange={(v) => set({ seed: Math.round(v) })}
        />
      </div>
      <div className="hint" style={{ marginBottom: 10 }}>
        CB-SEM analyses every construct as a common factor, so composite populations show its
        misspecification bias. Non-normal data use the Vale–Maurelli method (Fleishman polynomials,
        population correlations preserved); compare ML with MLM/MLMV/MLR via the model χ² test. PLS
        with 0 bootstrap samples reports bias and RMSE only.
        {engine === 'r' ? (
          <>
            {' '}
            Data: lavaan::simulateData; estimation: cSEM (PLS) and lavaan (CB-SEM), in your browser.
            About {workUnits.toLocaleString()} model estimations, one at a time.
          </>
        ) : (
          <>
            {' '}
            About {workUnits.toLocaleString()} model estimations on {workerCount()} cores (built-in
            engine).
          </>
        )}
      </div>
    </fieldset>
  );
}

const workUnitsOf = (d: McDesign) =>
  d.replications *
  d.sampleSizes.length *
  d.estimators.reduce((s, e) => s + (e.method === 'pls' ? Math.max(1, d.bootSamples) : 1), 0);

function McView({ rows, design }: { rows: McSummaryRow[]; design: McDesign }) {
  const [paramKey, setParamKey] = useState('');
  const [metric, setMetric] = useState<'rejection' | 'relBias' | 'coverage'>('rejection');
  const params = [...new Map(rows.map((r) => [r.param.key, r.param])).values()];
  const activeParam = params.find((p) => p.key === paramKey) ?? params[0];
  return (
    <div className="tables">
      {!rows ? (
        <div className="empty-results">Run the simulation to see power curves and bias.</div>
      ) : (
        activeParam && (
          <>
            <div className="ipma-controls">
              <label>
                Parameter
                <select
                  className="select"
                  value={activeParam.key}
                  onChange={(e) => setParamKey(e.target.value)}
                >
                  {params.map((p) => (
                    <option key={p.key} value={p.key}>
                      {paramOption(p)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="segmented" style={{ width: 270 }}>
                <button
                  className={metric === 'rejection' ? 'on' : ''}
                  onClick={() => setMetric('rejection')}
                >
                  {Math.abs(activeParam.value) < 1e-12 ? 'Type I' : 'Power'}
                </button>
                <button
                  className={metric === 'relBias' ? 'on' : ''}
                  onClick={() => setMetric('relBias')}
                  disabled={Math.abs(activeParam.value) < 1e-12}
                >
                  Rel. bias
                </button>
                <button
                  className={metric === 'coverage' ? 'on' : ''}
                  onClick={() => setMetric('coverage')}
                >
                  Coverage
                </button>
              </div>
            </div>
            <PowerChart
              rows={rows}
              paramKey={activeParam.key}
              estimators={(design.estimators ?? []).map((e) => e.id)}
              metric={metric}
            />
            <div className="legend">
              {design.estimators.map((e, k) => (
                <span key={e.id}>
                  <i style={{ background: seriesColor(k) }} />
                  {e.id}
                </span>
              ))}
            </div>
            <Table
              title={paramTitle(activeParam)}
              file="simulation"
              columns={[
                'Estimator',
                'N',
                'Reps',
                'Mean',
                'Bias',
                'Rel. bias',
                'SD',
                'RMSE',
                'Coverage',
                Math.abs(activeParam.value) < 1e-12 ? 'Type I' : 'Power',
              ]}
              rows={rows
                .filter((r) => r.param.key === activeParam.key)
                .map(
                  (r): Row => [
                    c(r.estimator),
                    c(String(r.n)),
                    c(`${r.reps}${r.failed ? ` (−${r.failed})` : ''}`),
                    c(r.mean),
                    c(r.bias),
                    c(
                      r.relBias === null ? null : `${(r.relBias * 100).toFixed(1)}%`,
                      r.relBias !== null && Math.abs(r.relBias) > 0.1 ? 'bad' : '',
                    ),
                    c(r.sd),
                    c(r.rmse),
                    c(
                      r.coverage,
                      r.coverage !== null && (r.coverage < 0.9 || r.coverage > 0.98) ? 'warn' : '',
                    ),
                    c(
                      r.rejection,
                      r.rejection !== null &&
                        Math.abs(activeParam.value) > 1e-12 &&
                        r.rejection >= 0.8
                        ? 'good'
                        : '',
                    ),
                  ],
                )}
              note={
                activeParam.kind === 'fit' ? (
                  <>
                    Mean: average (scaled) χ². Type I: share of replications rejecting the correct
                    model at α = {design.alpha}; it should be close to α. Robust estimators use
                    their scaled statistic.
                  </>
                ) : (
                  <>
                    Bias and RMSE against the true standardised value. Coverage: share of{' '}
                    {Math.round((1 - design.alpha) * 100)}% intervals containing the true value
                    (PLS: bootstrap percentile; CB: Wald for paths, Monte Carlo for indirect
                    effects). Power: share of replications rejecting H₀ at α = {design.alpha}; 0.80
                    is the usual target. Failed replications (non-convergence) are excluded and
                    counted.
                  </>
                )
              }
            />
          </>
        )
      )}
    </div>
  );
}

function populationError(d: McDesign): string | null {
  try {
    buildPopulation(d.population);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

export const mcAnalysis: AnalysisType<McDesign, McSummaryRow[]> = {
  id: 'mc',
  title: 'Monte Carlo simulation',
  sub: 'power, sample size, estimators: from a population built on the model',
  group: 'PLS-SEM model',
  defaults: (ctx) =>
    defaultDesign(populationFromModel(ctx.model ?? emptyModel(), ctx.pls, ctx.cb ?? null)),
  parseOptions: (raw) => parseDesign(raw),
  Options: McOptionsForm,
  View: ({ result, options }) => <McView rows={result} design={options} />,
  blocked: (d, ctx) => {
    if (ctx.settings.method === 'process')
      return 'Monte Carlo simulation is for PLS-SEM and CB-SEM models.';
    if (!d.population.constructs.length)
      return 'Build a model first (Model tab), then press Reset to defaults: the population uses its constructs, indicators and paths.';
    if (!d.estimators.length) return 'Choose at least one estimator.';
    if (!d.population.paths.length && d.estimators.some((e) => e.method === 'pls'))
      return 'PLS-SEM needs at least one path between constructs; for a measurement model only (correlated factors), use the CB-SEM estimators.';
    return populationError(d);
  },
  // The study depends on its design (the options) and the engine only, not on the data.
  fingerprint: (_d, ctx) => fingerprint(['mc', ctx.settings.engine]),
  run: async (d, ctx, progress) =>
    (await import('../runner')).simulate(d, ctx.settings.engine, (done, total) =>
      progress(done, total),
    ),
  cancel: cancelSimulation,
  script: async (d) => (await import('../rengine/mc')).mcScriptR(d),
  summary: (d) =>
    `${d.estimators.map((e) => e.id).join(', ') || 'no estimator'} · N = ${d.sampleSizes.join(', ')} · ${d.replications} replications`,
};
