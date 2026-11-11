// The mediation sensitivity card: for a conditional process model that is a simple mediation (PROCESS model 4, with
// covariates), how large a correlation rho between the mediator's and the outcome's residuals — what an unmeasured
// pre-treatment confounder of M and Y would induce — removes the indirect effect? mediation::medsens (Imai, Keele &
// Yamamoto 2010; R/sensitivity.R, ps_medsens): the ACME and ADE as functions of rho with their confidence bands, and
// the rho (and the products of R² the confounder would explain) at which each is zero.

import { ChartFrame } from '../components/ChartFrame';
import { c, Table } from '../components/results/Table';
import { SERIES_COLORS } from '../figure/palette';
import { fmt } from '../format';
import { clampStrict } from '../parse';
import { processInput } from '../process/input';
import type {
  MedsensCurve,
  MedsensInput,
  MedsensResult,
  MedsensZero,
} from '../rengine/sensitivity';
import { Axes, H, pad, W } from './charts';
import { columnsFingerprint, isObj, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface MedsensOptions {
  rhoBy: number;
  eps: number;
}
export const RHO_STEPS = [0.1, 0.05, 0.02, 0.01] as const;

/** The simple mediation of the model on the canvas, or why there is none. */
export function medsensInput(o: MedsensOptions, ctx: AnalysisCtx): MedsensInput | string {
  if (ctx.settings.method !== 'process')
    return 'Mediation sensitivity is for conditional process models: switch the model to conditional process analysis (Model tab).';
  if (!ctx.data) return 'Import data first.';
  if (!rawData(ctx)) return 'Mediation sensitivity needs raw data, not a covariance matrix.';
  if (!ctx.model?.constructs.length)
    return 'Draw a simple mediation X → M → Y first (Model tab), or pick PROCESS model 4.';
  const p = processInput(ctx.model, ctx.settings, ctx.data);
  if (!p) return 'Fix the conditional process model first (Model tab).';
  const g = p.graph;
  if (g.mediators.length !== 1 || g.moderations.length || g.threeWay.length)
    return 'Mediation sensitivity (medsens) is for a simple mediation, X → M → Y with covariates (PROCESS model 4): one mediator, no moderation.';
  if (p.categorical)
    return 'Mediation sensitivity needs a numeric X (a binary 0/1 treatment or a continuous X), not a multicategorical one.';
  if (p.binaryY)
    return 'Mediation sensitivity here is for a continuous outcome (two linear models); this Y has two values.';
  if (p.variables.some((v) => v.latent))
    return 'Mediation sensitivity uses scale means; model the variables as mean scores, not latent variables.';
  return {
    variables: p.variables,
    x: g.x,
    m: g.mediators[0],
    y: g.y,
    covariates: p.covariates,
    rhoBy: o.rhoBy,
    eps: o.eps,
    confidence: ctx.settings.confidence,
    seed: ctx.settings.seed,
  };
}

function MedsensForm({ options: o, set, disabled }: OptionsProps<MedsensOptions>) {
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Sequential ignorability says no unmeasured variable confounds the mediator and the outcome.
        This asks how large a confounder would have to be: the indirect effect (ACME) and the direct
        effect (ADE) of the simple mediation on the canvas as functions of ρ, the correlation of the
        mediator’s and the outcome’s residuals such a confounder would induce (mediation::medsens;
        Imai, Keele &amp; Yamamoto 2010). X is compared at 0 and 1.
      </p>
      <div className="field">
        <label htmlFor="ms-rho">Step of ρ</label>
        <select
          id="ms-rho"
          value={o.rhoBy}
          onChange={(e) => set({ ...o, rhoBy: Number(e.target.value) })}
        >
          {RHO_STEPS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="ms-eps">Convergence tolerance (eps)</label>
        <input
          id="ms-eps"
          className="input num"
          type="number"
          min={1e-10}
          max={0.1}
          step="any"
          value={o.eps}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v > 0 && v <= 0.1) set({ ...o, eps: v });
          }}
        />
      </div>
    </fieldset>
  );
}

/** The effect at each rho with its confidence band; dashed: where it is zero. */
function CurveChart({
  id,
  rho,
  curve,
  zero,
  label,
  level,
}: {
  id: string;
  rho: number[];
  curve: MedsensCurve;
  zero: MedsensZero;
  label: string;
  level: number;
}) {
  const ok = rho.map((_, i) => [curve.est[i], curve.lo[i], curve.hi[i]].every(Number.isFinite));
  const vals = rho.flatMap((_, i) => (ok[i] ? [curve.lo[i], curve.hi[i]] : [])).concat(0);
  if (vals.length < 2) return null;
  const ys: [number, number] = [Math.min(...vals), Math.max(...vals)];
  const xs: [number, number] = [-1, 1];
  const sx = (v: number) => pad.l + ((v - xs[0]) / (xs[1] - xs[0])) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((ys[1] - v) / (ys[1] - ys[0] || 1)) * (H - pad.t - pad.b);
  const idx = rho.map((_, i) => i).filter((i) => ok[i]);
  const band = [
    ...idx.map((i) => `${sx(rho[i])},${sy(curve.hi[i])}`),
    ...[...idx].reverse().map((i) => `${sx(rho[i])},${sy(curve.lo[i])}`),
  ].join(' ');
  const line = idx.map((i) => `${sx(rho[i])},${sy(curve.est[i])}`).join(' ');
  const col = SERIES_COLORS[0];
  return (
    <ChartFrame
      id={id}
      name={id.replace(':', '-')}
      width={W}
      height={H}
      defaults={{ x: 'Sensitivity parameter ρ', y: label }}
      caption={
        <span className="hint">
          {label} if the residuals of the mediator and outcome equations correlated ρ (solid), with
          its {Math.round(level * 100)}% confidence band; ρ = 0 is the estimate under sequential
          ignorability
          {zero.rho !== null ? `; dashed: ρ = ${fmt(zero.rho, 2)}, where it is zero` : ''}.
        </span>
      }
    >
      {(labels) => (
        <svg
          className="mc-chart data-chart"
          width={W}
          height={H}
          role="img"
          aria-label={`${label} by rho`}
        >
          <Axes xs={xs} ys={ys} xTitle={labels.x} yTitle={labels.y} />
          <polygon points={band} fill={col} fillOpacity={0.18} />
          <line className="ref-line" x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} />
          <line className="ref-line" x1={sx(0)} x2={sx(0)} y1={pad.t} y2={H - pad.b} />
          {zero.rho !== null && (
            <line
              x1={sx(zero.rho)}
              x2={sx(zero.rho)}
              y1={pad.t}
              y2={H - pad.b}
              stroke="currentColor"
              strokeDasharray="6 4"
              strokeWidth={1.2}
            />
          )}
          <polyline points={line} fill="none" stroke={col} strokeWidth={2} />
        </svg>
      )}
    </ChartFrame>
  );
}

const zeroCells = (z: MedsensZero) => [
  c(z.rho === null ? 'none in (−1, 1)' : fmt(z.rho, 2)),
  c(z.r2star),
  c(z.r2tilde),
];
/** One sentence on the breakpoint of the indirect effect. */
export function medsensText(r: MedsensResult): string {
  const at0 = r.acme.est[r.rho.findIndex((x) => Math.abs(x) < 1e-9)];
  const z = r.acmeZero;
  return z.rho === null
    ? `The indirect effect keeps its sign for every ρ in (−1, 1) on this grid.`
    : `The indirect effect (${fmt(at0, 3)} at ρ = 0) is zero at ρ = ${fmt(z.rho, 2)}: a confounder would have to explain ${fmt(100 * (z.r2star ?? NaN), 1)}% of the product of the residual variances of ${r.m} and ${r.y} (R²*_M R²*_Y = ${fmt(z.r2star, 3)}), or ${fmt(100 * (z.r2tilde ?? NaN), 1)}% of the product of their total variances (R²~_M R²~_Y = ${fmt(z.r2tilde, 3)}), with the signs of its effects such that ρ has this sign.`;
}

export function MedsensView({ r }: { r: MedsensResult }) {
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.x} → {r.m} → {r.y}
        {r.covariates.length ? `, covariates ${r.covariates.join(', ')}` : ''}; N = {r.n}{' '}
        (listwise). a = {fmt(r.a, 3)}, b = {fmt(r.b, 3)}; R² of {r.m} {fmt(r.r2m, 3)}, of {r.y}{' '}
        {fmt(r.r2y, 3)}. {medsensText(r)} mediation {r.engine.version}, rho step {r.rhoBy}.
      </p>
      <div className="charts">
        <CurveChart
          id="medsens:acme"
          rho={r.rho}
          curve={r.acme}
          zero={r.acmeZero}
          label="Indirect effect (ACME)"
          level={r.confidence}
        />
        <CurveChart
          id="medsens:ade"
          rho={r.rho}
          curve={r.ade}
          zero={r.adeZero}
          label="Direct effect (ADE)"
          level={r.confidence}
        />
      </div>
      <Table
        title="Where the effects are zero"
        file="medsens-breakpoints"
        columns={['Effect', 'ρ', 'R²*_M R²*_Y', 'R²~_M R²~_Y']}
        rows={[
          [c('Indirect effect (ACME)'), ...zeroCells(r.acmeZero)],
          [c('Direct effect (ADE)'), ...zeroCells(r.adeZero)],
        ]}
        note="ρ: the grid value where the effect changes sign (to the grid’s step). R²*: the shares of the residual variances of the mediator and the outcome an unmeasured confounder would explain; R²~: of their total variances. The larger these products, the more robust the effect."
      />
      <Table
        title="The effects by ρ"
        file="medsens-curve"
        columns={[
          'ρ',
          'ACME',
          `${Math.round(r.confidence * 100)}% CI`,
          'ADE',
          `${Math.round(r.confidence * 100)}% CI`,
          'R²*_M R²*_Y',
          'R²~_M R²~_Y',
        ]}
        rows={r.rho.map((x, i) => [
          c(fmt(x, 2)),
          c(r.acme.est[i]),
          c(`[${fmt(r.acme.lo[i])}, ${fmt(r.acme.hi[i])}]`),
          c(r.ade.est[i]),
          c(`[${fmt(r.ade.lo[i])}, ${fmt(r.ade.hi[i])}]`),
          c(r.r2starProd[i]),
          c(r.r2tildeProd[i]),
        ])}
      />
      {r.printed.length > 0 && (
        <details>
          <summary>As printed by mediation (summary)</summary>
          <pre className="r-script" style={{ whiteSpace: 'pre' }}>
            {r.printed.join('\n')}
          </pre>
        </details>
      )}
    </div>
  );
}

export const medsensAnalysis: AnalysisType<MedsensOptions, MedsensResult> = {
  id: 'medsens',
  title: 'Mediation sensitivity to a confounder (ρ)',
  sub: 'how strong an unmeasured confounder must be to remove the indirect effect (mediation::medsens)',
  group: 'Regression and causal inference',
  defaults: () => ({ rhoBy: 0.01, eps: 1e-8 }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          rhoBy: (RHO_STEPS as readonly number[]).includes(raw.rhoBy as number)
            ? (raw.rhoBy as number)
            : 0.01,
          eps: clampStrict(raw.eps, 1e-10, 0.1, 1e-8),
        }
      : null,
  Options: MedsensForm,
  View: ({ result }) => <MedsensView r={result} />,
  blocked: (o, ctx) => {
    const i = medsensInput(o, ctx);
    return typeof i === 'string' ? i : null;
  },
  fingerprint: (o, ctx) => {
    const i = medsensInput(o, ctx);
    if (typeof i === 'string') return null;
    return columnsFingerprint(
      ctx,
      [...new Set(i.variables.flatMap((v) => v.indicators))],
      [JSON.stringify([i.x, i.m, i.y, i.covariates, i.variables]), i.rhoBy, i.eps, i.confidence],
    );
  },
  run: async (o, ctx) =>
    (await import('../rengine/sensitivity')).medsensR(
      ctx.data!,
      medsensInput(o, ctx) as MedsensInput,
    ),
  script: async (o, ctx) =>
    (await import('../rengine/sensitivity')).medsensScriptR(
      ctx.data!,
      medsensInput(o, ctx) as MedsensInput,
    ),
  summary: (o) => `ρ step ${o.rhoBy}`,
};
