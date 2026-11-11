// Necessary condition analysis as an analysis card (Dul 2016), on data columns
// or on the construct scores of a PLS-SEM model (Richter et al. 2020).

import type { Dataset } from '../engine/types';
import { fmt } from '../format';
import { bottleneckText, type NcaCondition, type NcaOutlier, type NcaResult } from '../rengine/nca';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { fingerprint } from './codec';
import type { AnalysisCtx, AnalysisType } from './types';

export type NcaPreset = {
  x: string[];
  y: string;
  source?: 'data' | 'scores';
  permutations?: number;
  outliers?: boolean;
};

/** Options of the NCA card; `outliers` adds the robustness checks (NCA's nca_outliers). */
export interface NcaOptions {
  source: 'data' | 'scores';
  x: string[];
  y: string;
  permutations: number;
  outliers: boolean;
}

/** Effect size labels (Dul 2016): 0–0.1 small, 0.1–0.3 medium, 0.3–0.5 large, ≥ 0.5 very large. */
export const effectLabel = (d: number) => {
  if (d < 0.1) return 'small';
  if (d < 0.3) return 'medium';
  if (d < 0.5) return 'large';
  return 'very large';
};

function CeilingPlot({ k, y }: { k: NcaCondition; y: string }) {
  const W = 360,
    H = 280,
    pad = { l: 48, r: 12, t: 12, b: 40 };
  const [x0, x1, y0, y1] = k.scope;
  const sx = (v: number) => pad.l + ((v - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((y1 - v) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
  const step = k.peers.x
    .flatMap((px, i) =>
      i === 0
        ? [`M ${sx(x0)} ${sy(k.peers.y[0])}`, `L ${sx(px)} ${sy(k.peers.y[0])}`]
        : [`L ${sx(px)} ${sy(k.peers.y[i - 1])}`, `L ${sx(px)} ${sy(k.peers.y[i])}`],
    )
    .concat(`L ${sx(x1)} ${sy(k.peers.y[k.peers.y.length - 1])}`)
    .join(' ');
  const cr =
    k.slope !== null && k.intercept !== null
      ? (() => {
          const a = k.intercept!,
            b = k.slope!;
          const xa = Math.max(x0, (y0 - a) / b),
            xb = Math.min(x1, (y1 - a) / b);
          return xa < xb ? [xa, xb].map((v) => [sx(v), sy(a + b * v)]) : null;
        })()
      : null;
  return (
    <ChartFrame id={`nca:${k.x}`} name={`nca-${k.x}`} width={W} height={H} defaults={{ x: k.x, y }}>
      {(labels) => (
        <svg
          className="mc-chart"
          width={W}
          height={H}
          role="img"
          aria-label={`Ceiling lines for ${k.x}`}
        >
          <rect
            x={pad.l}
            y={pad.t}
            width={W - pad.l - pad.r}
            height={H - pad.t - pad.b}
            fill="none"
            stroke="#cbd5e1"
          />
          {k.points.x.map((px, i) => (
            <circle
              key={i}
              cx={sx(px)}
              cy={sy(k.points.y[i])}
              r={2.6}
              fill="#64748b"
              opacity={0.6}
            />
          ))}
          <path d={step} stroke="#6d28d9" strokeWidth={1.8} fill="none" />
          {cr && (
            <line
              x1={cr[0][0]}
              y1={cr[0][1]}
              x2={cr[1][0]}
              y2={cr[1][1]}
              stroke="#d97706"
              strokeWidth={2}
              strokeDasharray="6 3"
            />
          )}
          <text x={pad.l} y={H - pad.b + 14} textAnchor="middle">
            {fmt(x0, 1)}
          </text>
          <text x={W - pad.r} y={H - pad.b + 14} textAnchor="end">
            {fmt(x1, 1)}
          </text>
          <text x={pad.l - 6} y={sy(y0) + 4} textAnchor="end">
            {fmt(y0, 1)}
          </text>
          <text x={pad.l - 6} y={sy(y1) + 4} textAnchor="end">
            {fmt(y1, 1)}
          </text>
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

const yesNo = (v: boolean) => c(v ? 'yes' : '');

/** Rows of the potential outliers of one ceiling, for all conditions. */
function outlierRows(r: NcaResult, pick: (k: NcaCondition) => NcaOutlier[]): Row[] {
  return r.conditions.flatMap((k) =>
    pick(k).map((o) => [
      c(k.x),
      c(o.case, undefined, 0),
      c(o.d),
      c(o.change),
      c(o.percent === null ? '∞' : `${fmt(o.percent, 1)}%`),
      yesNo(o.ceiling),
      yesNo(o.scope),
    ]),
  );
}

/** Effect sizes and p-values of both ceilings with all cases and without each top outlier. */
function sensitivityRows(r: NcaResult): Row[] {
  return r.conditions.flatMap((k) => {
    const all: Row = [
      c(k.x),
      c('all cases'),
      c(k.n, undefined, 0),
      c(k.ceFdh),
      pCell(k.p?.ce_fdh ?? null),
      c(k.crFdh),
      pCell(k.p?.cr_fdh ?? null),
    ];
    const without = (k.robustness?.without ?? []).map(
      (w): Row => [
        c(k.x),
        c(`without case ${w.case}`),
        c(w.n, undefined, 0),
        c(w.ceFdh),
        pCell(w.p?.ce_fdh ?? null),
        c(w.crFdh),
        pCell(w.p?.cr_fdh ?? null),
      ],
    );
    return [all, ...without];
  });
}

/** The robustness checks: effect size by ceiling technique and without potential outliers. */
function RobustnessTables({ r }: { r: NcaResult }) {
  const outlierColumns = [
    'Condition',
    'Case',
    'd without it',
    'Change',
    'Change (%)',
    'Corner point',
    'Moves scope',
  ];
  const listNote =
    'NCA’s nca_outliers (one case at a time): corner points of the ceiling and cases that ' +
    'alone define the scope, whose removal changes the effect size; largest change first. ' +
    'Cases are row numbers in the data.';
  const sensitivityNote =
    'How the effect size and its p-value depend on the ceiling technique and on the most ' +
    'influential potential outlier of each ceiling (Dul 2026, robustness checks). ' +
    (r.permutations
      ? `p from ${r.permutations} permutations of the remaining cases.`
      : 'No permutation test.');
  return (
    <>
      <Table
        title="Robustness: ceiling technique and outliers"
        file="nca-robustness"
        columns={['Condition', 'Cases', 'n', 'd (CE-FDH)', 'p', 'd (CR-FDH)', 'p']}
        rows={sensitivityRows(r)}
        note={sensitivityNote}
      />
      <Table
        title="Potential outliers (CE-FDH)"
        file="nca-outliers-ce"
        columns={outlierColumns}
        rows={outlierRows(r, (k) => k.robustness?.outliers.ceFdh ?? [])}
        note={listNote}
      />
      <Table
        title="Potential outliers (CR-FDH)"
        file="nca-outliers-cr"
        columns={outlierColumns}
        rows={outlierRows(r, (k) => k.robustness?.outliers.crFdh ?? [])}
      />
    </>
  );
}

export function NcaView({ r }: { r: NcaResult }) {
  return (
    <div className="tables">
      <Table
        title="Necessary conditions"
        file="nca-effects"
        columns={[
          'Condition',
          'n',
          'd (CE-FDH)',
          'p',
          'd (CR-FDH)',
          'p',
          'Size (CR-FDH)',
          'Accuracy (CR-FDH)',
        ]}
        rows={r.conditions.map((k) => [
          c(k.x),
          c(k.n, undefined, 0),
          c(k.ceFdh),
          pCell(k.p?.ce_fdh ?? null),
          c(k.crFdh),
          pCell(k.p?.cr_fdh ?? null),
          c(effectLabel(k.crFdh)),
          c(k.accuracy === null ? null : `${fmt(k.accuracy, 1)}%`),
        ])}
        note={`Dul (2016): X is necessary for ${r.y} in degree when there is an empty space in the upper left of the scatter. Effect size d = ceiling zone / scope (0.1 medium, 0.3 large); ${r.permutations ? `p from ${r.permutations} permutations (Dul et al. 2020; p < .05 and d ≥ 0.1 are the usual criteria)` : 'no permutation test'}. CE-FDH: step-function ceiling; CR-FDH: a regression through its corner points.`}
      />
      <div className="mc-grid">
        {r.conditions.map((k) => (
          <CeilingPlot key={k.x} k={k} y={r.y} />
        ))}
      </div>
      <div className="hint">Purple: CE-FDH ceiling; dashed amber: CR-FDH.</div>
      <Table
        title="Bottleneck table (CR-FDH)"
        file="nca-bottleneck"
        columns={[`${r.y} (% of range)`, ...r.conditions.map((k) => `${k.x} needed (%)`)]}
        rows={r.conditions[0].bottleneck.map((b, i) => [
          c(`${b.y}`),
          ...r.conditions.map((k) => c(bottleneckText(k.bottleneck[i].crFdh))),
        ])}
        note="The level of each condition needed for a level of the outcome, both as a percentage of their observed range. NN: not necessary; NA: not reached in the data."
      />
      <Table
        title="Bottleneck table (CE-FDH)"
        file="nca-bottleneck-ce"
        columns={[`${r.y} (% of range)`, ...r.conditions.map((k) => `${k.x} needed (%)`)]}
        rows={r.conditions[0].bottleneck.map((b, i) => [
          c(`${b.y}`),
          ...r.conditions.map((k) => c(bottleneckText(k.bottleneck[i].ceFdh))),
        ])}
      />
      {r.conditions.some((k) => k.robustness) && <RobustnessTables r={r} />}
    </div>
  );
}

/** The dataset the options read: data columns, or the PLS construct scores. */
function input(o: NcaOptions, ctx: AnalysisCtx): Dataset | null {
  if (o.source === 'scores')
    return ctx.pls ? { names: ctx.pls.constructs, cols: ctx.pls.scores } : null;
  return ctx.data && !(ctx.data.moments && ctx.data.cols.length === 0) ? ctx.data : null;
}

const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : null);

function NcaOptionsForm({
  options: o,
  set,
  ctx,
  disabled,
}: {
  options: NcaOptions;
  set: (o: NcaOptions) => void;
  ctx: AnalysisCtx;
  disabled: boolean;
}) {
  const ds = input(o, ctx);
  const columns = ds?.names ?? [];
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Is a condition necessary for the outcome — without it, no high outcome — even if it is not
        sufficient? NCA looks for an empty upper-left corner in the scatter (Dul 2016).
      </p>
      <div className="field">
        <label>Variables</label>
        <div className="segmented">
          <button
            className={o.source === 'data' ? 'on' : ''}
            onClick={() => set({ ...o, source: 'data' })}
          >
            Data columns
          </button>
          <button
            className={o.source === 'scores' ? 'on' : ''}
            disabled={!ctx.pls}
            onClick={() => set({ ...o, source: 'scores' })}
            title={
              ctx.pls
                ? 'The construct scores of the current PLS-SEM results (Richter et al. 2020)'
                : 'Calculate a PLS-SEM model first'
            }
          >
            PLS construct scores
          </button>
        </div>
      </div>
      {!ds ? (
        <div className="empty-results">
          {o.source === 'scores' ? 'Calculate a PLS-SEM model first.' : 'Import raw data first.'}
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="nca-y">Outcome (Y)</label>
            <select
              id="nca-y"
              className="select"
              value={o.y}
              onChange={(e) => set({ ...o, y: e.target.value })}
            >
              <option value="">Choose…</option>
              {columns
                .filter((n) => n === o.y || !o.x.includes(n))
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
          </div>
          <OrderedPicker
            label="Conditions (X)"
            columns={columns.filter((n) => n !== o.y)}
            value={o.x}
            onChange={(x) => set({ ...o, x })}
          />
          <div className="field">
            <label htmlFor="nca-perm">Permutations (0: no test)</label>
            <input
              id="nca-perm"
              className="input num"
              type="number"
              min={0}
              max={20000}
              value={o.permutations}
              onChange={(e) =>
                set({
                  ...o,
                  permutations: Math.max(
                    0,
                    Math.min(20000, Math.round(Number(e.target.value)) || 0),
                  ),
                })
              }
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={o.outliers}
              onChange={(e) => set({ ...o, outliers: e.target.checked })}
            />{' '}
            Robustness checks: potential outliers and their influence on the effect sizes
          </label>
        </>
      )}
    </fieldset>
  );
}

export const ncaAnalysis: AnalysisType<NcaOptions, NcaResult> = {
  id: 'nca',
  fitsModel: (o) => o.source === 'scores',
  title: 'Necessary condition analysis',
  sub: 'NCA: ceilings, effect sizes, bottlenecks',
  group: 'Necessary conditions',
  defaults: () => ({ source: 'data', x: [], y: '', permutations: 1000, outliers: true }),
  parseOptions: (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const x = Array.isArray(r.x)
      ? r.x
          .slice(0, 500)
          .map(str)
          .filter((v): v is string => !!v)
      : [];
    const p = Number(r.permutations);
    return {
      source: r.source === 'scores' ? 'scores' : 'data',
      x: [...new Set(x)],
      y: str(r.y) ?? '',
      permutations: Number.isFinite(p) ? Math.max(0, Math.min(20000, Math.round(p))) : 1000,
      // (cards saved before the robustness checks existed keep running without them)
      outliers: r.outliers === true,
    };
  },
  Options: NcaOptionsForm,
  View: ({ result }) => <NcaView r={result} />,
  blocked: (o, ctx) => {
    const ds = input(o, ctx);
    if (!ds)
      return o.source === 'scores'
        ? 'Calculate a PLS-SEM model first: NCA runs on its construct scores.'
        : 'NCA needs raw data: import a dataset (not a covariance matrix).';
    if (!o.y) return 'Choose the outcome (Y).';
    if (!o.x.length) return 'Choose at least one condition (X).';
    const missing = [o.y, ...o.x].filter((n) => !ds.names.includes(n));
    if (missing.length)
      return `Not in the ${o.source === 'scores' ? 'construct scores' : 'data'}: ${missing.join(', ')}.`;
    if (o.x.includes(o.y)) return 'The outcome cannot also be a condition.';
    return null;
  },
  fingerprint: (o, ctx) => {
    const ds = input(o, ctx);
    if (!ds) return null;
    const cols = [o.y, ...o.x].map((n) => ds.names.indexOf(n));
    if (cols.some((k) => k < 0)) return null;
    return fingerprint([o.source, ...cols.flatMap((k) => [ds.names[k], ds.cols[k]])]);
  },
  run: async (o, ctx) => {
    const { ncaR } = await import('../rengine/nca');
    return ncaR(input(o, ctx)!, o.x, o.y, o.permutations, o.outliers);
  },
  script: async (o, ctx) => {
    const { ncaScriptR } = await import('../rengine/nca');
    return ncaScriptR(input(o, ctx)!, o.x, o.y, o.permutations, o.outliers);
  },
  summary: (o) => {
    if (!o.y) return 'not set up yet';
    const source = o.source === 'scores' ? ' (construct scores)' : '';
    const test = o.permutations ? `${o.permutations} permutations` : 'no test';
    const robust = o.outliers ? ' · robustness checks' : '';
    return `${o.x.join(', ') || '…'} → ${o.y}${source} · ${test}${robust}`;
  },
};
