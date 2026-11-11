// Data screening as analysis cards: distributions, multivariate normality and
// outliers of chosen variables (psych), and influential cases for the CB-SEM
// model on the canvas (semfindr).

import { useState } from 'react';
import type { CbEstimator } from '../engine/cbsem';
import { fmt } from '../format';
import { toSpec, validateModel } from '../model/project';
import {
  farOut,
  flaggedCases,
  influenceSeries,
  influentialCases,
  kurtosisCases,
  mardiaVerdict,
  normalityLevel,
  type InfluenceStat,
} from '../model/screen';
import { ChartFrame } from '../components/ChartFrame';
import { IconX } from '../components/icons';
import { NEGATIVE_COLOR, POSITIVE_COLOR } from '../figure/palette';
import { Axes, H, pad, W } from './charts';
import type { InfluenceApproach, InfluenceResult, ScreenResult } from '../rengine/screen';
import { useStore } from '../store';
import { confirmDialog } from '../components/Overlays';
import { VariablePicker } from '../components/VariablePicker';
import { c, pCell, Table } from '../components/results/Table';
import { fingerprint } from './codec';
import { clampNum, columnsFingerprint, isObj, missingColumns, names, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface ScreenOptions {
  vars: string[];
  alpha: number;
}
type Tab = 'univariate' | 'normality' | 'outliers';

const ALPHAS = [0.001, 0.01, 0.05];
/** Remove cases from the dataset after confirmation (restorable from the data panel). */
async function exclude(rows: number[], reason: string) {
  const ok = await confirmDialog({
    title: `Exclude ${rows.length} case${rows.length === 1 ? '' : 's'}?`,
    body: `Rows ${rows.slice(0, 12).join(', ')}${rows.length > 12 ? ', …' : ''} are removed from the dataset for every analysis (${reason}). The data panel can restore them; they are kept with the project. Rows are renumbered afterwards.`,
    confirmLabel: 'Exclude',
    danger: true,
  });
  if (!ok) return;
  const s = useStore.getState();
  if (!s.data || !s.dataInfo) return;
  // (rows of the analysed data; with a filter they are mapped to the unfiltered data)
  const { excludeCases } = await import('../data/pipeline');
  const r = excludeCases(s.data, s.dataInfo, rows, reason);
  s.setData(r.data, r.info);
  s.toast(
    'success',
    `Excluded ${rows.length} case${rows.length === 1 ? '' : 's'}; recalculate to see the effect.`,
  );
}

/** The colour of a variable's departure from normality. */
const LEVEL_TONE: Record<ReturnType<typeof normalityLevel>, string> = {
  ok: '',
  moderate: 'warn',
  severe: 'bad',
};

function Univariate({ r }: { r: ScreenResult }) {
  return (
    <Table
      title="Distributions"
      file="screening-univariate"
      columns={['Variable', 'n', 'Missing', 'Mean', 'SD', 'Min', 'Max', 'Skewness', 'Kurtosis']}
      rows={r.variables.map((v, i) => {
        const d = r.describe[i];
        const lvl = normalityLevel(d.skew, d.kurtosis);
        const tone = LEVEL_TONE[lvl];
        return [
          c(v),
          c(d.n, undefined, 0),
          c(d.missing, d.missing ? 'warn' : 'dim', 0),
          c(d.mean),
          c(d.sd),
          c(d.min),
          c(d.max),
          c(d.skew, tone),
          c(d.kurtosis, tone),
        ];
      })}
      note="Skewness and excess kurtosis as psych::describe (type 3). |skew| > 2 or |kurtosis| > 7 is severe (red), above 1 or 3 moderate (West, Finch & Curran 1995; Kline 2016)."
    />
  );
}

function Normality({ r }: { r: ScreenResult }) {
  const m = r.mardia;
  const v = mardiaVerdict(m);
  return (
    <div className="tables">
      <Table
        title={`Mardia’s test: ${v.normal ? 'multivariate normality not rejected' : 'multivariate normality rejected'}`}
        file="screening-mardia"
        columns={['', 'Statistic', 'Test', 'df', 'p']}
        rows={[
          [
            c('Multivariate skewness b₁,ₚ'),
            c(m.b1p),
            c(m.n < 20 ? m.smallSkew : m.skew, undefined, 2),
            c(m.df, undefined, 0),
            pCell(v.skewP),
          ],
          [
            c('Multivariate kurtosis b₂,ₚ'),
            c(m.b2p),
            c(m.kurtosis, undefined, 2),
            c('z', 'dim'),
            pCell(m.pKurt),
          ],
        ]}
        note={`${m.n} complete cases, ${m.p} variables (psych::mardia). Under normality b₂,ₚ = p(p + 2) = ${m.p * (m.p + 2)}. ${v.text}${m.n < 20 ? ' Skewness: small-sample corrected test.' : ''}`}
      />
    </div>
  );
}

function Outliers({ r, alpha, current }: { r: ScreenResult; alpha: number; current: boolean }) {
  const flagged = flaggedCases(r.cases, alpha);
  const data = useStore((s) => s.data);
  const info = useStore((s) => s.dataInfo);
  const save = async () => {
    if (!data || !info) return;
    const { scoreColumns } = await import('../rengine/lavaan');
    const d = scoreColumns(
      data,
      ['mahal_d2', 'mahal_p'],
      r.cases.rows,
      [r.cases.d2, r.cases.p],
      '',
    );
    useStore.getState().setData(d, info);
    useStore
      .getState()
      .toast(
        'success',
        `Saved as data columns: ${d.names.slice(data.names.length).join(', ')}. Rows with missing values have none.`,
      );
  };
  return (
    <div className="tables">
      <Table
        title={`Multivariate outliers: ${flagged.length} of ${r.cases.rows.length} cases`}
        file="screening-outliers"
        columns={['Row', 'Mahalanobis D²', 'p']}
        rows={flagged.map((x) => [c(x.row, undefined, 0), c(x.d2, 'bad', 2), pCell(x.p)])}
        note={`Cases whose Mahalanobis distance from the centroid is significant at p < ${alpha} (χ², df = ${r.df}; Tabachnick & Fidell). Inspect them before deciding: a data-entry error, a case outside the population, or a legitimate extreme response.`}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn"
          disabled={!current}
          onClick={() => void save()}
          title="Add D² and its p for every complete case as data columns (to filter or inspect them)"
        >
          Save D² and p as data columns
        </button>
        {flagged.length > 0 && (
          <button
            className="btn danger"
            disabled={!current}
            onClick={() =>
              void exclude(
                flagged.map((x) => x.row),
                `Mahalanobis outliers, p < ${alpha}`,
              )
            }
          >
            Exclude these {flagged.length} cases…
          </button>
        )}
      </div>
    </div>
  );
}

function ScreenView({ r, alpha, current }: { r: ScreenResult; alpha: number; current: boolean }) {
  const [tab, setTab] = useState<Tab>('univariate');
  const tabs: [Tab, string][] = [
    ['univariate', 'Distributions'],
    ['normality', 'Multivariate normality'],
    ['outliers', 'Outliers'],
  ];
  return (
    <>
      <div className="segmented efa-tabs" role="tablist" aria-label="Screening results">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'on' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'univariate' ? (
        <Univariate r={r} />
      ) : tab === 'normality' ? (
        <Normality r={r} />
      ) : (
        <Outliers r={r} alpha={alpha} current={current} />
      )}
    </>
  );
}

const indicatorsOf = (ctx: AnalysisCtx) => {
  const names = rawData(ctx)?.names ?? [];
  return [...new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators))].filter((v) =>
    names.includes(v),
  );
};

function ScreenOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<ScreenOptions>) {
  const ds = rawData(ctx);
  if (!ds) return <div className="empty-results">Import raw data first.</div>;
  const indicators = indicatorsOf(ctx);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <VariablePicker
        columns={ds.names}
        value={o.vars.filter((v) => ds.names.includes(v))}
        onChange={(v) => set({ ...o, vars: ds.names.filter((x) => v.includes(x)) })}
      />
      {indicators.length >= 2 && (
        <button className="btn sm ghost" onClick={() => set({ ...o, vars: indicators })}>
          Use the model’s indicators ({indicators.length})
        </button>
      )}
      <div className="field">
        <label>Outliers at</label>
        <div className="segmented" role="radiogroup" aria-label="Outlier significance level">
          {ALPHAS.map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={o.alpha === a}
              className={o.alpha === a ? 'on' : ''}
              onClick={() => set({ ...o, alpha: a })}
            >
              p &lt; {a}
            </button>
          ))}
        </div>
      </div>
    </fieldset>
  );
}

export const screenAnalysis: AnalysisType<ScreenOptions, ScreenResult> = {
  id: 'screen',
  title: 'Data screening',
  sub: 'distributions, Mardia’s test, multivariate outliers (psych)',
  group: 'Data',
  defaults: (ctx) => ({ vars: indicatorsOf(ctx), alpha: 0.001 }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          vars: names(raw.vars, 2000),
          alpha: ALPHAS.includes(Number(raw.alpha))
            ? Number(raw.alpha)
            : clampNum(raw.alpha, 1e-6, 0.1, 0.001),
        }
      : null,
  Options: ScreenOptionsForm,
  View: ({ result, options, current }) => (
    <ScreenView r={result} alpha={options.alpha} current={current} />
  ),
  blocked: (o, ctx) =>
    o.vars.length < 2
      ? 'Choose at least two variables.'
      : missingColumns(ctx, o.vars, 'Data screening'),
  fingerprint: (o, ctx) => columnsFingerprint(ctx, o.vars),
  run: async (o, ctx) =>
    (await import('../rengine/screen')).screenR(rawData(ctx)!, o.vars, o.alpha),
  script: async (o, ctx) =>
    (await import('../rengine/screen')).screenScriptR(rawData(ctx)!, o.vars, o.alpha),
  summary: (o) => `${o.vars.length} variables · outliers at p < ${o.alpha}`,
};

// ---------- influential cases (the CB-SEM model on the canvas) ----------

function InfluenceView({ inf, current }: { inf: InfluenceResult; current: boolean }) {
  const approx = inf.approach === 'approximate';
  const top = influentialCases(inf, 15);
  const at = (row: number) => inf.rows.indexOf(row);
  const far = top.filter((x) => x.flagged);
  return (
    <div className="tables">
      {far.length > 0 && (
        <div>
          <button
            className="btn danger"
            disabled={!current}
            onClick={() =>
              void exclude(
                far.map((x) => x.row),
                'influential cases, generalized Cook’s distance far out',
              )
            }
          >
            Exclude the {far.length} far-out case{far.length === 1 ? '' : 's'}…
          </button>
        </div>
      )}
      <Table
        title="Most influential cases"
        file="screening-influence"
        columns={['Row', 'Generalized Cook’s distance', 'Mahalanobis', 'Δχ²', 'ΔCFI', 'ΔRMSEA']}
        rows={top.map((x) => [
          c(x.row, undefined, 0),
          c(x.gcd, x.flagged ? 'bad' : ''),
          c(inf.md[at(x.row)], undefined, 2),
          c(inf.chisq[at(x.row)]),
          c(inf.cfi[at(x.row)]),
          c(inf.rmsea[at(x.row)]),
        ])}
        note={`Generalized Cook’s distance (Pek & MacCallum 2011): how far the parameter estimates move without the case${approx ? ', approximated from the one fit without refitting (semfindr’s approximate approach; gcd_approx)' : ' (the model refitted without each case)'}. It has no conventional cutoff; red: far out from the other cases (above Q3 + 3 IQR = ${fmt(farOut(inf.gcd))}). Δ: fit with the case minus without it. ${inf.engine.package} ${inf.engine.version}.`}
      />
      <ExcludeOne rows={top.map((x) => x.row)} current={current} />
      <IndexPlot inf={inf} />
      {inf.kurtosis && <KurtosisCases k={inf.kurtosis} current={current} />}
    </div>
  );
}

/** Exclude one chosen case (of the most influential), after confirmation. */
function ExcludeOne({
  rows,
  current,
  reason = 'an influential case',
}: {
  rows: number[];
  current: boolean;
  reason?: string;
}) {
  const [row, setRow] = useState(rows[0] ?? 0);
  if (!rows.length) return null;
  const pick = rows.includes(row) ? row : rows[0];
  return (
    <div
      className="field"
      style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
    >
      <label htmlFor={`ex-one-${reason}`}>Exclude row</label>
      <select
        id={`ex-one-${reason}`}
        className="select"
        style={{ width: 'auto' }}
        value={pick}
        onChange={(e) => setRow(Number(e.target.value))}
      >
        {rows.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        className="btn danger sm"
        disabled={!current}
        onClick={() => void exclude([pick], reason)}
        title="Remove this case from the dataset (the data panel can restore it)"
      >
        <IconX size={13} /> Exclude…
      </button>
    </div>
  );
}

const STAT_LABEL: Record<InfluenceStat, string> = {
  gcd: 'Generalized Cook’s distance',
  md: 'Mahalanobis distance',
  chisq: 'Δχ²',
  cfi: 'ΔCFI',
  rmsea: 'ΔRMSEA',
  kurtosis: 'Contribution to Mardia’s kurtosis',
};

/** Index plot: one statistic per case against its row, the far-out fence dashed; a click on a point names the case. */
function IndexPlot({ inf }: { inf: InfluenceResult }) {
  const [stat, setStat] = useState<InfluenceStat>('gcd');
  const [picked, setPicked] = useState<number | null>(null);
  const s = influenceSeries(inf, stat);
  if (!s.rows.length) return null;
  const xs: [number, number] = [Math.min(...s.rows), Math.max(...s.rows)];
  let lo = Math.min(0, ...s.values);
  let hi = Math.max(
    ...s.values,
    s.fence !== null && Number.isFinite(s.fence) ? s.fence : -Infinity,
  );
  const m = (hi - lo || 1) * 0.05;
  lo -= stat === 'gcd' || stat === 'md' || stat === 'kurtosis' ? 0 : m;
  hi += m;
  const sx = (v: number) => pad.l + ((v - xs[0]) / (xs[1] - xs[0] || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi - v) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const far = (v: number) => s.fence !== null && v > s.fence;
  const at = picked === null ? -1 : s.rows.indexOf(picked);
  const stats = (Object.keys(STAT_LABEL) as InfluenceStat[]).filter(
    (k) => k !== 'kurtosis' || inf.kurtosis,
  );
  return (
    <div>
      <div className="segmented" role="radiogroup" aria-label="Statistic in the index plot">
        {stats.map((k) => (
          <button
            key={k}
            role="radio"
            aria-checked={stat === k}
            className={stat === k ? 'on' : ''}
            onClick={() => setStat(k)}
          >
            {STAT_LABEL[k]}
          </button>
        ))}
      </div>
      <ChartFrame
        id={`influence:${stat}`}
        name={`influence-index-${stat}`}
        width={W}
        height={H}
        defaults={{ x: 'Row', y: STAT_LABEL[stat] }}
        caption={
          <span className="hint">
            {at >= 0 ? `Row ${picked}: ${fmt(s.values[at], 4)}. ` : 'Click a point for its row. '}
            {s.fence !== null && Number.isFinite(s.fence)
              ? `Dashed: Q3 + 3 IQR = ${fmt(s.fence)}; red: cases above it.`
              : 'Δ: fit with the case minus without it.'}
          </span>
        }
      >
        {(labels) => (
          <svg
            className="mc-chart data-chart"
            width={W}
            height={H}
            role="img"
            aria-label={`Index plot of ${STAT_LABEL[stat]}`}
          >
            <Axes
              xs={xs}
              ys={[lo, hi]}
              xTitle={labels.x}
              yTitle={labels.y}
              xTick={(v) => v.toFixed(0)}
            />
            {s.fence !== null && Number.isFinite(s.fence) && (
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={sy(s.fence)}
                y2={sy(s.fence)}
                stroke={NEGATIVE_COLOR}
                strokeDasharray="4 3"
              />
            )}
            {s.fence === null && (
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={sy(0)}
                y2={sy(0)}
                stroke="currentColor"
                strokeOpacity={0.5}
              />
            )}
            {s.rows.map((r, i) => (
              <line
                key={`l${r}`}
                x1={sx(r)}
                x2={sx(r)}
                y1={sy(Math.max(lo, 0))}
                y2={sy(s.values[i])}
                stroke={far(s.values[i]) ? NEGATIVE_COLOR : POSITIVE_COLOR}
                strokeOpacity={0.45}
              />
            ))}
            {s.rows.map((r, i) => (
              <circle
                key={r}
                cx={sx(r)}
                cy={sy(s.values[i])}
                r={i === at ? 5 : 3}
                fill={far(s.values[i]) ? NEGATIVE_COLOR : POSITIVE_COLOR}
                style={{ cursor: 'pointer' }}
                onClick={() => setPicked(r)}
              >
                <title>{`Row ${r}: ${fmt(s.values[i], 4)}`}</title>
              </circle>
            ))}
          </svg>
        )}
      </ChartFrame>
    </div>
  );
}

/** The cases that contribute most to Mardia's multivariate kurtosis of the model's indicators. */
/** A case's share of the kurtosis against its expected share: orange above 4 times, red above 10. */
function ratioTone(ratio: number) {
  if (ratio > 10) return 'bad';
  if (ratio > 4) return 'warn';
  return '';
}

function KurtosisCases({
  k,
  current,
}: {
  k: NonNullable<InfluenceResult['kurtosis']>;
  current: boolean;
}) {
  const top = kurtosisCases(k, 10);
  return (
    <>
      <Table
        title={`Contributions to multivariate kurtosis (Mardia’s b₂,ₚ = ${fmt(k.b2p, 3)})`}
        file="screening-kurtosis-cases"
        columns={['Row', 'dᵢ⁴ / n', 'Share of b₂,ₚ', '× expected']}
        rows={top.map((x) => [
          c(x.row, undefined, 0),
          c(x.contribution, ratioTone(x.ratio), 4),
          c(`${fmt(100 * x.share, 1)}%`),
          c(x.ratio, undefined, 1),
        ])}
        note={`Mardia’s multivariate kurtosis of the ${k.p} indicators is the mean of dᵢ⁴, the squared Mahalanobis distances squared (psych::mardia: ${k.rows.length} complete cases, the sample covariance matrix); each case adds dᵢ⁴ / n. Under normality b₂,ₚ = p(p + 2) = ${k.p * (k.p + 2)}, a case’s expected share ${fmt((k.p * (k.p + 2)) / k.rows.length, 4)}. × expected: the case’s contribution over that share (orange above 4, red above 10). The Data screening card tests b₂,ₚ itself.`}
      />
      <ExcludeOne
        rows={top.map((x) => x.row)}
        current={current}
        reason="a case with a large contribution to multivariate kurtosis"
      />
    </>
  );
}

const modelIndicators = (ctx: AnalysisCtx) => [
  ...new Set((ctx.model?.constructs ?? []).flatMap((k) => k.indicators)),
];

export interface InfluenceOptions {
  approach: InfluenceApproach;
}

export const influenceAnalysis: AnalysisType<InfluenceOptions, InfluenceResult> = {
  id: 'influence',
  title: 'Influential cases',
  sub: 'case influence on the CB-SEM model: generalized Cook’s distance, fit change, index plot, contributions to Mardia’s kurtosis (semfindr)',
  group: 'Data',
  defaults: () => ({ approach: 'exact' }),
  // (cards saved before the option: the refits they ran)
  parseOptions: (raw) =>
    isObj(raw) ? { approach: raw.approach === 'approximate' ? 'approximate' : 'exact' } : null,
  Options: ({ options: o, set, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Influence of each case on the CB-SEM model on the canvas (semfindr). It uses the model,
        estimator and missing-data setting as they are when you run it.
      </p>
      <div className="segmented">
        <button
          className={o.approach === 'exact' ? 'on' : ''}
          onClick={() => set({ ...o, approach: 'exact' })}
          title="The model refitted without each case in turn: n refits, so this takes a while"
        >
          Refit without each case
        </button>
        <button
          className={o.approach === 'approximate' ? 'on' : ''}
          onClick={() => set({ ...o, approach: 'approximate' })}
          title="semfindr's approximations from the one fit (influence_stat on the lavaan fit): fast"
        >
          Approximate (one fit)
        </button>
      </div>
    </fieldset>
  ),
  View: ({ result, current }) => <InfluenceView inf={result} current={current} />,
  blocked: (_o, ctx) => {
    if (ctx.settings.method !== 'cbsem')
      return 'Influential cases are computed for CB-SEM models: switch the model to CB-SEM (Model tab).';
    if ((ctx.settings.engine ?? 'r') !== 'r')
      return 'Influential cases need the R engine (Model settings).';
    if (!rawData(ctx))
      return 'Influential cases need raw data: import a dataset (not a covariance matrix).';
    if (!ctx.model?.constructs.length) return 'Draw a CB-SEM model first (Model tab).';
    const err = validateModel(ctx.model, rawData(ctx)!, ctx.settings).find(
      (i) => i.level === 'error',
    );
    return err ? `Fix the model first: ${err.message}` : null;
  },
  fingerprint: (_o, ctx) => {
    if (ctx.settings.method !== 'cbsem' || !ctx.model || !rawData(ctx)) return null;
    const cols = columnsFingerprint(ctx, modelIndicators(ctx));
    return (
      cols &&
      fingerprint([
        cols,
        JSON.stringify(toSpec(ctx.model)),
        ctx.settings.estimator,
        ctx.settings.missing,
      ])
    );
  },
  run: async (o, ctx) =>
    (await import('../rengine/screen')).influenceR(
      rawData(ctx)!,
      toSpec(ctx.model!),
      ctx.settings.missing,
      ctx.settings.estimator as CbEstimator,
      o.approach,
    ),
  script: async (o, ctx) =>
    (await import('../rengine/screen')).influenceScriptR(
      rawData(ctx)!,
      toSpec(ctx.model!),
      ctx.settings.missing,
      ctx.settings.estimator as CbEstimator,
      o.approach,
    ),
  summary: (o) =>
    `the CB-SEM model on the canvas${o.approach === 'approximate' ? ', approximate' : ''}`,
};
