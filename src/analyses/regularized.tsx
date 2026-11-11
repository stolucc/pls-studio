// Regularised SEM (lslx; Huang, Chen & Weng 2017): the CB-SEM model on the canvas with chosen parameters penalised
// (cross-loadings, structural paths, residual covariances) by the lasso, ridge, elastic net or MCP over a grid of
// penalty levels; the level chosen by BIC (or AIC), the path of the estimates over the levels, and the selected model.

import { useEffect, useState } from 'react';
import { seriesColor, OTHER_COLOR } from '../figure/palette';
import { fmt } from '../format';

import type { Delta, Penalty, RegsemRaw, RegsemRequest, TestKind } from '../rengine/search';
import { ChartFrame } from '../components/ChartFrame';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { cbCall, cbFingerprint, cbModelBlocked } from './cbModel';
import { Choice, clampNum, flag, isObj, oneOf } from './common';
import type { AnalysisCtx, AnalysisType } from './types';

export interface RegsemOptions {
  penalise: TestKind[];
  penalty: Penalty;
  selector: 'bic' | 'aic';
  deltas: Delta[];
  lambdaAuto: boolean;
  lambdaLength: number;
  lambdaFrom: number;
  lambdaTo: number;
}
export type RegsemResult = RegsemRaw;

const PENALTIES: [Penalty, string][] = [
  ['lasso', 'Lasso'],
  ['ridge', 'Ridge'],
  ['enet', 'Elastic net'],
  ['mcp', 'MCP'],
];
const KINDS: [TestKind, string][] = [
  ['loadings', 'Cross-loadings (every indicator on the other factors)'],
  ['paths', 'Structural paths'],
  ['covariances', 'Residual covariances (every pair of indicators)'],
];
const DEFAULT_DELTA: Record<Penalty, Delta[]> = { lasso: [], ridge: [], enet: [0.5], mcp: [3] };

/** δ values typed as text ("1.5, 3, Inf"): elastic net 0–1 (the lasso's share), MCP above 1 or Inf; null when invalid. */
export function parseDeltas(text: string, penalty: Penalty): Delta[] | null {
  if (penalty === 'lasso' || penalty === 'ridge') return [];
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  if (!parts.length || parts.length > 10) return null;
  const out: Delta[] = [];
  for (const p of parts) {
    if (/^inf$/i.test(p)) {
      if (penalty !== 'mcp') return null;
      out.push('Inf');
      continue;
    }
    const v = Number(p);
    if (!Number.isFinite(v) || (penalty === 'enet' ? v < 0 || v > 1 : v <= 1)) return null;
    out.push(v);
  }
  return out;
}
const deltasText = (d: Delta[]) => d.map(String).join(', ');
const deltasOf = (v: unknown, penalty: Penalty): Delta[] => {
  if (!Array.isArray(v)) return DEFAULT_DELTA[penalty];
  return (
    parseDeltas(
      v
        .slice(0, 10)
        // Anything but a number or Inf becomes 'x', which parseDeltas rejects.
        .map((x) => (x === 'Inf' || typeof x === 'number' ? String(x) : 'x'))
        .join(','),
      penalty,
    ) ?? DEFAULT_DELTA[penalty]
  );
};

const requestOf = (o: RegsemOptions): RegsemRequest => ({
  penalise: o.penalise,
  penalty: o.penalty,
  selector: o.selector,
  deltas: o.deltas,
  lambda: { auto: o.lambdaAuto, length: o.lambdaLength, from: o.lambdaFrom, to: o.lambdaTo },
});

/** The estimates' path over λ for one δ (the selected one), penalised coefficients as series. */
function PathChart({ r }: { r: RegsemResult }) {
  const levels = r.path
    .filter((l) => l.delta === r.selected.delta && l.converged)
    .sort((a, b) => a.lambda - b.lambda);
  if (levels.length < 2) return null;
  const W = 560,
    H = 300,
    pad = { l: 54, r: 12, t: 12, b: 38 };
  const xs = levels.map((l) => l.lambda),
    lo = Math.min(...xs),
    hi = Math.max(...xs);
  const vals = levels.flatMap((l) => l.values.filter((v): v is number => v !== null));
  const ymin = Math.min(0, ...vals),
    ymax = Math.max(0, ...vals),
    span = ymax - ymin || 1;
  const sx = (x: number) => pad.l + ((x - lo) / (hi - lo || 1)) * (W - pad.l - pad.r);
  const sy = (y: number) => pad.t + (1 - (y - ymin) / span) * (H - pad.t - pad.b);
  const sel = levels.findIndex((l) => Math.abs(l.lambda - r.selected.lambda) < 1e-12);
  // (the coefficients non-zero at the selected level in colour, the others grey)
  const nonzero = r.penalised.map(
    (_, j) => sel >= 0 && Math.abs(levels[sel].values[j] ?? 0) > 1e-8,
  );
  const colorOf = (j: number) => {
    const k = nonzero.slice(0, j + 1).filter(Boolean).length - 1;
    return nonzero[j] ? seriesColor(k) : OTHER_COLOR;
  };
  const yt = [ymin, (ymin + ymax) / 2, ymax];
  return (
    <ChartFrame
      id="regsem:path"
      name="regularised-path"
      width={W}
      height={H}
      defaults={{ x: 'Penalty level λ', y: 'Penalised estimate' }}
      caption={
        <>
          The penalised estimates over the penalty levels
          {r.selected.delta !== null ? ` (δ = ${r.selected.delta})` : ''}; the dashed line marks the
          level chosen by {r.selector.toUpperCase()}. Coloured: non-zero there.
        </>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart"
          width={W}
          height={H}
          role="img"
          aria-label="Path of the penalised estimates"
        >
          {yt.map((v, i) => (
            <g key={i}>
              <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(v)} y2={sy(v)} />
              <text x={pad.l - 6} y={sy(v) + 4} textAnchor="end">
                {fmt(v, 2)}
              </text>
            </g>
          ))}
          <line className="ref-line" x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} />
          {[lo, (lo + hi) / 2, hi].map((v, i) => (
            <text key={i} x={sx(v)} y={H - pad.b + 16} textAnchor="middle">
              {fmt(v, 3)}
            </text>
          ))}
          {sel >= 0 && (
            <line
              className="ref-line"
              x1={sx(levels[sel].lambda)}
              x2={sx(levels[sel].lambda)}
              y1={pad.t}
              y2={H - pad.b}
            />
          )}
          {r.penalised.map((name, j) => (
            <path
              key={j}
              d={levels
                .map((l, i) => `${i ? 'L' : 'M'} ${sx(l.lambda)} ${sy(l.values[j] ?? 0)}`)
                .join(' ')}
              stroke={colorOf(j)}
              strokeWidth={nonzero[j] ? 2 : 1.2}
              fill="none"
            >
              <title>{name}</title>
            </path>
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

function RegsemView({ r }: { r: RegsemResult }) {
  const C = r.selector.toUpperCase();
  const at = r.path.find(
    (l) => Math.abs(l.lambda - r.selected.lambda) < 1e-12 && l.delta === r.selected.delta,
  );
  const pen = r.estimates.filter((e) => e.type === 'pen');
  const kept = pen.filter((e) => e.est !== null && Math.abs(e.est) > 1e-8);
  const est = (list: typeof r.estimates): Row[] =>
    list.map((e) => [
      c(e.label),
      c(e.est, undefined, 3),
      c(e.se, undefined, 3),
      c(e.z, undefined, 2),
      pCell(e.p),
    ]);
  const fi = r.fitIndex;
  const penaltyName = PENALTIES.find(([k]) => k === r.method)![1];
  let deltaMeaning = '';
  if (r.method === 'enet') deltaMeaning = ', δ the lasso’s share';
  else if (r.method === 'mcp') deltaMeaning = ', δ the convexity';
  const lambdas = new Set(r.path.map((l) => l.lambda)).size;
  const deltas =
    r.method === 'enet' || r.method === 'mcp'
      ? ` × ${new Set(r.path.map((l) => l.delta)).size} δ`
      : '';
  const failed = r.path.filter((l) => !l.converged).length;
  const failedNote = failed
    ? ` ${failed} level(s) did not converge and are left out of the path.`
    : '';
  return (
    <>
      <div className="tables">
        <Table
          title={`Selected model (${C})`}
          file="regularised-selected"
          columns={[
            'λ',
            'δ',
            C,
            'Non-zero penalised',
            'χ²',
            'df',
            'p',
            'RMSEA',
            'CFI',
            'NNFI',
            'SRMR',
          ]}
          rows={[
            [
              c(r.selected.lambda, undefined, 4),
              c(r.selected.delta),
              c(at?.[r.selector] ?? null, undefined, 4),
              c(`${kept.length} of ${pen.length}`),
              c(r.test.chisq, undefined, 3),
              c(r.test.df, undefined, 0),
              pCell(r.test.p),
              c(fi.rmsea ?? null, undefined, 3),
              c(fi.cfi ?? null, undefined, 3),
              c(fi.nnfi ?? null, undefined, 3),
              c(fi.srmr ?? null, undefined, 3),
            ],
          ]}
          note={`lslx ${r.engine.version} (Huang, Chen & Weng 2017): the model fitted by penalised maximum likelihood (${penaltyName.toLowerCase()}${deltaMeaning}) at ${lambdas} penalty levels${deltas}; the level with the smallest ${C} (lslx’s, per observation) is chosen. χ² is the likelihood-ratio test of the selected model, its df counting only the non-zero coefficients. N = ${r.n}.${failedNote}`}
        />
        <Table
          title="Penalised parameters at the selected level"
          file="regularised-penalised"
          columns={['Parameter', 'Estimate', 'SE', 'z', 'p']}
          rows={est(pen)}
          note="A penalised parameter shrunk to exactly zero is dropped from the model (no standard error). Standard errors are lslx’s sandwich estimates for the selected model, which ignore the selection itself: read them as descriptive."
        />
        <Table
          title="Free parameters at the selected level"
          file="regularised-free"
          columns={['Parameter', 'Estimate', 'SE', 'z', 'p']}
          rows={est(r.estimates.filter((e) => e.type === 'free'))}
        />
      </div>
      <PathChart r={r} />
    </>
  );
}

function Options({
  options: o,
  set,
  ctx,
  disabled,
}: {
  options: RegsemOptions;
  set: (o: RegsemOptions) => void;
  ctx: AnalysisCtx;
  disabled: boolean;
}) {
  const [text, setText] = useState(deltasText(o.deltas));
  useEffect(() => setText(deltasText(o.deltas)), [o.deltas]);
  const deltaOk = parseDeltas(text, o.penalty) !== null;
  let deltaHint = 'One or more values, separated by commas; each is tried.';
  if (!deltaOk)
    deltaHint =
      o.penalty === 'enet'
        ? 'Values between 0 and 1, separated by commas.'
        : 'Values above 1 or Inf, separated by commas.';
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Which parameters does the model need? Penalised maximum likelihood (lslx) shrinks the chosen
        parameters towards zero, some to exactly zero, at a grid of penalty levels; the level is
        chosen by an information criterion. The CB-SEM model on the canvas ({ctx.settings.estimator}
        ; one group, continuous indicators, no labels), the penalised parameters added to it.
      </p>
      <div className="field">
        <label>Penalise</label>
        {KINDS.map(([id, label]) => (
          <label key={id} className="check" style={{ marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={o.penalise.includes(id)}
              onChange={(e) =>
                set({
                  ...o,
                  penalise: KINDS.map(([k]) => k).filter((k) =>
                    k === id ? e.target.checked : o.penalise.includes(k),
                  ),
                })
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <Choice
        label="Penalty"
        value={o.penalty}
        options={PENALTIES}
        onChange={(penalty) => set({ ...o, penalty, deltas: DEFAULT_DELTA[penalty] })}
      />
      {(o.penalty === 'enet' || o.penalty === 'mcp') && (
        <div className="field">
          <label htmlFor="rs-delta">
            {o.penalty === 'enet'
              ? 'δ: the lasso’s share (0 ridge … 1 lasso)'
              : 'δ: convexity (above 1; Inf is the lasso)'}
          </label>
          <input
            id="rs-delta"
            className="input"
            value={text}
            aria-invalid={!deltaOk}
            onChange={(e) => {
              setText(e.target.value);
              const d = parseDeltas(e.target.value, o.penalty);
              if (d) set({ ...o, deltas: d });
            }}
          />
          <div className="hint">{deltaHint}</div>
        </div>
      )}
      <Choice
        label="Choose the level by"
        value={o.selector}
        options={
          [
            ['bic', 'BIC'],
            ['aic', 'AIC'],
          ] as const
        }
        onChange={(selector) => set({ ...o, selector })}
      />
      <Choice
        label="Penalty levels"
        value={o.lambdaAuto ? 'auto' : 'range'}
        options={
          [
            ['auto', 'lslx’s grid'],
            ['range', 'From – to'],
          ] as const
        }
        onChange={(v) => set({ ...o, lambdaAuto: v === 'auto' })}
      />
      <div className="field">
        <label htmlFor="rs-len">Number of levels</label>
        <input
          id="rs-len"
          className="input"
          type="number"
          min={2}
          max={200}
          value={o.lambdaLength}
          onChange={(e) =>
            set({ ...o, lambdaLength: clampNum(e.target.value, 2, 200, o.lambdaLength, true) })
          }
        />
      </div>
      {!o.lambdaAuto && (
        <div className="field" style={{ display: 'flex', gap: 8 }}>
          <label>
            From{' '}
            <input
              className="input"
              type="number"
              min={0}
              step={0.01}
              value={o.lambdaFrom}
              aria-label="Smallest penalty level"
              onChange={(e) =>
                set({ ...o, lambdaFrom: clampNum(e.target.value, 0, 1000, o.lambdaFrom) })
              }
            />
          </label>
          <label>
            To{' '}
            <input
              className="input"
              type="number"
              min={0}
              step={0.01}
              value={o.lambdaTo}
              aria-label="Largest penalty level"
              onChange={(e) =>
                set({ ...o, lambdaTo: clampNum(e.target.value, 0, 1000, o.lambdaTo) })
              }
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}

export const regsemAnalysis: AnalysisType<RegsemOptions, RegsemResult> = {
  id: 'regsem',
  title: 'Regularised SEM',
  sub: 'lasso, ridge, elastic net or MCP on chosen parameters, the penalty level by BIC (lslx)',
  group: 'CB-SEM model',
  fitsModel: true,
  defaults: () => ({
    penalise: ['loadings'],
    penalty: 'lasso',
    selector: 'bic',
    deltas: [],
    lambdaAuto: true,
    lambdaLength: 50,
    lambdaFrom: 0.01,
    lambdaTo: 1,
  }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const penalty = oneOf(raw.penalty, ['lasso', 'ridge', 'enet', 'mcp'] as const, 'lasso');
    return {
      penalise: Array.isArray(raw.penalise)
        ? KINDS.map(([k]) => k).filter((k) => (raw.penalise as unknown[]).includes(k))
        : ['loadings'],
      penalty,
      selector: oneOf(raw.selector, ['bic', 'aic'] as const, 'bic'),
      deltas: deltasOf(raw.deltas, penalty),
      lambdaAuto: raw.lambdaAuto === undefined ? true : flag(raw.lambdaAuto),
      lambdaLength: clampNum(raw.lambdaLength, 2, 200, 50, true),
      lambdaFrom: clampNum(raw.lambdaFrom, 0, 1000, 0.01),
      lambdaTo: clampNum(raw.lambdaTo, 0, 1000, 1),
    };
  },
  Options,
  View: ({ result }) => <RegsemView r={result} />,
  blocked: (o, ctx) =>
    cbModelBlocked(ctx, 'Regularised SEM') ??
    (['ML', 'MLR'].includes(ctx.settings.estimator)
      ? null
      : 'lslx fits by maximum likelihood: choose the ML or MLR estimator (Model settings).') ??
    (['casewise', 'mean', 'fiml'].includes(ctx.settings.missing)
      ? null
      : 'Regularised SEM takes casewise deletion, mean replacement or FIML (lslx’s two-step method) for missing values.') ??
    (ctx.model?.multigroup
      ? 'Regularised SEM is available for one group here: remove the grouping.'
      : null) ??
    (ctx.model?.ordered?.length
      ? 'lslx fits continuous indicators: treat the indicators as continuous.'
      : null) ??
    (o.penalise.length ? null : 'Choose which parameters to penalise.') ??
    (o.penalise.length === 1 && o.penalise[0] === 'paths' && !ctx.model?.paths.length
      ? 'The model has no structural paths to penalise.'
      : null) ??
    (!o.lambdaAuto && !(o.lambdaTo > o.lambdaFrom)
      ? 'The largest penalty level must be above the smallest.'
      : null) ??
    ((o.penalty === 'enet' || o.penalty === 'mcp') && !o.deltas.length
      ? 'Give at least one δ.'
      : null),
  fingerprint: (o, ctx) => cbFingerprint(ctx, [JSON.stringify(requestOf(o))]),
  run: async (o, ctx) => (await import('../rengine/search')).regsemR(cbCall(ctx), requestOf(o)),
  script: async (o, ctx) =>
    (await import('../rengine/search')).regsemScriptR(cbCall(ctx), requestOf(o)),
  summary: (o) =>
    `${PENALTIES.find(([k]) => k === o.penalty)![1].toLowerCase()} on ${o.penalise.join(', ') || 'nothing'}, by ${o.selector.toUpperCase()}`,
};
