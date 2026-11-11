// Chart card: a histogram, scatterplot, box plot or bar chart of columns of
// the dataset, drawn in the browser (no R) and exportable like every chart.

import { useMemo } from 'react';
import { ChartFrame } from '../components/ChartFrame';
import type { Dataset } from '../engine/types';
import { fmt } from '../format';
import {
  boxStats,
  counts,
  groupsOf,
  histogram,
  olsLine,
  type BoxStats,
  type HistogramBin,
} from './chartStats';
import {
  Choice,
  clampNum,
  ColumnSelect,
  columnsFingerprint,
  flag,
  isObj,
  missingColumns,
  name,
  oneOf,
  rawData,
} from './common';
import type { AnalysisType, OptionsProps } from './types';
import { seriesColor } from '../figure/palette';

export type ChartKind = 'histogram' | 'scatter' | 'box' | 'bar';
export interface ChartOptions {
  kind: ChartKind;
  x: string;
  y: string;
  group: string;
  bins: number;
  fit: boolean;
}
export type ChartResult =
  | { kind: 'histogram'; x: string; bins: HistogramBin[]; n: number; mean: number; sd: number }
  | {
      kind: 'scatter';
      x: string;
      y: string;
      group: string;
      groups: string[];
      points: { x: number; y: number; g: number }[];
      n: number;
      omitted: number;
      fit: { slope: number; intercept: number; r: number; n: number } | null;
    }
  | { kind: 'box'; x: string; group: string; boxes: BoxStats[] }
  | { kind: 'bar'; x: string; bars: { label: string; count: number }[]; n: number };

export const MAX_POINTS = 5000;
/** The chart kinds (each computes its own statistics: bins, OLS line, quartiles, counts). */
export const CHART_KINDS = ['histogram', 'scatter', 'box', 'bar'] as const;
const KINDS: readonly (readonly [ChartKind, string])[] = [
  ['histogram', 'Histogram'],
  ['scatter', 'Scatterplot'],
  ['box', 'Box plot'],
  ['bar', 'Bar chart'],
];
const KIND_NAME: Record<ChartKind, string> = {
  histogram: 'Histogram',
  scatter: 'Scatterplot',
  box: 'Box plot',
  bar: 'Bar chart',
};

const isText = (d: Dataset, n: string) => !!d.categories?.[n];
/** Columns usable as groups: text columns, or numeric ones with few distinct values. */
const groupable = (d: Dataset, n: string) => isText(d, n) || (groupsOf(d, n, 12) ?? []).length >= 2;

function ChartOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<ChartOptions>) {
  const d = rawData(ctx);
  const columns = d?.names ?? [];
  // (scanning every column for distinct values once per dataset, not per keystroke)
  const { numeric, groups } = useMemo(
    () =>
      d
        ? {
            numeric: d.names.filter((n) => !isText(d, n)),
            groups: d.names.filter((n) => groupable(d, n)),
          }
        : { numeric: [], groups: [] },
    [d],
  );
  if (!d || !columns.length) return <div className="empty-results">Import raw data first.</div>;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice
        label="Chart"
        value={o.kind}
        onChange={(kind) => set({ ...o, kind })}
        options={KINDS}
      />
      {o.kind === 'bar' ? (
        <ColumnSelect
          id="chart-x"
          label="Variable (categories)"
          value={o.x}
          columns={groups}
          onChange={(x) => set({ ...o, x })}
        />
      ) : (
        <ColumnSelect
          id="chart-x"
          label={o.kind === 'scatter' ? 'Horizontal axis (x)' : 'Variable'}
          value={o.x}
          columns={numeric}
          exclude={[o.y]}
          onChange={(x) => set({ ...o, x })}
        />
      )}
      {o.kind === 'scatter' && (
        <ColumnSelect
          id="chart-y"
          label="Vertical axis (y)"
          value={o.y}
          columns={numeric}
          exclude={[o.x]}
          onChange={(y) => set({ ...o, y })}
        />
      )}
      {(o.kind === 'scatter' || o.kind === 'box') && (
        <ColumnSelect
          id="chart-group"
          label={o.kind === 'box' ? 'One box per group (optional)' : 'Colour by group (optional)'}
          value={o.group}
          columns={groups}
          exclude={[o.x, o.y]}
          onChange={(group) => set({ ...o, group })}
          optional="No grouping"
        />
      )}
      {o.kind === 'histogram' && (
        <label className="field-inline">
          Bins
          <input
            className="input num"
            type="number"
            min={0}
            max={200}
            value={o.bins || ''}
            placeholder="auto"
            onChange={(e) =>
              set({
                ...o,
                bins: Math.max(0, Math.min(200, Math.round(Number(e.target.value) || 0))),
              })
            }
          />
          <span className="hint">0 or empty: Sturges’ rule, rounded to a round bin width.</span>
        </label>
      )}
      {o.kind === 'scatter' && (
        <label className="check">
          <input
            type="checkbox"
            checked={o.fit}
            onChange={(e) => set({ ...o, fit: e.target.checked })}
          />{' '}
          Least-squares line and correlation
        </label>
      )}
    </fieldset>
  );
}

export const W = 520,
  H = 320,
  pad = { l: 56, r: 16, t: 14, b: 44 };
const ticks = (lo: number, hi: number, k = 5) =>
  Array.from({ length: k + 1 }, (_, i) => lo + ((hi - lo) * i) / k);
const tickText = (v: number, span: number) =>
  (Math.abs(v) >= 1000 || span >= 1000
    ? v.toFixed(0)
    : span >= 10
      ? v.toFixed(1)
      : v.toFixed(2)
  ).replace(/\.?0+$/, (m) => (m.startsWith('.') ? '' : m));

export function Axes({
  xs,
  ys,
  xTitle,
  yTitle,
  xTick,
  yTick,
}: {
  xs: [number, number];
  ys: [number, number];
  xTitle: string;
  yTitle: string;
  xTick?: (v: number) => string;
  yTick?: (v: number) => string;
}) {
  const sx = (v: number) => pad.l + ((v - xs[0]) / (xs[1] - xs[0] || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((ys[1] - v) / (ys[1] - ys[0] || 1)) * (H - pad.t - pad.b);
  return (
    <>
      {ticks(ys[0], ys[1]).map((v) => (
        <g key={`y${v}`}>
          <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} />
          <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">
            {(yTick ?? ((t) => tickText(t, ys[1] - ys[0])))(v)}
          </text>
        </g>
      ))}
      {ticks(xs[0], xs[1]).map((v) => (
        <text key={`x${v}`} x={sx(v)} y={H - pad.b + 16} textAnchor="middle">
          {(xTick ?? ((t) => tickText(t, xs[1] - xs[0])))(v)}
        </text>
      ))}
      <text
        x={pad.l + (W - pad.l - pad.r) / 2}
        y={H - 4}
        textAnchor="middle"
        className="axis-title"
      >
        {xTitle}
      </text>
      <text
        transform={`translate(12 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`}
        textAnchor="middle"
        className="axis-title"
      >
        {yTitle}
      </text>
    </>
  );
}

function ChartView({ r }: { r: ChartResult }) {
  const id = `chart:${r.kind}:${r.x}${'y' in r ? `:${r.y}` : ''}`;
  if (r.kind === 'histogram') {
    if (!r.bins.length) return <div className="empty-results">No values to chart.</div>;
    const xs: [number, number] = [r.bins[0].from, r.bins[r.bins.length - 1].to],
      yMax = Math.max(...r.bins.map((b) => b.count)) * 1.05 || 1;
    const sx = (v: number) => pad.l + ((v - xs[0]) / (xs[1] - xs[0] || 1)) * (W - pad.l - pad.r);
    const sy = (v: number) => pad.t + ((yMax - v) / yMax) * (H - pad.t - pad.b);
    return (
      <ChartFrame
        id={id}
        name={`histogram-${r.x}`}
        width={W}
        height={H}
        defaults={{ x: r.x, y: 'Count' }}
        caption={
          <span className="hint">
            n = {r.n}, mean {fmt(r.mean)}, SD {fmt(r.sd)}; {r.bins.length} bins of width{' '}
            {fmt(r.bins[0].to - r.bins[0].from, 3)}.
          </span>
        }
      >
        {(labels) => (
          <svg
            className="mc-chart data-chart"
            width={W}
            height={H}
            role="img"
            aria-label={`Histogram of ${r.x}`}
          >
            <Axes
              xs={xs}
              ys={[0, yMax]}
              xTitle={labels.x}
              yTitle={labels.y}
              yTick={(v) => v.toFixed(0)}
            />
            {r.bins.map((b) => (
              <rect
                key={b.from}
                className="bar"
                x={sx(b.from) + 0.5}
                y={sy(b.count)}
                width={Math.max(1, sx(b.to) - sx(b.from) - 1)}
                height={sy(0) - sy(b.count)}
              >
                <title>{`${fmt(b.from, 3)} – ${fmt(b.to, 3)}: ${b.count}`}</title>
              </rect>
            ))}
          </svg>
        )}
      </ChartFrame>
    );
  }
  if (r.kind === 'bar') {
    const yMax = Math.max(...r.bars.map((b) => b.count)) * 1.05 || 1;
    const bw = (W - pad.l - pad.r) / r.bars.length;
    const sy = (v: number) => pad.t + ((yMax - v) / yMax) * (H - pad.t - pad.b);
    return (
      <ChartFrame
        id={id}
        name={`bar-${r.x}`}
        width={W}
        height={H}
        defaults={{ x: r.x, y: 'Count' }}
        caption={
          <span className="hint">
            n = {r.n} in {r.bars.length} categories.
          </span>
        }
      >
        {(labels) => (
          <svg
            className="mc-chart data-chart"
            width={W}
            height={H}
            role="img"
            aria-label={`Bar chart of ${r.x}`}
          >
            {ticks(0, yMax).map((v) => (
              <g key={v}>
                <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} />
                <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">
                  {v.toFixed(0)}
                </text>
              </g>
            ))}
            {r.bars.map((b, i) => (
              <g key={b.label}>
                <rect
                  className="bar"
                  x={pad.l + i * bw + bw * 0.15}
                  y={sy(b.count)}
                  width={bw * 0.7}
                  height={sy(0) - sy(b.count)}
                >
                  <title>{`${b.label}: ${b.count}`}</title>
                </rect>
                <text x={pad.l + i * bw + bw / 2} y={H - pad.b + 16} textAnchor="middle">
                  {b.label.length > 12 ? `${b.label.slice(0, 11)}…` : b.label}
                </text>
              </g>
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
              transform={`translate(12 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`}
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
  if (r.kind === 'box') {
    if (!r.boxes.length) return <div className="empty-results">No values to chart.</div>;
    const all = r.boxes.flatMap((b) => [b.lo, b.hi, ...b.outliers]);
    let lo = Infinity,
      hi = -Infinity;
    for (const v of all) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const m = (hi - lo || 1) * 0.05;
    const ys: [number, number] = [lo - m, hi + m];
    const bw = (W - pad.l - pad.r) / r.boxes.length;
    const sy = (v: number) => pad.t + ((ys[1] - v) / (ys[1] - ys[0] || 1)) * (H - pad.t - pad.b);
    return (
      <ChartFrame
        id={id}
        name={`box-${r.x}`}
        width={W}
        height={H}
        defaults={{ x: r.group || '', y: r.x }}
        caption={
          <span className="hint">
            Boxes: quartiles and median; whiskers: last values within 1.5 × IQR; dots: outliers.{' '}
            {r.boxes.map((b) => `${b.label}: n = ${b.n}, median ${fmt(b.median)}`).join('; ')}.
          </span>
        }
      >
        {(labels) => (
          <svg
            className="mc-chart data-chart"
            width={W}
            height={H}
            role="img"
            aria-label={`Box plot of ${r.x}`}
          >
            {ticks(ys[0], ys[1]).map((v) => (
              <g key={v}>
                <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} />
                <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">
                  {tickText(v, ys[1] - ys[0])}
                </text>
              </g>
            ))}
            {r.boxes.map((b, i) => {
              const cx = pad.l + i * bw + bw / 2,
                half = Math.min(40, bw * 0.3);
              return (
                <g key={b.label}>
                  <line className="whisker" x1={cx} x2={cx} y1={sy(b.hi)} y2={sy(b.q3)} />
                  <line className="whisker" x1={cx} x2={cx} y1={sy(b.q1)} y2={sy(b.lo)} />
                  <line
                    className="whisker"
                    x1={cx - half / 2}
                    x2={cx + half / 2}
                    y1={sy(b.hi)}
                    y2={sy(b.hi)}
                  />
                  <line
                    className="whisker"
                    x1={cx - half / 2}
                    x2={cx + half / 2}
                    y1={sy(b.lo)}
                    y2={sy(b.lo)}
                  />
                  <rect
                    className="box"
                    x={cx - half}
                    y={sy(b.q3)}
                    width={half * 2}
                    height={Math.max(1, sy(b.q1) - sy(b.q3))}
                  />
                  <line
                    className="median"
                    x1={cx - half}
                    x2={cx + half}
                    y1={sy(b.median)}
                    y2={sy(b.median)}
                  />
                  {b.outliers.map((v, k) => (
                    <circle key={k} className="dot" cx={cx} cy={sy(v)} r={3} />
                  ))}
                  {r.boxes.length > 1 && (
                    <text x={cx} y={H - pad.b + 16} textAnchor="middle">
                      {b.label.length > 12 ? `${b.label.slice(0, 11)}…` : b.label}
                    </text>
                  )}
                </g>
              );
            })}
            <text
              x={pad.l + (W - pad.l - pad.r) / 2}
              y={H - 4}
              textAnchor="middle"
              className="axis-title"
            >
              {labels.x}
            </text>
            <text
              transform={`translate(12 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`}
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
  return <Scatter r={r} id={id} />;
}

function Scatter({ r, id }: { r: Extract<ChartResult, { kind: 'scatter' }>; id: string }) {
  const { xs, ys } = useMemo(() => {
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const p of r.points) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    const pad5 = (lo: number, hi: number): [number, number] => {
      const m = (hi - lo || 1) * 0.05;
      return [lo - m, hi + m];
    };
    return { xs: pad5(x0, x1), ys: pad5(y0, y1) };
  }, [r.points]);
  if (!r.points.length) return <div className="empty-results">No complete pairs to chart.</div>;
  const sx = (v: number) => pad.l + ((v - xs[0]) / (xs[1] - xs[0] || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((ys[1] - v) / (ys[1] - ys[0] || 1)) * (H - pad.t - pad.b);
  const f = r.fit;
  return (
    <ChartFrame
      id={id}
      name={`scatter-${r.x}-${r.y}`}
      width={W}
      height={H}
      defaults={{ x: r.x, y: r.y }}
      caption={
        <span className="hint">
          n = {r.n} pairs{r.omitted ? ` (${r.omitted} not drawn)` : ''}
          {f
            ? `; least squares: ${r.y} = ${fmt(f.intercept)} + ${fmt(f.slope)} × ${r.x}, r = ${fmt(f.r)}`
            : ''}
          .{r.groups.length > 1 ? ` Colours: ${r.groups.join(', ')}.` : ''}
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={H}
          role="img"
          aria-label={`Scatterplot of ${r.y} against ${r.x}`}
        >
          <Axes xs={xs} ys={ys} xTitle={labels.x} yTitle={labels.y} />
          {r.points.map((p, i) => (
            <circle
              key={i}
              className="dot"
              cx={sx(p.x)}
              cy={sy(p.y)}
              r={3}
              style={{ fill: seriesColor(p.g) }}
            />
          ))}
          {f && (
            <line
              className="fit-line"
              x1={sx(xs[0])}
              y1={sy(f.intercept + f.slope * xs[0])}
              x2={sx(xs[1])}
              y2={sy(f.intercept + f.slope * xs[1])}
            />
          )}
          {r.groups.length > 1 &&
            r.groups.map((g, i) => (
              <g key={g}>
                <circle
                  cx={W - pad.r - 110}
                  cy={pad.t + 10 + i * 14}
                  r={4}
                  style={{ fill: seriesColor(i) }}
                />
                <text x={W - pad.r - 102} y={pad.t + 14 + i * 14}>
                  {g}
                </text>
              </g>
            ))}
        </svg>
      )}
    </ChartFrame>
  );
}

/** The columns a chart reads. */
export const chartColumns = (o: ChartOptions) =>
  [
    o.x,
    ...(o.kind === 'scatter' ? [o.y] : []),
    ...((o.kind === 'scatter' || o.kind === 'box') && o.group ? [o.group] : []),
  ].filter(Boolean);

export function chartResult(o: ChartOptions, d: Dataset): ChartResult {
  const col = (n: string) => d.cols[d.names.indexOf(n)];
  if (o.kind === 'histogram') return { kind: 'histogram', x: o.x, ...histogram(col(o.x), o.bins) };
  if (o.kind === 'bar') {
    const bars = counts(d, o.x) ?? [];
    return { kind: 'bar', x: o.x, bars, n: bars.reduce((s, b) => s + b.count, 0) };
  }
  const groups = o.group ? groupsOf(d, o.group, 12) : null;
  if (o.kind === 'box') {
    const x = col(o.x);
    const boxes = groups
      ? groups.flatMap((g) => {
          const gc = col(o.group);
          const b = boxStats(
            Array.from(x).filter((_, i) => gc[i] === g.value),
            g.label,
          );
          return b ? [b] : [];
        })
      : [boxStats(x, o.x)].filter((b): b is BoxStats => !!b);
    return { kind: 'box', x: o.x, group: o.group, boxes };
  }
  const x = col(o.x),
    y = col(o.y),
    gc = groups ? col(o.group) : null;
  const points: { x: number; y: number; g: number }[] = [];
  let complete = 0;
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue;
    complete++;
    if (points.length < MAX_POINTS)
      points.push({
        x: x[i],
        y: y[i],
        g:
          gc && groups
            ? Math.max(
                0,
                groups.findIndex((g) => g.value === gc[i]),
              )
            : 0,
      });
  }
  return {
    kind: 'scatter',
    x: o.x,
    y: o.y,
    group: o.group,
    groups: groups ? groups.map((g) => g.label) : [],
    points,
    n: complete,
    omitted: complete - points.length,
    fit: o.fit ? olsLine(x, y) : null,
  };
}

export const chartAnalysis: AnalysisType<ChartOptions, ChartResult> = {
  id: 'chart',
  title: 'Chart',
  sub: 'histogram, scatterplot, box plot or bar chart of the data',
  group: 'Data',
  entries: [
    {
      title: 'Histogram',
      sub: 'distribution of one variable',
      options: (o) => ({ ...o, kind: 'histogram' }),
    },
    {
      title: 'Scatterplot',
      sub: 'two variables, with a least-squares line',
      options: (o) => ({ ...o, kind: 'scatter', fit: true }),
    },
    {
      title: 'Box plot',
      sub: 'quartiles and outliers, per group',
      options: (o) => ({ ...o, kind: 'box' }),
    },
    {
      title: 'Bar chart',
      sub: 'counts of a categorical variable',
      options: (o) => ({ ...o, kind: 'bar' }),
    },
  ],
  cardTitle: (o) =>
    `${KIND_NAME[o.kind]}${o.x ? `: ${o.x}${o.kind === 'scatter' && o.y ? ` and ${o.y}` : ''}` : ''}`,
  defaults: () => ({ kind: 'histogram', x: '', y: '', group: '', bins: 0, fit: true }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          kind: oneOf(raw.kind, CHART_KINDS, 'histogram'),
          x: name(raw.x),
          y: name(raw.y),
          group: name(raw.group),
          bins: clampNum(raw.bins, 0, 200, 0, true),
          fit: flag(raw.fit),
        }
      : null,
  Options: ChartOptionsForm,
  View: ({ result }) => <ChartView r={result} />,
  blocked: (o, ctx) => {
    const d = rawData(ctx);
    if (!d) return 'Charts need raw data.';
    if (!o.x) return 'Choose a variable.';
    if (o.kind === 'scatter' && !o.y) return 'Choose the variable for the vertical axis.';
    if (o.kind === 'scatter' && o.x === o.y) return 'Choose two different variables.';
    const missing = missingColumns(ctx, chartColumns(o), 'The chart');
    if (missing) return missing;
    if (o.kind === 'bar')
      return groupable(d, o.x)
        ? null
        : `“${o.x}” has too many distinct values for a bar chart (at most 12); try a histogram.`;
    for (const n of [o.x, ...(o.kind === 'scatter' ? [o.y] : [])])
      if (isText(d, n))
        return `“${n}” is a text column; choose a numeric variable${o.kind === 'histogram' ? ', or a bar chart' : ''}.`;
    if (o.group && !groupable(d, o.group))
      return `“${o.group}” has too many distinct values to group by (at most 12).`;
    return null;
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, chartColumns(o), [o.kind, o.bins, o.fit ? 1 : 0]),
  run: async (o, ctx) => chartResult(o, rawData(ctx)!),
  summary: (o) =>
    `${KIND_NAME[o.kind].toLowerCase()} of ${o.x || '…'}${o.kind === 'scatter' ? ` and ${o.y || '…'}` : ''}${o.group && (o.kind === 'scatter' || o.kind === 'box') ? ` by ${o.group}` : ''}`,
};
