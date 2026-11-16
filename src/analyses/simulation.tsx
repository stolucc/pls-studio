// Monte Carlo simulation as an analysis card: power, sample size and
// estimator comparison for a population built from the model (lavaan's
// simulateData with cSEM and lavaan, or the built-in engine).

import { useEffect, useMemo, useState } from 'react';
import { MC_FIT_INDICES, poorFitRule } from '../engine/mcFitIndices';
import { MC_VALIDITY_RULES } from '../engine/mcValidity';
import {
  DEFAULT_INFERENCE,
  MC_TEST_LABELS,
  MC_TESTS,
  type McInference,
} from '../engine/mcInference';
import type {
  McDesign,
  McHistogram,
  McMissing,
  McOrdinal,
  McParam,
  McSummaryRow,
} from '../engine/montecarlo';
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
import { OTHER_COLOR, seriesColor } from '../figure/palette';
import { legendHeight, SvgLegend, type LegendItem } from '../figure/legend';
import { PlotPanel } from '../figure/panel';

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
  rejection: { ref: 0.8, refLabel: 'Power .80', title: 'Power (rejection rate)' },
  coverage: { ref: 0.95, refLabel: 'Nominal .95', title: 'CI coverage' },
  relBias: { ref: 0, refLabel: 'No bias', title: 'Relative bias' },
} as const;

/** The fit index a fit parameter stands for; undefined for the χ² test. */
const fitIndexOf = (p: McParam) => MC_FIT_INDICES.find((f) => `fit:${f.id}` === p.key);

/** A parameter in the menu, with its true value. */
function paramOption(p: McParam): string {
  if (p.kind === 'fit')
    return `${paramTitle(p)} (CB-SEM, ${p.value ? 'misspecified' : 'correct'} model)`;
  if (p.kind === 'covariance') return `${p.from} ↔ ${p.to} (correlation, true ${fmt(p.value)})`;
  if (p.kind === 'reliability') return `${p.from}: composite reliability (ideal ${fmt(p.value)})`;
  if (p.kind === 'validity') return `${paramTitle(p)} (PLS check, population ${fmt(p.value)})`;
  const indirect = p.kind === 'indirect' ? 'indirect ' : '';
  return `${indirect}${p.from} → ${p.to} (true ${fmt(p.value)})`;
}

/** A parameter as the title of its table. */
function paramTitle(p: McParam): string {
  if (p.kind === 'fit') {
    const index = fitIndexOf(p);
    return index ? `${index.label}, poor fit if ${poorFitRule(index)}` : 'Model χ² test';
  }
  if (p.kind === 'covariance') return `${p.from} ↔ ${p.to} (correlation)`;
  if (p.kind === 'reliability') return `${p.from}: reliability of the composite`;
  if (p.kind === 'validity') {
    const rule = MC_VALIDITY_RULES[p.rule!];
    const where = p.from === 'model' ? 'model' : p.from === p.to ? p.from : `${p.from} – ${p.to}`;
    return `${where}: ${rule.label}, fails if ${rule.poorBelow ? '<' : '>'} ${rule.cutoff}`;
  }
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
  // Each estimator's line, and the dashed reference line (the target power, the nominal coverage, no bias).
  const legend: LegendItem[] = [
    ...estimators.map((e, k) => ({ label: e, color: seriesColor(k) })),
    { label: METRIC_AXIS[metric].refLabel, color: OTHER_COLOR, mark: 'dash' as const },
  ];
  const legendH = legendHeight(legend, W - 54 - 12);
  const H = 240 + legendH;
  const pad = { l: 54, r: 12, t: 12 + legendH, b: 36 };
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
      figure={(labels) => ({
        title: `${yTitle} by sample size`,
        x: { title: labels.x, log: ns.length > 1 },
        y: { title: labels.y, limits: [lo, hi], percent: metric !== 'relBias' },
        width: W,
        height: H - legendH,
        layers: [
          ...estimators.flatMap((e, k) => {
            const line = ns.map((n) => {
              const r = sel.find((x) => x.n === n && x.estimator === e);
              const v = r ? val(r) : null;
              return v !== null && Number.isFinite(v) ? v : null;
            });
            return [
              { geom: 'line' as const, series: e, color: seriesColor(k), x: ns, y: line },
              { geom: 'point' as const, series: e, color: seriesColor(k), x: ns, y: line },
            ];
          }),
          {
            geom: 'hline' as const,
            series: METRIC_AXIS[metric].refLabel,
            color: OTHER_COLOR,
            linetype: 'dashed' as const,
            y: [ref],
          },
        ],
      })}
    >
      {(labels) => (
        <svg
          className="mc-chart"
          width={W}
          height={H}
          role="img"
          aria-label={`${metric} by sample size`}
        >
          <SvgLegend items={legend} x={pad.l} y={0} width={W - pad.l - pad.r} />
          <PlotPanel x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} />
          {ticks.map((v) => (
            <g key={v}>
              <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} />
              <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">
                {metric === 'relBias' ? `${(v * 100).toFixed(0)}%` : v.toFixed(2)}
              </text>
            </g>
          ))}
          <line
            className="ref-line"
            style={{ stroke: OTHER_COLOR }}
            x1={pad.l}
            x2={W - pad.r}
            y1={sy(ref)}
            y2={sy(ref)}
          />
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

/**
 * What the population has and the estimated model leaves out: cross-loadings and error correlations of
 * common-factor indicators, structural paths. Fit tests then measure power to detect it, and the
 * parameters show the bias it causes.
 */
function MisspecificationBlock({
  pop,
  setPop,
}: {
  pop: PopulationSpec;
  setPop: (fn: (p: PopulationSpec) => PopulationSpec) => void;
}) {
  const factors = pop.constructs.filter((c) => c.type === 'factor');
  const indicators = factors.flatMap((c) => c.indicators);
  const owner = (ind: string) => pop.constructs.find((c) => c.indicators.includes(ind))?.name;
  const cross = pop.crossLoadings ?? [];
  const errors = pop.errorCors ?? [];
  const setCross = (next: typeof cross) => setPop((p) => ({ ...p, crossLoadings: next }));
  const setErrors = (next: typeof errors) => setPop((p) => ({ ...p, errorCors: next }));
  const firstOther = (ind: string) => pop.constructs.find((c) => c.name !== owner(ind))?.name ?? '';
  return (
    <div className="pop-block mc-misspec">
      <div className="pop-head">
        <b>Misspecification</b>{' '}
        <span className="muted">in the population, left out of the estimated model</span>
      </div>
      {pop.paths.length > 0 && (
        <div className="mc-misspec-group">
          <span className="mc-misspec-title">Paths left out</span>
          {pop.paths.map((x, pi) => (
            <label key={`${x.from}-${x.to}`} className="check">
              <input
                type="checkbox"
                checked={!!x.omitted}
                onChange={(e) =>
                  setPop((p) => ({
                    ...p,
                    paths: p.paths.map((y, i) =>
                      i === pi
                        ? {
                            from: y.from,
                            to: y.to,
                            value: y.value,
                            ...(e.target.checked ? { omitted: true } : {}),
                          }
                        : y,
                    ),
                  }))
                }
              />
              {x.from} → {x.to}
            </label>
          ))}
        </div>
      )}
      {indicators.length > 0 && (
        <>
          <div className="mc-misspec-group">
            <span className="mc-misspec-title">Cross-loadings</span>
            {cross.map((x, i) => (
              <div className="mc-misspec-row" key={i}>
                <select
                  className="select"
                  aria-label={`Cross-loading ${i + 1}: indicator`}
                  value={x.indicator}
                  onChange={(e) =>
                    setCross(
                      cross.map((y, k) =>
                        k === i
                          ? {
                              ...y,
                              indicator: e.target.value,
                              construct:
                                y.construct === owner(e.target.value)
                                  ? firstOther(e.target.value)
                                  : y.construct,
                            }
                          : y,
                      ),
                    )
                  }
                >
                  {indicators.map((ind) => (
                    <option key={ind} value={ind}>
                      {ind}
                    </option>
                  ))}
                </select>
                <span className="muted">also loads on</span>
                <select
                  className="select"
                  aria-label={`Cross-loading ${i + 1}: construct`}
                  value={x.construct}
                  onChange={(e) =>
                    setCross(
                      cross.map((y, k) => (k === i ? { ...y, construct: e.target.value } : y)),
                    )
                  }
                >
                  {pop.constructs
                    .filter((c) => c.name !== owner(x.indicator))
                    .map((c) => (
                      <option key={c.name} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                </select>
                <Num
                  value={x.value}
                  min={-0.99}
                  max={0.99}
                  onChange={(v) =>
                    setCross(cross.map((y, k) => (k === i ? { ...y, value: v } : y)))
                  }
                />
                <button
                  className="btn sm ghost"
                  onClick={() => setCross(cross.filter((_, k) => k !== i))}
                  aria-label={`Remove cross-loading ${i + 1}`}
                >
                  Remove
                </button>
              </div>
            ))}
            {pop.constructs.length > 1 && (
              <button
                className="btn sm"
                onClick={() =>
                  setCross([
                    ...cross,
                    { indicator: indicators[0], construct: firstOther(indicators[0]), value: 0.3 },
                  ])
                }
              >
                Add cross-loading
              </button>
            )}
          </div>
          <div className="mc-misspec-group">
            <span className="mc-misspec-title">Error correlations</span>
            {errors.map((r, i) => (
              <div className="mc-misspec-row" key={i}>
                {(['a', 'b'] as const).map((side) => (
                  <select
                    key={side}
                    className="select"
                    aria-label={`Error correlation ${i + 1}: ${side === 'a' ? 'first' : 'second'} indicator`}
                    value={r[side]}
                    onChange={(e) =>
                      setErrors(
                        errors.map((y, k) => (k === i ? { ...y, [side]: e.target.value } : y)),
                      )
                    }
                  >
                    {indicators.map((ind) => (
                      <option key={ind} value={ind}>
                        {ind}
                      </option>
                    ))}
                  </select>
                ))}
                <Num
                  value={r.value}
                  min={-0.99}
                  max={0.99}
                  onChange={(v) =>
                    setErrors(errors.map((y, k) => (k === i ? { ...y, value: v } : y)))
                  }
                />
                <button
                  className="btn sm ghost"
                  onClick={() => setErrors(errors.filter((_, k) => k !== i))}
                  aria-label={`Remove error correlation ${i + 1}`}
                >
                  Remove
                </button>
              </div>
            ))}
            {indicators.length > 1 && (
              <button
                className="btn sm"
                onClick={() =>
                  setErrors([...errors, { a: indicators[0], b: indicators[1], value: 0.3 }])
                }
              >
                Add error correlation
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Ordinal (Likert-type) indicators: categories and thresholds. */
function OrdinalFields({ design, set }: { design: McDesign; set: (p: Partial<McDesign>) => void }) {
  const o = design.ordinal;
  return (
    <>
      <div className="field">
        <label>Indicator scale</label>
        <div className="segmented">
          <button className={!o ? 'on' : ''} onClick={() => set({ ordinal: undefined })}>
            Continuous
          </button>
          <button
            className={o ? 'on' : ''}
            onClick={() => set({ ordinal: o ?? { categories: 5, thresholds: 'symmetric' } })}
          >
            Ordinal
          </button>
        </div>
      </div>
      {o && (
        <div className="row2">
          <div className="field">
            <label>Categories</label>
            <Num
              value={o.categories}
              step={1}
              min={2}
              max={10}
              width={70}
              onChange={(v) => set({ ordinal: { ...o, categories: Math.round(v) } })}
            />
          </div>
          <div className="field">
            <label>Thresholds</label>
            <select
              className="select"
              value={o.thresholds}
              onChange={(e) =>
                set({ ordinal: { ...o, thresholds: e.target.value as McOrdinal['thresholds'] } })
              }
            >
              <option value="symmetric">Symmetric (equal shares)</option>
              <option value="asymmetric">Asymmetric (most cases high)</option>
            </select>
          </div>
        </div>
      )}
    </>
  );
}

const INTERVAL_LABELS: Record<McInference['interval'], string> = {
  percentile: 'Percentile',
  normal: 'Normal (bias-corrected)',
  basic: 'Basic',
  bca: 'BCa',
};

/** The PLS interval as the notes name it, e.g. "bootstrap BCa, individual sign-change correction". */
function inferenceNote(inf: McInference): string {
  const name = inf.interval === 'bca' ? 'BCa' : inf.interval;
  const correction = inf.signChange === 'none' ? '' : `, ${inf.signChange} sign-change correction`;
  return `bootstrap ${name}${correction}`;
}

/**
 * PLS bootstrap inference: the sign-change correction of the draws and the interval coverage is reported for.
 * Every test is computed from the same draws either way (the rejection-by-test table).
 */
function InferenceFields({
  design,
  set,
}: {
  design: McDesign;
  set: (p: Partial<McDesign>) => void;
}) {
  const inf = design.inference ?? DEFAULT_INFERENCE;
  const change = (patch: Partial<McInference>) => set({ inference: { ...inf, ...patch } });
  return (
    <div className="row2">
      <div className="field">
        <label>Sign-change correction</label>
        <select
          className="select"
          value={inf.signChange}
          onChange={(e) => change({ signChange: e.target.value as McInference['signChange'] })}
        >
          <option value="none">None</option>
          <option value="individual">Individual</option>
          <option value="construct">Construct level</option>
        </select>
      </div>
      <div className="field">
        <label>Interval (coverage)</label>
        <select
          className="select"
          value={inf.interval}
          onChange={(e) => change({ interval: e.target.value as McInference['interval'] })}
        >
          {(Object.keys(INTERVAL_LABELS) as McInference['interval'][]).map((k) => (
            <option key={k} value={k}>
              {INTERVAL_LABELS[k]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

const NO_MISSING: McMissing = { rate: 0, mechanism: 'MCAR', pls: 'mean', cb: 'casewise' };

/** Missing values in every replication, and how PLS and CB-SEM treat them. */
function MissingFields({ design, set }: { design: McDesign; set: (p: Partial<McDesign>) => void }) {
  const m = design.missing ?? NO_MISSING;
  const change = (patch: Partial<McMissing>) => set({ missing: { ...m, ...patch } });
  return (
    <>
      <div className="field">
        <label>Missing values</label>
        <div className="row2">
          <Num
            value={Math.round(m.rate * 100)}
            step={5}
            min={0}
            max={50}
            width={70}
            onChange={(v) => change({ rate: v / 100 })}
          />
          <span className="muted">% of the values</span>
        </div>
      </div>
      {m.rate > 0 && (
        <div className="row2">
          <div className="field">
            <label>Mechanism</label>
            <select
              className="select"
              value={m.mechanism}
              onChange={(e) => change({ mechanism: e.target.value as McMissing['mechanism'] })}
            >
              <option value="MCAR">MCAR (completely at random)</option>
              <option value="MAR">MAR (on the first indicator)</option>
            </select>
          </div>
          <div className="field">
            <label>Treatment (PLS / CB-SEM)</label>
            <div className="row2">
              <select
                className="select"
                aria-label="PLS treatment of missing values"
                value={m.pls}
                onChange={(e) => change({ pls: e.target.value as McMissing['pls'] })}
              >
                <option value="mean">Mean replacement</option>
                <option value="casewise">Casewise deletion</option>
              </select>
              <select
                className="select"
                aria-label="CB-SEM treatment of missing values"
                value={m.cb}
                onChange={(e) => change({ cb: e.target.value as McMissing['cb'] })}
              >
                <option value="casewise">Casewise deletion</option>
                <option value="fiml">FIML (R engine)</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </>
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
      <MisspecificationBlock pop={design.population} setPop={setPop} />
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
      {design.bootSamples > 0 && design.estimators.some((e) => e.method === 'pls') && (
        <InferenceFields design={design} set={set} />
      )}
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
      <OrdinalFields design={design} set={set} />
      <MissingFields design={design} set={set} />
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

/**
 * The distribution of the estimates at one sample size: an outline per estimator (share of replications per
 * bin), the true value as the reference line. A null effect estimated by PLS shows here as two humps
 * around 0 (Rönkkö & Evermann 2013) where a mean and SD show nothing unusual.
 */
function DistributionChart({
  rows,
  param,
  n,
  estimators,
}: {
  rows: McSummaryRow[];
  param: McParam;
  n: number;
  estimators: string[];
}) {
  // Density (a smooth kernel estimate, as published simulation figures draw it) or the histogram's bins.
  const [shape, setShape] = useState<'density' | 'histogram'>('density');
  const W = 460;
  const series = estimators
    .map((e, k) => ({
      e,
      k,
      row: rows.find((r) => r.param.key === param.key && r.n === n && r.estimator === e),
    }))
    .filter(
      (x): x is { e: string; k: number; row: McSummaryRow & { hist: McHistogram } } =>
        !!x.row?.hist,
    );
  if (!series.length) return null;
  // Each estimator's curve, and the dashed line at the true value (fit indices have none).
  const legend: LegendItem[] = [
    ...series.map(({ e, k }) => ({ label: e, color: seriesColor(k) })),
    ...(param.kind !== 'fit'
      ? [{ label: 'True value', color: OTHER_COLOR, mark: 'dash' as const }]
      : []),
  ];
  const legendH = legendHeight(legend, W - 54 - 12);
  const H = 240 + legendH;
  const pad = { l: 54, r: 12, t: 12 + legendH, b: 36 };
  const { lo, hi, counts } = series[0].row.hist;
  const bins = counts.length;
  const smooth = shape === 'density' && series.every(({ row }) => row.hist.density);
  const share = (row: McSummaryRow & { hist: McHistogram }, b: number) =>
    row.reps ? row.hist.counts[b] / row.reps : 0;
  const top = smooth
    ? Math.max(1e-9, ...series.flatMap(({ row }) => row.hist.density!))
    : Math.max(0.01, ...series.flatMap(({ row }) => row.hist.counts.map((_, b) => share(row, b))));
  const points = series[0].row.hist.density?.length ?? 0;
  const at = (i: number) => lo + ((hi - lo) * i) / Math.max(1, points - 1);
  const sx = (v: number) => pad.l + ((v - lo) / (hi - lo)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - v / top) * (H - pad.t - pad.b);
  const edge = (b: number) => lo + ((hi - lo) * b) / bins;
  const xTicks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);
  const yTicks = Array.from({ length: 5 }, (_, i) => (top * i) / 4);
  const outline = (row: McSummaryRow & { hist: McHistogram }) => {
    let d = `M ${sx(lo)} ${sy(0)}`;
    for (let b = 0; b < bins; b++) d += ` V ${sy(share(row, b))} H ${sx(edge(b + 1))}`;
    return `${d} V ${sy(0)}`;
  };
  const curve = (row: McSummaryRow & { hist: McHistogram }) =>
    row.hist.density!.map((y, i) => `${i ? 'L' : 'M'} ${sx(at(i))} ${sy(y)}`).join(' ');
  const outside = series.filter(({ row }) => row.hist.below + row.hist.above > 0);
  return (
    <>
      {series.every(({ row }) => row.hist.density) && (
        <div className="segmented" role="radiogroup" aria-label="Shape of the distribution">
          {(['density', 'histogram'] as const).map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={shape === k}
              className={shape === k ? 'on' : ''}
              onClick={() => setShape(k)}
            >
              {k === 'density' ? 'Density' : 'Histogram'}
            </button>
          ))}
        </div>
      )}
      <ChartFrame
        id="mc:distribution"
        name="simulation-distribution"
        width={W}
        height={H}
        defaults={{ x: 'Estimate', y: smooth ? 'Density' : 'Share of replications' }}
        figure={(labels) => ({
          title: `Distribution of the estimates at N = ${n}`,
          x: { title: labels.x, limits: [lo, hi] },
          y: { title: labels.y, limits: [0, top], percent: !smooth },
          width: W,
          height: H - legendH,
          layers: [
            // (the density at its points, or each bin's share as a step outline like the chart's)
            ...series.map(({ e, k, row }) =>
              smooth
                ? {
                    geom: 'line' as const,
                    series: e,
                    color: seriesColor(k),
                    x: row.hist.density!.map((_, i) => at(i)),
                    y: row.hist.density!,
                  }
                : {
                    geom: 'step' as const,
                    series: e,
                    color: seriesColor(k),
                    x: Array.from({ length: bins + 1 }, (_, b) => edge(b)),
                    y: Array.from({ length: bins + 1 }, (_, b) =>
                      share(row, Math.min(b, bins - 1)),
                    ),
                  },
            ),
            ...(param.kind !== 'fit'
              ? [
                  {
                    geom: 'vline' as const,
                    series: 'True value',
                    color: OTHER_COLOR,
                    linetype: 'dashed' as const,
                    x: [param.value],
                  },
                ]
              : []),
          ],
        })}
      >
        {(labels) => (
          <svg
            className="mc-chart"
            width={W}
            height={H}
            role="img"
            aria-label={`Distribution of the estimates at N = ${n}`}
          >
            <SvgLegend items={legend} x={pad.l} y={0} width={W - pad.l - pad.r} />
            <PlotPanel x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} />
            {yTicks.map((v) => (
              <g key={v}>
                <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} />
                <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">
                  {v.toFixed(2)}
                </text>
              </g>
            ))}
            {xTicks.map((v) => (
              <text key={v} x={sx(v)} y={H - pad.b + 16} textAnchor="middle">
                {fmt(v)}
              </text>
            ))}
            {param.kind !== 'fit' && (
              <line
                className="ref-line"
                style={{ stroke: OTHER_COLOR }}
                x1={sx(param.value)}
                x2={sx(param.value)}
                y1={pad.t}
                y2={H - pad.b}
              />
            )}
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
            {series.map(({ e, k, row }) => (
              <path
                key={e}
                d={smooth ? curve(row) : outline(row)}
                stroke={seriesColor(k)}
                strokeWidth={2}
                fill="none"
              />
            ))}
            {/* Hover (density): every estimator's density at the nearest point. */}
            {smooth &&
              Array.from({ length: points }, (_, i) => (
                <rect
                  key={i}
                  className="mc-hit"
                  x={sx(at(Math.max(0, i - 0.5)))}
                  y={pad.t}
                  width={sx(at(Math.min(points - 1, i + 0.5))) - sx(at(Math.max(0, i - 0.5)))}
                  height={H - pad.t - pad.b}
                >
                  <title>
                    {`${fmt(at(i))}\n` +
                      series
                        .map(({ e, row }) => `${e}: density ${fmt(row.hist.density![i])}`)
                        .join('\n')}
                  </title>
                </rect>
              ))}
            {/* Hover (histogram): each bin's range and every estimator's share in it. */}
            {!smooth &&
              counts.map((_, b) => (
                <rect
                  key={b}
                  className="mc-hit"
                  x={sx(edge(b))}
                  y={pad.t}
                  width={sx(edge(b + 1)) - sx(edge(b))}
                  height={H - pad.t - pad.b}
                >
                  <title>
                    {`${fmt(edge(b))} to ${fmt(edge(b + 1))}\n` +
                      series
                        .map(({ e, row }) => `${e}: ${(share(row, b) * 100).toFixed(1)}%`)
                        .join('\n')}
                  </title>
                </rect>
              ))}
            {outside.length > 0 && (
              <text x={W - pad.r} y={pad.t + 10} textAnchor="end">
                {`outside the range: ${outside
                  .map(({ e, row }) => `${e} ${row.hist.below + row.hist.above}`)
                  .join(', ')}`}
              </text>
            )}
          </svg>
        )}
      </ChartFrame>
    </>
  );
}

function McView({ rows, design }: { rows: McSummaryRow[]; design: McDesign }) {
  const [paramKey, setParamKey] = useState('');
  const [metric, setMetric] = useState<'rejection' | 'relBias' | 'coverage'>('rejection');
  const params = [...new Map(rows.map((r) => [r.param.key, r.param])).values()];
  const activeParam = params.find((p) => p.key === paramKey) ?? params[0];
  const ns = [...new Set(rows.map((r) => r.n))].sort((a, b) => a - b);
  const [distN, setDistN] = useState<number | null>(null);
  const shownN = distN !== null && ns.includes(distN) ? distN : ns[0];
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
            {rows.some((r) => r.hist) && (
              <div className="mc-distribution">
                <div className="ipma-controls">
                  <span className="mc-subtitle">Distribution of the estimates</span>
                  {ns.length > 1 && (
                    <label>
                      N
                      <select
                        className="select"
                        value={shownN}
                        onChange={(e) => setDistN(Number(e.target.value))}
                      >
                        {ns.map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <DistributionChart
                  rows={rows}
                  param={activeParam}
                  n={shownN}
                  estimators={(design.estimators ?? []).map((e) => e.id)}
                />
              </div>
            )}
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
                'CI width',
                activeParam.kind === 'validity'
                  ? 'Fails cutoff'
                  : Math.abs(activeParam.value) < 1e-12
                    ? 'Type I'
                    : 'Power',
                'Inadmissible',
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
                    c(r.width),
                    c(
                      r.rejection,
                      r.rejection !== null &&
                        Math.abs(activeParam.value) > 1e-12 &&
                        r.rejection >= 0.8
                        ? 'good'
                        : '',
                    ),
                    c(
                      r.reps ? `${((r.improper / r.reps) * 100).toFixed(1)}%` : null,
                      r.improper > 0 ? 'warn' : '',
                    ),
                  ],
                )}
              note={
                activeParam.kind === 'validity' ? (
                  <>
                    A measurement check of PLS reports in every replication, against the same check
                    of the population ({fmt(activeParam.value)}): ρc and AVE from the loadings, the
                    Fornell–Larcker margin √AVE − the largest correlation with another construct,
                    HTMT from the indicator correlations, GoF = √(mean AVE · mean R²). Fails cutoff:
                    share of replications failing {MC_VALIDITY_RULES[activeParam.rule!].label}{' '}
                    {MC_VALIDITY_RULES[activeParam.rule!].poorBelow ? '<' : '>'}{' '}
                    {MC_VALIDITY_RULES[activeParam.rule!].cutoff}. With a misspecified population it
                    is the share of replications in which the check would notice; Rönkkö &amp;
                    Evermann (2013) found these checks rarely do. PLS loadings overstate factor
                    loadings, so ρc and AVE run above the population&apos;s.
                  </>
                ) : activeParam.kind === 'reliability' ? (
                  <>
                    Reliability of the composite: the squared correlation of the weighted sum of the
                    indicators with the construct, from each replication&apos;s weights and the
                    population (Rönkkö &amp; Evermann 2013). Bias is against ideal weights, the most
                    any weights give ({fmt(activeParam.value)}); unit weights (sum scores) give{' '}
                    {fmt(activeParam.unit ?? NaN)}. Weights estimated from a sample capitalise on
                    chance, so PLS reliabilities fall below the ideal and may fall below the sum
                    score&apos;s.
                  </>
                ) : activeParam.kind === 'fit' && fitIndexOf(activeParam) ? (
                  activeParam.value ? (
                    <>
                      Mean: average {fitIndexOf(activeParam)!.label}. Power: share of replications
                      whose {fitIndexOf(activeParam)!.label} misses its cutoff (poor fit if{' '}
                      {poorFitRule(fitIndexOf(activeParam)!)}; Hu &amp; Bentler 1999), detecting
                      that the estimated model leaves out what the population has (cross-loadings,
                      error correlations or paths). Robust estimators use the robust index.
                    </>
                  ) : (
                    <>
                      Mean: average {fitIndexOf(activeParam)!.label}. Type I: share of replications
                      whose {fitIndexOf(activeParam)!.label} misses its cutoff (poor fit if{' '}
                      {poorFitRule(fitIndexOf(activeParam)!)}; Hu &amp; Bentler 1999) although the
                      model is correct. Robust estimators use the robust index. Cutoffs that reject
                      correct models often at your sample size are too strict for this model.
                    </>
                  )
                ) : activeParam.kind === 'fit' ? (
                  activeParam.value ? (
                    <>
                      Mean: average (scaled) χ². Power: share of replications rejecting the
                      misspecified model at α = {design.alpha}. Robust estimators use their scaled
                      statistic.
                    </>
                  ) : (
                    <>
                      Mean: average (scaled) χ². Type I: share of replications rejecting the correct
                      model at α = {design.alpha}; it should be close to α. Robust estimators use
                      their scaled statistic.
                    </>
                  )
                ) : (
                  <>
                    Bias and RMSE against the true standardised value. Coverage: share of{' '}
                    {Math.round((1 - design.alpha) * 100)}% intervals containing the true value
                    (PLS: {inferenceNote(design.inference ?? DEFAULT_INFERENCE)}; CB: Wald for
                    paths, Monte Carlo for indirect effects). Power: share of replications rejecting
                    H₀ at α = {design.alpha}; 0.80 is the usual target. CI width: mean width of the
                    intervals, standardised (CB-SEM: the marker-metric width rescaled by the
                    population loadings), for planning a sample size by precision. Inadmissible:
                    share of solutions that are not possible ones (CB-SEM: negative variances or
                    correlations beyond ±1; PLSc: reliabilities or correlations beyond 1); they stay
                    in the summary. Failed replications (non-convergence) are excluded and counted.
                  </>
                )
              }
            />
            <TestsTable rows={rows} param={activeParam} alpha={design.alpha} />
          </>
        )
      )}
    </div>
  );
}

/**
 * Rejection rate of every bootstrap test from the same draws (PLS with bootstrap samples): the comparison
 * of Rönkkö, McIntosh & Antonakis (2015, table 2) — at a true value of 0, the false-positive rate.
 */
function TestsTable({
  rows,
  param,
  alpha,
}: {
  rows: McSummaryRow[];
  param: McParam;
  alpha: number;
}) {
  const shown = rows.filter((r) => r.param.key === param.key && r.tests);
  if (!shown.length) return null;
  const isNull = Math.abs(param.value) < 1e-12;
  return (
    <Table
      title={isNull ? 'Type I error by test' : 'Power by test'}
      file="simulation-tests"
      columns={['Estimator', 'N', ...MC_TESTS.map((t) => MC_TEST_LABELS[t])]}
      rows={shown.map(
        (r): Row => [
          c(r.estimator),
          c(String(r.n)),
          ...MC_TESTS.map((t) => {
            const v = r.tests?.[t];
            const off = isNull && v !== undefined && v > 2 * alpha;
            return c(v ?? null, off ? 'bad' : '');
          }),
        ],
      )}
      note={
        <>
          Share of replications rejecting H₀: θ = 0 at α = {alpha}, every test from the same
          bootstrap draws (after the sign-change correction). t: estimate / bootstrap SE on n − 1
          df. Interval tests reject when the interval excludes 0.{' '}
          {isNull ? 'The true value is 0, so these are false positives; above 2α is marked.' : ''}{' '}
          BCa needs the jackknife: it is computed only when BCa is the chosen interval.
        </>
      }
    />
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
  engineChoice: true,
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
    const wlsmv = d.estimators.some((e) => e.method === 'cb' && e.estimator === 'WLSMV');
    if (wlsmv && ctx.settings.engine !== 'r')
      return 'WLSMV is estimated by lavaan: choose the R engine.';
    if (wlsmv && d.ordinal && d.missing && d.missing.rate > 0 && d.missing.cb === 'fiml')
      return 'lavaan has no FIML for ordinal indicators (WLSMV): choose casewise deletion for CB-SEM.';
    if (
      d.missing &&
      d.missing.rate > 0 &&
      d.missing.cb === 'fiml' &&
      ctx.settings.engine !== 'r' &&
      d.estimators.some((e) => e.method === 'cb')
    )
      return 'FIML is estimated by lavaan: choose the R engine, or casewise deletion for CB-SEM.';
    if (!d.population.paths.length && d.estimators.some((e) => e.method !== 'cb'))
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
