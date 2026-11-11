// Kaplan–Meier survival (survival::survfit, survdiff): the survival curves of one sample or of groups with pointwise
// confidence intervals, censoring marks and a risk table; median survival; log-rank and Peto & Peto tests between
// groups.

import { ChartFrame } from '../components/ChartFrame';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { seriesColor } from '../figure/palette';
import { fmt } from '../format';
import type { KmConfType, KmInput, KmResult, KmStratum } from '../rengine/km';
import {
  Choice,
  ColumnSelect,
  columnsFingerprint,
  isObj,
  missingColumns,
  name,
  oneOf,
  rawData,
} from './common';
import { parseCuts } from './regression';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface KmOptions {
  time: string;
  status: string;
  statusCensored: boolean;
  group: string;
  confType: KmConfType;
  /** The risk table's times; empty: a pretty grid. */
  riskTimes: number[];
  /** Draw the confidence bands (display only). */
  showCi: boolean;
}

const CONF_TYPES: [KmConfType, string][] = [
  ['log', 'Log (survfit’s default)'],
  ['log-log', 'Log-log'],
  ['plain', 'Plain'],
];

function KmForm({ options: o, set, ctx, disabled }: OptionsProps<KmOptions>) {
  const d = rawData(ctx);
  if (!d) return <div className="empty-results">Import raw data first.</div>;
  const numeric = d.names.filter((n) => !d.categories?.[n]);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <div className="row2">
        <ColumnSelect
          id="km-time"
          label="Time"
          value={o.time}
          columns={numeric}
          exclude={[o.status, o.group]}
          onChange={(time) => set({ ...o, time })}
        />
        <ColumnSelect
          id="km-status"
          label="Status (0/1)"
          value={o.status}
          columns={numeric}
          exclude={[o.time, o.group]}
          onChange={(status) => set({ ...o, status })}
        />
      </div>
      <Choice
        label="Status coding"
        value={o.statusCensored ? 'censored' : 'event'}
        onChange={(v) => set({ ...o, statusCensored: v === 'censored' })}
        options={[
          ['event', '1 = event'],
          ['censored', '1 = censored'],
        ]}
      />
      <ColumnSelect
        id="km-group"
        label="Groups (optional)"
        optional="None: one curve"
        value={o.group}
        columns={d.names}
        exclude={[o.time, o.status]}
        onChange={(group) => set({ ...o, group })}
      />
      <Choice
        label="Confidence interval"
        value={o.confType}
        onChange={(confType) => set({ ...o, confType })}
        options={CONF_TYPES}
      />
      <div className="field">
        <label htmlFor="km-times">Risk table times</label>
        <input
          id="km-times"
          className="input"
          placeholder="Automatic; or e.g. 0, 12, 24, 36"
          defaultValue={o.riskTimes.join(', ')}
          onBlur={(e) => set({ ...o, riskTimes: parseRiskTimes(e.target.value) })}
        />
      </div>
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={o.showCi}
            onChange={(e) => set({ ...o, showCi: e.target.checked })}
          />{' '}
          Show the confidence bands
        </label>
      </div>
      <div className="hint">
        Kaplan–Meier estimates (survival::survfit) with pointwise intervals at the confidence level
        of the settings; the log-rank test (survdiff, ρ = 0) and Peto &amp; Peto’s modification of
        the Gehan–Wilcoxon test (ρ = 1), which weights early differences more, compare the groups.
        Cox regression is on the Regression card (Survival).
      </div>
    </fieldset>
  );
}

/** Risk table times typed as a list or ranges, 0 allowed (the start), at most 50. */
export function parseRiskTimes(text: string): number[] {
  const zero = /(^|[,;\s])0([,;\s]|$)/.test(text.trim()) ? [0] : [];
  return [...new Set([...zero, ...parseCuts(text)])].sort((a, b) => a - b).slice(0, 50);
}

const KW = 560;
const PLOT_H = 300;
const KPAD = { l: 56, r: 16, t: 14, b: 44 };
const ROW_H = 18;

/** The step path of a curve from (0, 1): flat to each time, then down to its estimate. */
function stepPath(
  times: number[],
  values: (number | null)[],
  sx: (v: number) => number,
  sy: (v: number) => number,
): string {
  let path = `M${sx(0).toFixed(1)},${sy(1).toFixed(1)}`;
  times.forEach((t, i) => {
    const v = values[i];
    // (an interval bound survfit leaves undefined, e.g. after the last event: the line stops there)
    if (v === null || !Number.isFinite(v)) return;
    path += ` H${sx(t).toFixed(1)} V${sy(v).toFixed(1)}`;
  });
  return path;
}

/** Each group's curve with censoring marks, optional bands, a legend and the risk table below the axes. */
function KmPlot({ r, showCi }: { r: KmResult; showCi: boolean }) {
  const times = r.riskTimes;
  const tMax = Math.max(times[times.length - 1] ?? 0, ...r.strata.flatMap((s) => s.time), 1);
  const riskTop = PLOT_H + 8;
  const height = riskTop + ROW_H * (r.strata.length + 1) + 6;
  const sx = (v: number) => KPAD.l + (v / tMax) * (KW - KPAD.l - KPAD.r);
  const sy = (v: number) => KPAD.t + (1 - v) * (PLOT_H - KPAD.t - KPAD.b);
  const yTicks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const groups = r.strata.length > 1;
  return (
    <ChartFrame
      id="km:curves"
      name="kaplan-meier"
      width={KW}
      height={height}
      defaults={{ x: 'Time', y: 'Survival probability' }}
      caption={
        <span className="hint">
          Kaplan–Meier estimates; ticks: censored times
          {showCi ? `; dashed: the ${Math.round(r.confidence * 100)}% pointwise interval` : ''}.
          Below: the numbers at risk.
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={KW}
          height={height}
          role="img"
          aria-label="Kaplan–Meier curves"
        >
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line className="grid-line" x1={KPAD.l} x2={KW - KPAD.r} y1={sy(v)} y2={sy(v)} />
              <text x={KPAD.l - 6} y={sy(v) + 4} textAnchor="end">
                {v.toFixed(1)}
              </text>
            </g>
          ))}
          {times.map((t) => (
            <text key={`x${t}`} x={sx(t)} y={PLOT_H - KPAD.b + 16} textAnchor="middle">
              {fmt(t, Number.isInteger(t) ? 0 : 1)}
            </text>
          ))}
          <text
            x={KPAD.l + (KW - KPAD.l - KPAD.r) / 2}
            y={PLOT_H - 6}
            textAnchor="middle"
            className="axis-title"
          >
            {labels.x}
          </text>
          <text
            transform={`translate(12 ${KPAD.t + (PLOT_H - KPAD.t - KPAD.b) / 2}) rotate(-90)`}
            textAnchor="middle"
            className="axis-title"
          >
            {labels.y}
          </text>
          {r.strata.map((s, j) => (
            <g key={s.name} style={{ stroke: seriesColor(j) }}>
              {showCi && (
                <>
                  <path
                    d={stepPath(s.time, s.lower, sx, sy)}
                    fill="none"
                    strokeDasharray="4 3"
                    strokeWidth={1}
                  />
                  <path
                    d={stepPath(s.time, s.upper, sx, sy)}
                    fill="none"
                    strokeDasharray="4 3"
                    strokeWidth={1}
                  />
                </>
              )}
              <path d={stepPath(s.time, s.surv, sx, sy)} fill="none" strokeWidth={2} />
              {s.time.map((t, i) =>
                s.nCensor[i] > 0 ? (
                  <line
                    key={`c${i}`}
                    x1={sx(t)}
                    x2={sx(t)}
                    y1={sy(s.surv[i]) - 4}
                    y2={sy(s.surv[i]) + 4}
                    strokeWidth={1.5}
                  >
                    <title>{`${s.name}: ${s.nCensor[i]} censored at ${fmt(t, 2)}`}</title>
                  </line>
                ) : null,
              )}
            </g>
          ))}
          {groups &&
            r.strata.map((s, j) => (
              <g key={`legend-${s.name}`}>
                <line
                  x1={KW - KPAD.r - 150}
                  x2={KW - KPAD.r - 136}
                  y1={KPAD.t + 10 + j * 14}
                  y2={KPAD.t + 10 + j * 14}
                  style={{ stroke: seriesColor(j), strokeWidth: 2 }}
                />
                <text x={KW - KPAD.r - 132} y={KPAD.t + 14 + j * 14}>
                  {s.name}
                </text>
              </g>
            ))}
          <text x={4} y={riskTop + ROW_H - 5} className="axis-title">
            At risk
          </text>
          {r.strata.map((s, j) => (
            <g key={`risk-${s.name}`}>
              <text
                x={KPAD.l - 6}
                y={riskTop + ROW_H * (j + 2) - 5}
                textAnchor="end"
                style={{ fill: seriesColor(j) }}
              >
                {groups ? s.name : 'All'}
              </text>
              {times.map((t, i) => (
                <text
                  key={`${s.name}-${t}`}
                  x={sx(t)}
                  y={riskTop + ROW_H * (j + 2) - 5}
                  textAnchor="middle"
                >
                  {s.riskAt[i] ?? ''}
                </text>
              ))}
            </g>
          ))}
        </svg>
      )}
    </ChartFrame>
  );
}

/** A median or a bound that is not reached is shown as such. */
const reached = (v: number | null) => (v === null ? 'not reached' : fmt(v, 2));

function KmView({ r, o }: { r: KmResult; o: KmOptions }) {
  const pct = `${Math.round(r.confidence * 100)}%`;
  const summary: Row[] = r.strata.map((s) => [
    c(s.name),
    c(s.n, undefined, 0),
    c(s.events, undefined, 0),
    c(s.n - s.events, undefined, 0),
    c(reached(s.median)),
    c(`[${reached(s.medianLow)}, ${reached(s.medianHigh)}]`),
  ]);
  const tests: Row[] = [];
  if (r.logrank)
    tests.push([
      c('Log-rank (ρ = 0)'),
      c(r.logrank.chisq, undefined, 3),
      c(r.logrank.df, undefined, 0),
      pCell(r.logrank.p),
    ]);
  if (r.peto)
    tests.push([
      c('Peto & Peto, Gehan–Wilcoxon (ρ = 1)'),
      c(r.peto.chisq, undefined, 3),
      c(r.peto.df, undefined, 0),
      pCell(r.peto.p),
    ]);
  const observed: Row[] = r.logrank
    ? r.strata.map((s, j) => [
        c(s.name),
        c(r.logrank!.observed[j], undefined, 0),
        c(r.logrank!.expected[j], undefined, 2),
        c(r.peto?.observed[j] ?? null, undefined, 2),
        c(r.peto?.expected[j] ?? null, undefined, 2),
      ])
    : [];
  const where = r.engine.desktop ? ` in desktop ${r.engine.desktop}` : '';
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        N = {r.n} (rows with a missing time, status or group left out). survival {r.engine.version}
        {where}.
      </p>
      <Table
        title="Median survival"
        file="km-median"
        columns={['Group', 'N', 'Events', 'Censored', 'Median', `${pct} CI`]}
        rows={summary}
        note={`The median: the first time the estimate is at or below 0.5; its interval from the ${o.confType} confidence interval of the curve (survfit). “Not reached”: the curve, or its interval’s bound, never falls to 0.5.`}
      />
      {tests.length > 0 && (
        <>
          <Table
            title="Tests of equal survival"
            file="km-tests"
            columns={['Test', 'χ²', 'df', 'p']}
            rows={tests}
            note="survival::survdiff: the log-rank test weights every event time alike; Peto & Peto’s modification of the Gehan–Wilcoxon test weights each by the pooled survival estimate (ρ = 1), so early differences count more."
          />
          <Table
            title="Observed and expected events"
            file="km-observed"
            columns={['Group', 'Observed', 'Expected', 'Observed (ρ = 1)', 'Expected (ρ = 1)']}
            rows={observed}
            note="The expected events if survival were equal in every group; with ρ = 1 the events are weighted by the pooled survival estimate."
          />
        </>
      )}
      <KmPlot r={r} showCi={o.showCi} />
      {r.strata.map((s) => (
        <KmEstimates key={s.name} s={s} pct={pct} several={r.strata.length > 1} />
      ))}
    </div>
  );
}

/** One group's estimates at its event times. */
function KmEstimates({ s, pct, several }: { s: KmStratum; pct: string; several: boolean }) {
  const rows: Row[] = s.time
    .map((t, i) => ({ t, i }))
    .filter(({ i }) => s.nEvent[i] > 0)
    .map(({ t, i }) => [
      c(t, undefined, 2),
      c(s.nRisk[i], undefined, 0),
      c(s.nEvent[i], undefined, 0),
      c(s.surv[i]),
      c(`[${fmt(s.lower[i])}, ${fmt(s.upper[i])}]`),
    ]);
  return (
    <Table
      title={several ? `Kaplan–Meier estimates: ${s.name}` : 'Kaplan–Meier estimates'}
      file={`km-estimates-${s.name}`}
      columns={['Time', 'At risk', 'Events', 'Survival', `${pct} CI`]}
      rows={rows}
    />
  );
}

/** The bridge's input: the options with the confidence level of the settings. */
export function kmInput(o: KmOptions, ctx: Pick<AnalysisCtx, 'settings'>): KmInput {
  return {
    time: o.time,
    status: o.status,
    ...(o.statusCensored ? { statusCensored: true } : {}),
    group: o.group,
    confidence: ctx.settings.confidence,
    confType: o.confType,
    riskTimes: o.riskTimes,
  };
}

const kmColumns = (o: KmOptions) => [o.time, o.status, o.group].filter(Boolean);

export const kmAnalysis: AnalysisType<KmOptions, KmResult> = {
  id: 'km',
  title: 'Kaplan–Meier survival',
  sub: 'survival curves with intervals, median survival, risk table, log-rank and Peto tests (survival)',
  group: 'Regression and causal inference',
  cardTitle: (o) => `Kaplan–Meier${o.time ? `: ${o.time}` : ''}`,
  defaults: () => ({
    time: '',
    status: '',
    statusCensored: false,
    group: '',
    confType: 'log',
    riskTimes: [],
    showCi: true,
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          time: name(raw.time),
          status: name(raw.status),
          statusCensored: raw.statusCensored === true,
          group: name(raw.group),
          confType: oneOf(
            raw.confType,
            CONF_TYPES.map(([id]) => id),
            'log',
          ),
          riskTimes: Array.isArray(raw.riskTimes)
            ? parseRiskTimes(raw.riskTimes.filter((x) => typeof x === 'number').join(','))
            : [],
          showCi: raw.showCi !== false,
        }
      : null,
  Options: KmForm,
  View: ({ result, options }) => <KmView r={result} o={options} />,
  display: ['showCi'],
  blocked: (o, ctx) => {
    if (!o.time || !o.status) return 'Choose the time and status columns.';
    if (o.time === o.status || (o.group && (o.group === o.time || o.group === o.status)))
      return 'The time, status and group columns must differ.';
    return missingColumns(ctx, kmColumns(o), 'Kaplan–Meier');
  },
  fingerprint: (o, ctx) =>
    columnsFingerprint(ctx, kmColumns(o), [
      o.statusCensored ? 'censored' : 'event',
      o.group ? `group:${o.group}` : 'one',
      o.confType,
      o.riskTimes.join(','),
      ctx.settings.confidence,
    ]),
  run: async (o, ctx) => (await import('../rengine/km')).kmR(rawData(ctx)!, kmInput(o, ctx)),
  script: async (o, ctx) =>
    (await import('../rengine/km')).kmScriptR(rawData(ctx)!, kmInput(o, ctx)),
  summary: (o) => {
    const by = o.group ? ` by ${o.group}` : '';
    return `${o.time || '…'}, status ${o.status || '…'}${by}`;
  },
};
