// Descriptives / Explore card (JASP's Descriptives; SPSS's Descriptives, Frequencies and
// Explore): statistics of chosen variables, optionally split by a grouping column,
// frequency tables, normality tests (R/explore.R) and, drawn in the browser, a histogram
// with its kernel density, a normal Q-Q plot and a raincloud plot per variable.

import { useMemo, useState } from 'react';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table, type Row } from '../components/results/Table';
import type { Dataset } from '../engine/types';
import { mulberry32 } from '../engine/stats';
import { fmt } from '../format';
import { seriesColor } from '../figure/palette';
import type { ExploreInput, ExploreResult, ExploreStats, ExploreTest } from '../rengine/explore';
import {
  boxStats,
  groupsOf,
  histogram,
  kernelDensity,
  qqPlot,
  type BoxStats,
  type HistogramBin,
  type QQPlot,
} from './chartStats';
import { Axes, H, pad, W } from './charts';
import {
  Choice,
  ColumnSelect,
  columnsFingerprint,
  isObj,
  missingColumns,
  name,
  names,
  rawData,
} from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export type ExploreOptions = Omit<ExploreInput, 'confidence'> & {
  /** Histogram, Q-Q and raincloud plots (drawn in the browser). */
  plots: boolean;
};

/** One variable's plots in one group. */
export interface ExplorePlot {
  variable: string;
  group: string;
  hist: { bins: HistogramBin[]; n: number; mean: number; sd: number };
  density: { x: number; y: number }[];
  qq: QQPlot | null;
  box: BoxStats | null;
  /** The values for the raincloud's dots (at most MAX_DOTS, evenly spaced through the data). */
  dots: number[];
}

export type ExploreCardResult = ExploreResult & { plots: ExplorePlot[] };

/** Most groups a grouping column may have. */
export const MAX_GROUPS = 30;
/** Most categories a frequency table may have. */
export const MAX_LEVELS = 100;
const MAX_DOTS = 1000;

const isText = (d: Dataset, n: string) => !!d.categories?.[n];

/** Percentiles from typed text: numbers between 0 and 100, each once, sorted, at most 20. */
export function parsePercentiles(text: string): number[] {
  const values = text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number)
    .filter((p) => Number.isFinite(p) && p > 0 && p < 100);
  return [...new Set(values)].sort((a, b) => a - b).slice(0, 20);
}

function PercentileField({
  value,
  onChange,
}: {
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const [text, setText] = useState(value.join(', '));
  return (
    <div className="field">
      <label htmlFor="ex-pct">Percentiles (optional)</label>
      <input
        id="ex-pct"
        className="input"
        value={text}
        placeholder="e.g. 5, 10, 90, 95"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const p = parsePercentiles(text);
          setText(p.join(', '));
          onChange(p);
        }}
      />
      <div className="hint">Numbers between 0 and 100, separated by commas.</div>
    </div>
  );
}

function ExploreForm({ options: o, set, ctx, disabled }: OptionsProps<ExploreOptions>) {
  const d = rawData(ctx);
  // (scanning every column for its distinct values once per dataset, not per keystroke)
  const groupable = useMemo(
    () => (d ? d.names.filter((n) => isText(d, n) || groupsOf(d, n, MAX_GROUPS)) : []),
    [d],
  );
  if (!d) return <div className="empty-results">Import raw data first.</div>;
  const numeric = d.names.filter((n) => !isText(d, n) && n !== o.group);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <OrderedPicker
        label="Variables (numeric)"
        columns={numeric}
        value={o.vars}
        onChange={(vars) => set({ ...o, vars })}
      />
      <OrderedPicker
        label="Frequency tables (categorical, optional)"
        columns={groupable.filter((n) => n !== o.group)}
        value={o.frequencies}
        onChange={(frequencies) => set({ ...o, frequencies })}
        hint="Text columns, or numeric codes with few values."
      />
      <ColumnSelect
        id="ex-group"
        label="Split by (optional)"
        value={o.group}
        columns={groupable}
        exclude={[...o.vars, ...o.frequencies]}
        onChange={(group) => set({ ...o, group })}
        optional="No grouping"
      />
      <PercentileField
        value={o.percentiles}
        onChange={(percentiles) => set({ ...o, percentiles })}
      />
      <Choice
        label="Quantiles"
        value={String(o.quantileType) as '6' | '7'}
        onChange={(v) => set({ ...o, quantileType: v === '6' ? 6 : 7 })}
        options={[
          ['7', 'R and JASP (type 7)'],
          ['6', 'SPSS (type 6)'],
        ]}
        hint="How quartiles and percentiles interpolate: R’s default (type 7, as JASP), or SPSS’s weighted average (type 6, HAVERAGE)."
      />
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={o.normality}
            onChange={(e) => set({ ...o, normality: e.target.checked })}
          />{' '}
          Normality tests (Shapiro–Wilk, Lilliefors, Anderson–Darling)
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={o.plots}
            onChange={(e) => set({ ...o, plots: e.target.checked })}
          />{' '}
          Plots: histogram with density, Q-Q plot, raincloud plot
        </label>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------- tables

/** A column heading for one variable in one group. */
const columnName = (r: ExploreResult, s: { variable: string; group: string }) =>
  r.groups.length ? `${s.variable} · ${s.group}` : s.variable;

/** The descriptives as JASP lays them out: one row per statistic, one column per variable (and group). */
function DescriptivesTable({ r }: { r: ExploreResult }) {
  const conf = `${Math.round(r.confidence * 100)}%`;
  const stat = (label: string, get: (s: ExploreStats) => number | null, digits?: number): Row => [
    c(label),
    ...r.stats.map((s) => c(get(s), undefined, digits)),
  ];
  const percentileRows = r.percentiles.map((p, k) =>
    stat(`${String(Number(p.toPrecision(6)))}th percentile`, (s) => s.percentiles[k] ?? null),
  );
  const multimodal = r.stats.some((s) => s.modes > 1);
  const rows: Row[] = [
    stat('Valid', (s) => s.n, 0),
    stat('Missing', (s) => s.missing, 0),
    stat('Mean', (s) => s.mean),
    stat('Std. error of the mean', (s) => s.se),
    stat(`${conf} CI of the mean, lower`, (s) => s.ciLow),
    stat(`${conf} CI of the mean, upper`, (s) => s.ciHigh),
    stat('Std. deviation', (s) => s.sd),
    stat('Coefficient of variation', (s) => s.cv),
    stat('Median', (s) => s.median),
    [
      c('Mode'),
      ...r.stats.map((s) => {
        if (s.mode === null) return c(null);
        return { v: `${fmt(s.mode)}${s.modes > 1 ? ' ᵃ' : ''}` };
      }),
    ],
    stat('25th percentile', (s) => s.q1),
    stat('75th percentile', (s) => s.q3),
    stat('IQR', (s) => s.iqr),
    ...percentileRows,
    stat('Minimum', (s) => s.min),
    stat('Maximum', (s) => s.max),
    stat('Range', (s) => s.range),
    stat('Skewness', (s) => s.skewness),
    stat('Std. error of skewness', (s) => s.seSkewness),
    stat('Kurtosis (excess)', (s) => s.kurtosis),
    stat('Std. error of kurtosis', (s) => s.seKurtosis),
  ];
  const quantiles =
    r.quantileType === 6
      ? 'SPSS’s weighted average (R’s quantile type 6)'
      : 'R’s default interpolation (type 7, as JASP)';
  const dropped = r.droppedRows
    ? ` ${r.droppedRows} row${r.droppedRows === 1 ? '' : 's'} without a group left out.`
    : '';
  const note =
    `Skewness G1 and excess kurtosis G2 as SPSS, SAS and psych::describe(type = 2) define them, with SPSS’s ` +
    `standard errors (the data screening card shows psych’s type 3, b1 and b2, which differ slightly in small ` +
    `samples). Quartiles, IQR and percentiles: ${quantiles}. CI of the mean from the t distribution; ` +
    `coefficient of variation: SD / mean.${multimodal ? ' ᵃ Several values share the highest count; the smallest is shown.' : ''}${dropped}`;
  return (
    <Table
      title="Descriptive statistics"
      file="descriptives"
      columns={['', ...r.stats.map((s) => columnName(r, s))]}
      rows={rows}
      note={note}
    />
  );
}

export function FrequencyTables({ r }: { r: ExploreResult }) {
  return (
    <div className="tables">
      {r.frequencies.map((f) => {
        const rows: Row[] = f.levels.map((l, k) => [
          c(l),
          c(f.counts[k], undefined, 0),
          c(f.percent[k], undefined, 1),
          c(f.validPercent[k], undefined, 1),
          c(f.cumulative[k], undefined, 1),
        ]);
        if (f.missing)
          rows.push([
            c('Missing'),
            c(f.missing, 'warn', 0),
            c((100 * f.missing) / f.total, undefined, 1),
            c(null),
            c(null),
          ]);
        rows.push([c('Total'), c(f.total, undefined, 0), c(100, undefined, 1), c(null), c(null)]);
        return (
          <Table
            key={`${f.variable}:${f.group}`}
            title={`Frequencies: ${columnName(r, f)}`}
            file={`frequencies-${f.variable}`}
            columns={['Category', 'Count', 'Percent', 'Valid percent', 'Cumulative percent']}
            rows={rows}
          />
        );
      })}
    </div>
  );
}

export function NormalityTable({ r }: { r: ExploreResult }) {
  const pair = (t: ExploreTest | null) => [c(t?.stat ?? null), pCell(t?.p ?? null)];
  return (
    <Table
      title="Tests of normality"
      file="normality"
      columns={[
        'Variable',
        'N',
        'Shapiro–Wilk W',
        'p',
        'Lilliefors D',
        'p',
        'Anderson–Darling A',
        'p',
      ]}
      rows={r.normality.map(
        (t): Row => [
          c(columnName(r, t)),
          c(t.n, undefined, 0),
          ...pair(t.shapiro),
          ...pair(t.lilliefors),
          ...pair(t.anderson),
        ],
      )}
      note="A small p speaks against normality; in large samples small departures are significant, so read the Q-Q plot too. Shapiro–Wilk (shapiro.test, 3 to 5,000 values); Kolmogorov–Smirnov with the Lilliefors correction (nortest::lillie.test, as SPSS’s Explore, more than 4 values); Anderson–Darling (nortest::ad.test, more than 7 values). Blank: too few values or a constant variable."
    />
  );
}

// ---------------------------------------------------------------- plots

const sxOf = (xs: [number, number]) => (v: number) =>
  pad.l + ((v - xs[0]) / (xs[1] - xs[0] || 1)) * (W - pad.l - pad.r);
const syOf = (ys: [number, number]) => (v: number) =>
  pad.t + ((ys[1] - v) / (ys[1] - ys[0] || 1)) * (H - pad.t - pad.b);
const path = (pts: [number, number][]) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

/** Histogram on the density scale, with the kernel density curve. */
function HistogramPlot({ p, label }: { p: ExplorePlot; label: string }) {
  const bins = p.hist.bins;
  if (!bins.length) return null;
  const width = bins[0].to - bins[0].from || 1;
  // (bars as densities, count / (n × width), so that the curve and the bars share the axis)
  const heights = bins.map((b) => b.count / (p.hist.n * width));
  let lo = Math.min(bins[0].from, ...p.density.map((d) => d.x));
  let hi = Math.max(bins[bins.length - 1].to, ...p.density.map((d) => d.x));
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const yMax = Math.max(...heights, ...p.density.map((d) => d.y)) * 1.05 || 1;
  const sx = sxOf([lo, hi]);
  const sy = syOf([0, yMax]);
  return (
    <ChartFrame
      id={`explore:hist:${p.variable}:${p.group}`}
      name={`histogram-${p.variable}`}
      width={W}
      height={H}
      defaults={{ x: p.variable, y: 'Density' }}
      caption={
        <span className="hint">
          {label}: n = {p.hist.n}; bars: counts as densities; curve: Gaussian kernel density (R’s
          default bandwidth, bw.nrd0).
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={H}
          role="img"
          aria-label={`Histogram of ${label}`}
        >
          <Axes xs={[lo, hi]} ys={[0, yMax]} xTitle={labels.x} yTitle={labels.y} />
          {bins.map((b, k) => (
            <rect
              key={b.from}
              className="bar"
              x={sx(b.from) + 0.5}
              y={sy(heights[k])}
              width={Math.max(1, sx(b.to) - sx(b.from) - 1)}
              height={sy(0) - sy(heights[k])}
            >
              <title>{`${fmt(b.from, 3)} – ${fmt(b.to, 3)}: ${b.count}`}</title>
            </rect>
          ))}
          <path
            d={path(p.density.map((d) => [sx(d.x), sy(d.y)]))}
            fill="none"
            stroke={seriesColor(1)}
            strokeWidth={2}
          />
        </svg>
      )}
    </ChartFrame>
  );
}

/** Normal Q-Q plot with qqline's quartile line. */
function QQPlotChart({ p, label }: { p: ExplorePlot; label: string }) {
  const q = p.qq;
  if (!q) return null;
  const tx = q.points.map((x) => x.theoretical);
  const sv = q.points.map((x) => x.sample);
  const margin = (a: number, b: number): [number, number] => {
    const m = (b - a || 1) * 0.05;
    return [a - m, b + m];
  };
  const xs = margin(Math.min(...tx), Math.max(...tx));
  const ys = margin(Math.min(...sv), Math.max(...sv));
  const sx = sxOf(xs);
  const sy = syOf(ys);
  const line = (x: number) => q.intercept + q.slope * x;
  return (
    <ChartFrame
      id={`explore:qq:${p.variable}:${p.group}`}
      name={`qq-${p.variable}`}
      width={W}
      height={H}
      defaults={{ x: 'Theoretical normal quantiles', y: `Sample quantiles of ${p.variable}` }}
      caption={
        <span className="hint">
          {label}: points near the line mean a normal distribution; the line passes through the
          quartiles (R’s qqnorm and qqline).
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={H}
          role="img"
          aria-label={`Q-Q plot of ${label}`}
        >
          <Axes xs={xs} ys={ys} xTitle={labels.x} yTitle={labels.y} />
          <line
            className="fit-line"
            x1={sx(xs[0])}
            y1={sy(line(xs[0]))}
            x2={sx(xs[1])}
            y2={sy(line(xs[1]))}
          />
          {q.points.map((x, k) => (
            <circle key={k} className="dot" cx={sx(x.theoretical)} cy={sy(x.sample)} r={2.5} />
          ))}
        </svg>
      )}
    </ChartFrame>
  );
}

/** Raincloud plot: per group a half violin (kernel density), a box plot and the jittered values. */
function RaincloudPlot({ plots, variable }: { plots: ExplorePlot[]; variable: string }) {
  const shown = plots.filter((p) => p.box);
  if (!shown.length) return null;
  const all = shown.flatMap((p) => [...p.dots, ...p.density.map((d) => d.x)]);
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const ys: [number, number] = [lo, hi];
  const sy = syOf(ys);
  const band = (W - pad.l - pad.r) / shown.length;
  const grouped = shown.length > 1 || shown[0].group !== 'All';
  return (
    <ChartFrame
      id={`explore:rain:${variable}`}
      name={`raincloud-${variable}`}
      width={W}
      height={H}
      defaults={{ x: grouped ? 'Group' : '', y: variable }}
      caption={
        <span className="hint">
          Left: kernel density (half violin); middle: box plot (quartiles, whiskers to the last
          values within 1.5 × IQR); right: the values, jittered
          {shown.some((p) => p.dots.length < p.hist.n) ? ` (at most ${MAX_DOTS} per group)` : ''}.
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={H}
          role="img"
          aria-label={`Raincloud plot of ${variable}`}
        >
          <Axes xs={[0, 1]} ys={ys} xTitle={labels.x} yTitle={labels.y} xTick={() => ''} />
          {shown.map((p, k) => {
            const cx = pad.l + band * k + band / 2;
            const half = Math.min(60, band * 0.4);
            const yMax = Math.max(...p.density.map((d) => d.y)) || 1;
            const violin = [
              ...p.density.map((d): [number, number] => [cx - 4 - (d.y / yMax) * half, sy(d.x)]),
              ...[...p.density].reverse().map((d): [number, number] => [cx - 4, sy(d.x)]),
            ];
            const b = p.box!;
            const random = mulberry32(k + 1);
            const colour = seriesColor(k);
            return (
              <g key={p.group}>
                <path d={`${path(violin)}Z`} fill={colour} fillOpacity={0.35} stroke={colour} />
                <line className="whisker" x1={cx} x2={cx} y1={sy(b.hi)} y2={sy(b.lo)} />
                <rect
                  className="box"
                  x={cx - 4}
                  y={sy(b.q3)}
                  width={8}
                  height={Math.max(1, sy(b.q1) - sy(b.q3))}
                />
                <line
                  className="median"
                  x1={cx - 4}
                  x2={cx + 4}
                  y1={sy(b.median)}
                  y2={sy(b.median)}
                />
                {p.dots.map((v, i) => (
                  <circle
                    key={i}
                    cx={cx + 8 + random() * half * 0.8}
                    cy={sy(v)}
                    r={2}
                    fill={colour}
                    fillOpacity={0.6}
                  />
                ))}
                {grouped && (
                  <text x={cx} y={H - pad.b + 16} textAnchor="middle">
                    {p.group}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </ChartFrame>
  );
}

/** The plots of one variable (chosen in the view): histogram, Q-Q plot and raincloud. */
export function PlotsView({ r }: { r: ExploreCardResult }) {
  const [variable, setVariable] = useState(r.vars[0] ?? '');
  const [group, setGroup] = useState(r.plots[0]?.group ?? '');
  const v = r.vars.includes(variable) ? variable : r.vars[0];
  const ofVariable = r.plots.filter((p) => p.variable === v);
  const p = ofVariable.find((x) => x.group === group) ?? ofVariable[0];
  if (!p) return <div className="empty-results">No values to plot.</div>;
  const label = r.groups.length ? `${p.variable} · ${p.group}` : p.variable;
  return (
    <div className="tables">
      <div className="row2">
        <ColumnSelect
          id="ex-plot-var"
          label="Variable"
          value={v}
          columns={r.vars}
          onChange={setVariable}
        />
        {r.groups.length > 0 && (
          <ColumnSelect
            id="ex-plot-group"
            label="Group (histogram, Q-Q plot)"
            value={p.group}
            columns={ofVariable.map((x) => x.group)}
            onChange={setGroup}
          />
        )}
      </div>
      <HistogramPlot p={p} label={label} />
      <QQPlotChart p={p} label={label} />
      <RaincloudPlot plots={ofVariable} variable={v} />
    </div>
  );
}

type Tab = 'descriptives' | 'frequencies' | 'normality' | 'plots';

function ExploreView({ r }: { r: ExploreCardResult }) {
  const tabs: [Tab, string][] = [];
  if (r.stats.length) tabs.push(['descriptives', 'Descriptives']);
  if (r.frequencies.length) tabs.push(['frequencies', 'Frequencies']);
  if (r.normality.length) tabs.push(['normality', 'Normality']);
  if (r.plots.length) tabs.push(['plots', 'Plots']);
  const [tab, setTab] = useState<Tab>(tabs[0]?.[0] ?? 'descriptives');
  const current = tabs.some(([id]) => id === tab) ? tab : tabs[0]?.[0];
  let body = null;
  if (current === 'descriptives') body = <DescriptivesTable r={r} />;
  else if (current === 'frequencies') body = <FrequencyTables r={r} />;
  else if (current === 'normality') body = <NormalityTable r={r} />;
  else if (current === 'plots') body = <PlotsView r={r} />;
  return (
    <>
      <p className="hint" style={{ marginTop: 0 }}>
        R {r.engine.package === 'nortest' ? `with nortest ${r.engine.version}` : r.engine.version}.
        Multivariate normality and outliers: the data screening card.
      </p>
      {tabs.length > 1 && (
        <div className="segmented efa-tabs" role="tablist" aria-label="Descriptives results">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={current === id}
              className={current === id ? 'on' : ''}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {body}
    </>
  );
}

// ---------------------------------------------------------------- the card

/** Values evenly spaced through a list, at most `max` of them. */
function thin(values: number[], max: number): number[] {
  if (values.length <= max) return values;
  const step = values.length / max;
  return Array.from({ length: max }, (_, i) => values[Math.floor(i * step)]);
}

/**
 * The plots of every variable in every group, from the data as the R run used it; `labels`: the groups' names as
 * R gave them (the same groups, in the same order).
 */
export function explorePlots(o: ExploreOptions, d: Dataset, labels: string[] = []): ExplorePlot[] {
  const col = (n: string) => d.cols[d.names.indexOf(n)];
  const groups = o.group ? (groupsOf(d, o.group, MAX_GROUPS) ?? []) : null;
  return o.vars.flatMap((variable) => {
    const x = Array.from(col(variable));
    const parts = groups
      ? groups.map((g, k) => ({
          group: labels[k] ?? g.label,
          values: x.filter((_, i) => col(o.group)[i] === g.value),
        }))
      : [{ group: 'All', values: x }];
    return parts.map(({ group, values }) => {
      const finite = values.filter((v) => Number.isFinite(v));
      return {
        variable,
        group,
        hist: histogram(finite),
        density: kernelDensity(finite),
        qq: qqPlot(finite),
        box: boxStats(finite, group),
        dots: thin(finite, MAX_DOTS),
      };
    });
  });
}

const exploreColumns = (o: ExploreOptions) =>
  [...o.vars, ...o.frequencies, o.group].filter(Boolean);
const exploreInput = (o: ExploreOptions, ctx: Pick<AnalysisCtx, 'settings'>): ExploreInput => ({
  vars: o.vars,
  frequencies: o.frequencies,
  group: o.group,
  percentiles: o.percentiles,
  quantileType: o.quantileType,
  normality: o.normality,
  confidence: ctx.settings.confidence,
});
const engine = () => import('../rengine/explore');

export const exploreAnalysis: AnalysisType<ExploreOptions, ExploreCardResult> = {
  id: 'explore',
  title: 'Descriptives',
  sub: 'by group: mean, SD, CI, percentiles, skewness, frequencies, normality tests, Q-Q and raincloud plots',
  group: 'Data',
  defaults: () => ({
    vars: [],
    frequencies: [],
    group: '',
    percentiles: [],
    quantileType: 7,
    normality: true,
    plots: true,
  }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const percentiles = Array.isArray(raw.percentiles)
      ? parsePercentiles(raw.percentiles.filter((p) => typeof p === 'number').join(','))
      : [];
    return {
      vars: names(raw.vars),
      frequencies: names(raw.frequencies),
      group: name(raw.group),
      percentiles,
      quantileType: raw.quantileType === 6 ? 6 : 7,
      normality: raw.normality !== false,
      plots: raw.plots !== false,
    };
  },
  Options: ExploreForm,
  View: ({ result }) => <ExploreView r={result} />,
  blocked: (o, ctx) => {
    const d = rawData(ctx);
    if (!d) return 'Descriptives need raw data.';
    if (!o.vars.length && !o.frequencies.length) return 'Choose at least one variable.';
    const missing = missingColumns(ctx, exploreColumns(o), 'Descriptives');
    if (missing) return missing;
    const text = o.vars.find((n) => isText(d, n));
    if (text) return `“${text}” is a text column: give it a frequency table instead.`;
    if (o.group && [...o.vars, ...o.frequencies].includes(o.group))
      return 'The grouping variable cannot also be described.';
    if (o.group && !isText(d, o.group) && !groupsOf(d, o.group, MAX_GROUPS))
      return `“${o.group}” has more than ${MAX_GROUPS} distinct values to split by.`;
    const many = o.frequencies.find((n) => !isText(d, n) && !groupsOf(d, n, MAX_LEVELS));
    if (many) return `“${many}” has more than ${MAX_LEVELS} distinct values for a frequency table.`;
    return null;
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, exploreColumns(o), [
      ...o.vars,
      '|',
      ...o.frequencies,
      '|',
      o.group,
      o.percentiles.join(','),
      o.quantileType,
      o.normality ? 1 : 0,
      o.plots ? 1 : 0,
      ctx.settings.confidence,
    ]),
  run: async (o, ctx) => {
    const d = rawData(ctx)!;
    const r = await (await engine()).exploreR(d, exploreInput(o, ctx));
    return { ...r, plots: o.plots ? explorePlots(o, d, r.groups) : [] };
  },
  script: async (o, ctx) => (await engine()).exploreScriptR(rawData(ctx)!, exploreInput(o, ctx)),
  summary: (o) => {
    const all = [...o.vars, ...o.frequencies];
    return `${all.join(', ') || '…'}${o.group ? ` by ${o.group}` : ''}`;
  },
};
