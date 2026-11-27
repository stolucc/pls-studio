// Time-varying effect models (TVEM; Tan, Shiyko, Li, Li & Dierker 2012): in intensive longitudinal data, how the
// intercept and the effect of each predictor change smoothly with time (or age), estimated as the tvem package does
// with mgcv (penalised B-splines, standard errors clustered by subject).

import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, Table, type Row } from '../components/results/Table';
import { PlotPanel } from '../figure/panel';
import { fmt } from '../format';
import type { TvemCurve, TvemInput, TvemResult } from '../rengine/tvem';
import {
  clampNum,
  ColumnSelect,
  columnsFingerprint,
  isObj,
  missingColumns,
  name,
  names,
  rawData,
} from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export type TvemOptions = TvemInput;

const LINE = '#2a78d6';

function TvemForm({ options: o, set, ctx, disabled }: OptionsProps<TvemOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data in long format first.</div>;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  const used = [o.outcome, o.time, o.subject, ...o.varying].filter(Boolean);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <ColumnSelect
        id="tvem-outcome"
        label="Outcome"
        value={o.outcome}
        columns={numeric}
        exclude={used}
        onChange={(outcome) => set({ ...o, outcome })}
      />
      <ColumnSelect
        id="tvem-time"
        label="Time (or age)"
        value={o.time}
        columns={numeric}
        exclude={used}
        onChange={(time) => set({ ...o, time })}
      />
      <OrderedPicker
        label="Predictors whose effects vary with time"
        columns={numeric.filter((n) => n !== o.outcome && n !== o.time && n !== o.subject)}
        value={o.varying}
        onChange={(varying) => set({ ...o, varying })}
      />
      <ColumnSelect
        id="tvem-subject"
        label="Subject (optional)"
        optional="None: each row is a case of its own"
        value={o.subject}
        columns={d.names}
        exclude={used}
        onChange={(subject) => set({ ...o, subject })}
      />
      <div className="field">
        <label htmlFor="tvem-knots">Interior knots</label>
        <input
          id="tvem-knots"
          className="input num"
          type="number"
          min={3}
          max={50}
          value={o.knots}
          onChange={(e) => set({ ...o, knots: clampNum(e.target.value, 3, 50, o.knots, true) })}
        />
        <div className="hint">
          Of each penalised spline (tvem’s default 20): the penalty chooses the smoothness, so more
          knots only allow more wiggle where the data support it.
        </div>
      </div>
      <div className="hint">
        Data in long format, one row per subject and occasion. Each effect is a smooth function of
        time; the repeated rows of a subject are allowed for by standard errors clustered by subject
        (working independence), as in the tvem package. Rows with a missing value in any chosen
        column are left out.
      </div>
    </fieldset>
  );
}

/** One coefficient against time, with its pointwise 95% band and the zero line. */
export function CurveChart({ r, curve, time }: { r: TvemResult; curve: TvemCurve; time: string }) {
  const W = 460;
  const H = 230;
  const pad = { l: 56, r: 14, t: 12, b: 40 };
  const lo = Math.min(0, ...curve.lower);
  const hi = Math.max(0, ...curve.upper);
  const span = hi - lo || 1;
  const t0 = r.grid[0];
  const t1 = r.grid[r.grid.length - 1];
  const sx = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi + 0.05 * span - v) / (span * 1.1)) * (H - pad.t - pad.b);
  const title = curve.name === '(Intercept)' ? 'Intercept' : `Effect of ${curve.name}`;
  const band =
    r.grid.map((t, i) => `${i ? 'L' : 'M'} ${sx(t)} ${sy(curve.upper[i])}`).join(' ') +
    ' ' +
    [...r.grid]
      .map((t, i) => [t, i] as const)
      .reverse()
      .map(([t, i]) => `L ${sx(t)} ${sy(curve.lower[i])}`)
      .join(' ') +
    ' Z';
  return (
    <ChartFrame
      id={`tvem:${curve.name}`}
      name={`tvem-${curve.name}`}
      width={W}
      height={H}
      defaults={{ x: time, y: title }}
      figure={(labels) => ({
        title,
        x: { title: labels.x, limits: [t0, t1] },
        y: { title: labels.y, limits: [lo - 0.05 * span, hi + 0.05 * span] },
        width: W,
        height: H,
        layers: [
          { geom: 'hline', color: '#8a94a6', linetype: 'dashed', y: [0] },
          {
            geom: 'ribbon',
            color: LINE,
            alpha: 0.2,
            x: r.grid,
            ymin: curve.lower,
            ymax: curve.upper,
          },
          { geom: 'line', color: LINE, x: r.grid, y: curve.estimate },
        ],
      })}
    >
      {(labels) => (
        <svg className="mc-chart" width={W} height={H} role="img" aria-label={title}>
          <PlotPanel x={pad.l} y={pad.t} width={W - pad.l - pad.r} height={H - pad.t - pad.b} />
          <line
            className="grid-line"
            x1={pad.l}
            x2={W - pad.r}
            y1={sy(0)}
            y2={sy(0)}
            strokeDasharray="4 3"
          />
          <path d={band} fill={LINE} fillOpacity={0.18} stroke="none" />
          <path
            d={r.grid.map((t, i) => `${i ? 'L' : 'M'} ${sx(t)} ${sy(curve.estimate[i])}`).join(' ')}
            stroke={LINE}
            strokeWidth={2.2}
            fill="none"
          />
          {[lo, hi].map((v, i) => (
            <text key={i} x={pad.l - 6} y={sy(v) + 4} textAnchor="end">
              {fmt(v, 2)}
            </text>
          ))}
          {[t0, (t0 + t1) / 2, t1].map((t, i) => (
            <text key={i} x={sx(t)} y={H - pad.b + 16} textAnchor="middle">
              {fmt(t, 1)}
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
        </svg>
      )}
    </ChartFrame>
  );
}

/** Eleven evenly spaced points of the grid (its ends included), for the tables. */
export const tablePoints = (n: number) =>
  Array.from({ length: 11 }, (_, k) => Math.round((k * (n - 1)) / 10));

function TvemView({ r, o }: { r: TvemResult; o: TvemOptions }) {
  const at = tablePoints(r.grid.length);
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.n} rows
        {o.subject ? ` of ${r.clusters} subjects` : ''}; penalised cubic B-splines with {r.knots}{' '}
        interior knots, {fmt(r.edf, 1)} effective degrees of freedom in all (mgcv {r.engine.version}
        ).
      </p>
      {r.curves.map((cv) => (
        <div key={cv.name}>
          <CurveChart r={r} curve={cv} time={o.time} />
          <Table
            title={
              cv.name === '(Intercept)' ? 'Intercept over time' : `Effect of ${cv.name} over time`
            }
            file={`tvem-${cv.name}`}
            columns={[o.time, 'Estimate', 'Std. error', '95% CI']}
            rows={at.map(
              (i): Row => [
                c(r.grid[i]),
                c(cv.estimate[i]),
                c(cv.se[i]),
                c(`[${fmt(cv.lower[i], 3)}, ${fmt(cv.upper[i], 3)}]`),
              ],
            )}
            note={
              cv.name === '(Intercept)'
                ? 'The expected outcome when every predictor is 0, at each time.'
                : `The change in ${o.outcome} per unit of ${cv.name} at each time. Pointwise intervals: where the band excludes 0, the effect differs from 0 at that time.`
            }
          />
        </div>
      ))}
      <p className="hint">
        Tan et al. (2012): each effect is a linear term plus a smooth of time held at 0 at time 0,
        penalised (first-order penalty) and fitted by mgcv::bam with fast REML; standard errors from
        the smoothing-corrected covariance in a sandwich clustered by{' '}
        {o.subject ? 'subject' : 'row'}, as the tvem package computes them.
      </p>
    </div>
  );
}

function tvemBlocked(o: TvemOptions, ctx: AnalysisCtx): string | null {
  if (!o.outcome || !o.time) return 'Choose the outcome and the time variable.';
  if (!o.varying.length) return 'Choose at least one predictor whose effect varies with time.';
  const all = [o.outcome, o.time, ...o.varying, ...(o.subject ? [o.subject] : [])];
  if (new Set(all).size !== all.length)
    return 'The outcome, time, subject and predictors must be different columns.';
  return missingColumns(ctx, all, 'A time-varying effect model');
}

export const tvemAnalysis: AnalysisType<TvemOptions, TvemResult> = {
  id: 'tvem',
  title: 'Time-varying effect model (TVEM)',
  sub: 'an intercept and effects that change smoothly with time, from long data (mgcv, as tvem)',
  group: 'Longitudinal',
  defaults: () => ({ outcome: '', time: '', subject: '', varying: [], knots: 20 }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          outcome: name(raw.outcome) ?? '',
          time: name(raw.time) ?? '',
          subject: name(raw.subject) ?? '',
          varying: names(raw.varying),
          knots: clampNum(raw.knots, 3, 50, 20, true),
        }
      : null,
  Options: TvemForm,
  View: ({ result, options }) => <TvemView r={result} o={options} />,
  blocked: tvemBlocked,
  fingerprint: (o, ctx) =>
    columnsFingerprint(
      ctx,
      [o.outcome, o.time, ...o.varying, ...(o.subject ? [o.subject] : [])],
      [o.knots, `subject:${o.subject}`],
    ),
  run: async (o, ctx) => (await import('../rengine/tvem')).tvemR(rawData(ctx)!, o),
  script: async (o, ctx) => (await import('../rengine/tvem')).tvemScriptR(rawData(ctx)!, o),
  summary: (o) =>
    `${o.outcome || '…'} over ${o.time || '…'} · ${o.varying.length} varying effect${o.varying.length === 1 ? '' : 's'}`,
};
