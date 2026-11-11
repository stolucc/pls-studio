// The SEMsens card: how strong would an unmeasured confounder have to be to change the CB-SEM model's paths? A phantom
// variable with paths to the chosen constructs is added to the model on the canvas, and SEMsens's ant colony
// optimisation (Leite, Shen, Marcoulides, Fisk & Harring 2022) searches its coefficients for the confounder that most
// changes the paths of interest (R/sensitivity.R, ps_semsens). Shown: each path's range over the evaluations, where its
// significance flips and with which phantom coefficients, and a chart of a path's estimate against the confounding
// strength (the product of the phantom's coefficients on the path's two ends).

import { useState } from 'react';
import { ChartFrame } from '../components/ChartFrame';
import { c, pCell, Table } from '../components/results/Table';
import { SERIES_COLORS } from '../figure/palette';
import { fmt, fmtP } from '../format';
import { type ModelState } from '../model/project';
import { clampStrict } from '../parse';
import {
  SEMSENS_OBJECTIVES,
  type SemsensArgs,
  type SemsensObjective,
  type SemsensResult,
} from '../rengine/sensitivity';
import { Axes, H, pad, W } from './charts';
import { cbCall, cbFingerprint, cbModelBlocked } from './cbModel';
import { isObj, name, NumField } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface SemsensOptions {
  /** The paths of interest, [from, to] by construct name; none: every path of the model. */
  paths: [string, string][];
  /** The constructs the phantom variable affects; none: those on the paths of interest. */
  phantoms: string[];
  optFun: SemsensObjective;
  k: number;
  ants: number;
  maxIter: number;
  bound: number;
  alpha: number;
}

export const SEMSENS_OBJECTIVE_LABEL: Record<SemsensObjective, string> = {
  1: 'Shrink the estimates (mean |β| before ÷ after)',
  2: 'Change the estimates most (SD of the change ÷ mean |β|)',
  3: 'Change the p-values most',
  4: 'Bring the p-values to the significance level (flip significance)',
};

/** The model's paths as [from, to] by construct name. */
export function modelPaths(m: ModelState | undefined): [string, string][] {
  if (!m) return [];
  const nm = new Map(m.constructs.map((k) => [k.id, k.name]));
  return m.paths.flatMap((p) =>
    nm.has(p.from) && nm.has(p.to) ? [[nm.get(p.from)!, nm.get(p.to)!] as [string, string]] : [],
  );
}
/** The paths and phantom targets a run uses: the chosen ones still in the model, or the defaults. */
export function semsensTargets(
  o: SemsensOptions,
  m: ModelState | undefined,
): { paths: [string, string][]; phantoms: string[] } {
  const all = modelPaths(m);
  const chosen = o.paths.filter(([f, t]) => all.some(([a, b]) => a === f && b === t));
  const paths = chosen.length ? chosen : all;
  const names = new Set(m?.constructs.map((k) => k.name) ?? []);
  const own = o.phantoms.filter((p) => names.has(p));
  return { paths, phantoms: own.length ? own : [...new Set(paths.flat())] };
}
const key = (p: [string, string] | { from: string; to: string }) =>
  Array.isArray(p) ? `${p[0]}→${p[1]}` : `${p.from}→${p.to}`;

function SemsensForm({ options: o, set, ctx, disabled }: OptionsProps<SemsensOptions>) {
  const all = modelPaths(ctx.model);
  const t = semsensTargets(o, ctx.model);
  const constructs = ctx.model?.constructs.map((k) => k.name) ?? [];
  const togglePath = (p: [string, string], on: boolean) => {
    const cur = t.paths.filter((q) => key(q) !== key(p));
    set({ ...o, paths: on ? [...cur, p] : cur });
  };
  const togglePhantom = (n: string, on: boolean) => {
    const cur = t.phantoms.filter((q) => q !== n);
    set({ ...o, phantoms: on ? [...cur, n] : cur });
  };
  return (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        How strong would an unmeasured confounder have to be to change the paths? A phantom variable
        (mean 0, variance 1) with paths to the chosen constructs is added to the CB-SEM model on the
        canvas, and SEMsens searches its coefficients (standardised, within ±bound) by ant colony
        optimisation for the confounder that most changes the paths of interest, refitting the model
        at each evaluation (Leite et al. 2022). Many evaluations take a while in the browser.
      </p>
      <div className="field">
        <label>Paths of interest</label>
        {all.length ? (
          all.map((p) => (
            <label key={key(p)} className="check">
              <input
                type="checkbox"
                checked={t.paths.some((q) => key(q) === key(p))}
                onChange={(e) => togglePath(p, e.target.checked)}
              />{' '}
              {p[0]} → {p[1]}
            </label>
          ))
        ) : (
          <span className="hint">Draw paths between constructs first.</span>
        )}
      </div>
      <div className="field">
        <label>The phantom variable affects (2 to 9 constructs)</label>
        {constructs.map((n) => (
          <label key={n} className="check">
            <input
              type="checkbox"
              checked={t.phantoms.includes(n)}
              onChange={(e) => togglePhantom(n, e.target.checked)}
            />{' '}
            {n}
          </label>
        ))}
      </div>
      <div className="field">
        <label htmlFor="ss-opt">Search for the confounder that</label>
        <select
          id="ss-opt"
          value={o.optFun}
          onChange={(e) => set({ ...o, optFun: Number(e.target.value) as SemsensObjective })}
        >
          {SEMSENS_OBJECTIVES.map((k) => (
            <option key={k} value={k}>
              {SEMSENS_OBJECTIVE_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="row2">
        <NumField
          id="ss-iter"
          label="Evaluations (at most)"
          value={o.maxIter}
          lo={2}
          hi={20000}
          int
          fallback={200}
          onChange={(maxIter) => set({ ...o, maxIter })}
        />
        <NumField
          id="ss-k"
          label="Archive size (k)"
          value={o.k}
          lo={2}
          hi={500}
          int
          fallback={20}
          onChange={(k) => set({ ...o, k })}
        />
      </div>
      <div className="row2">
        <NumField
          id="ss-ants"
          label="Ants per iteration"
          value={o.ants}
          lo={1}
          hi={100}
          int
          fallback={10}
          onChange={(ants) => set({ ...o, ants })}
        />
        <NumField
          id="ss-bound"
          label="Phantom coefficients within ±"
          value={o.bound}
          lo={0.05}
          hi={1}
          step={0.05}
          fallback={1}
          onChange={(bound) => set({ ...o, bound })}
        />
      </div>
      <NumField
        id="ss-alpha"
        label="Significance level"
        value={o.alpha}
        lo={0.001}
        hi={0.2}
        step={0.01}
        fallback={0.05}
        onChange={(alpha) => set({ ...o, alpha })}
      />
    </fieldset>
  );
}

/** A path's standardised estimate in each evaluation against the confounding strength (the product of the phantom's coefficients on its two ends). */
function SemsensChart({ r }: { r: SemsensResult }) {
  const interest = r.draws.path.filter((p) => r.interest.some((q) => key(q) === key(p)));
  const [sel, setSel] = useState(0);
  const p = interest[Math.min(sel, interest.length - 1)];
  if (!p) return null;
  const at = (n: string) => r.phantoms.indexOf(n);
  const [fi, ti] = [at(p.from), at(p.to)];
  const both = fi >= 0 && ti >= 0,
    one = fi >= 0 ? fi : ti;
  // The x axis: the product of the two phantom paths, the one phantom path, or the evaluation's number.
  let xs: number[];
  let xLabel: string;
  if (both) {
    xs = p.est.map((_, e) => r.draws.phantom[fi][e] * r.draws.phantom[ti][e]);
    xLabel = `Phantom → ${p.from} × phantom → ${p.to}`;
  } else if (one >= 0) {
    xs = p.est.map((_, e) => r.draws.phantom[one][e]);
    xLabel = `Phantom → ${r.phantoms[one]}`;
  } else {
    xs = p.est.map((_, e) => e + 1);
    xLabel = 'Evaluation';
  }
  const pts = xs
    .map((x, e) => ({ x, y: p.est[e], sig: p.p[e] < r.alpha }))
    .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
  const model = r.summary.find((s) => key(s) === key(p))?.values[0] ?? NaN;
  if (!pts.length) return null;
  const xr: [number, number] = [Math.min(...pts.map((d) => d.x)), Math.max(...pts.map((d) => d.x))];
  const ys = [...pts.map((d) => d.y), 0, ...(Number.isFinite(model) ? [model] : [])];
  const yr: [number, number] = [Math.min(...ys), Math.max(...ys)];
  const m = (yr[1] - yr[0]) * 0.05 || 0.05;
  const ylim: [number, number] = [yr[0] - m, yr[1] + m];
  const sx = (v: number) => pad.l + ((v - xr[0]) / (xr[1] - xr[0] || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) =>
    pad.t + ((ylim[1] - v) / (ylim[1] - ylim[0] || 1)) * (H - pad.t - pad.b);
  const [SIG, NS] = [SERIES_COLORS[0], SERIES_COLORS[1]];
  return (
    <>
      {interest.length > 1 && (
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor="ss-chart">Path in the chart</label>
          <select
            id="ss-chart"
            value={Math.min(sel, interest.length - 1)}
            onChange={(e) => setSel(Number(e.target.value))}
          >
            {interest.map((q, i) => (
              <option key={key(q)} value={i}>
                {q.from} → {q.to}
              </option>
            ))}
          </select>
        </div>
      )}
      <ChartFrame
        id={`semsens:${key(p)}`}
        name={`semsens-${p.from}-${p.to}`}
        width={W}
        height={H}
        defaults={{ x: xLabel, y: `Standardised ${p.from} → ${p.to}` }}
        caption={
          <span className="hint">
            Each point: one evaluation of the search. <span style={{ color: SIG }}>●</span> p &lt;{' '}
            {fmt(r.alpha, 3)}, <span style={{ color: NS }}>●</span> not significant; dashed: the
            model’s estimate ({fmt(model, 3)}); solid: 0.{' '}
            {both
              ? 'The horizontal axis is the confounding strength: a confounder biases the path by about the product of its coefficients on the two ends.'
              : ''}
          </span>
        }
      >
        {(labels) => (
          <svg
            className="mc-chart data-chart"
            width={W}
            height={H}
            role="img"
            aria-label={`Sensitivity of ${p.from} → ${p.to}`}
          >
            <Axes xs={xr} ys={ylim} xTitle={labels.x} yTitle={labels.y} />
            <line className="ref-line" x1={pad.l} x2={W - pad.r} y1={sy(0)} y2={sy(0)} />
            {Number.isFinite(model) && (
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={sy(model)}
                y2={sy(model)}
                stroke="currentColor"
                strokeDasharray="6 4"
                strokeWidth={1.2}
              />
            )}
            {pts.map((d, i) => (
              <circle
                key={i}
                cx={sx(d.x)}
                cy={sy(d.y)}
                r={3}
                fill={d.sig ? SIG : NS}
                fillOpacity={0.75}
              />
            ))}
          </svg>
        )}
      </ChartFrame>
    </>
  );
}

/** Whether the range of the estimates includes 0 ('—' when it is not available). */
function includesZero(lo: number, hi: number) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return '—';
  return lo < 0 && hi > 0 ? 'yes' : 'no';
}

export function SemsensView({ r }: { r: SemsensResult }) {
  const inInterest = <T extends { from: string; to: string }>(rows: T[]) =>
    rows.filter((x) => r.interest.some((q) => key(q) === key(x)));
  const summary = inInterest(r.summary),
    flips = inInterest(r.flip);
  const ph = r.phantoms;
  const phCells = (v: number[]) => ph.map((_, i) => c(Number.isFinite(v[i]) ? v[i] : null));
  return (
    <div className="tables">
      <p className="hint" style={{ marginTop: 0 }}>
        {r.evaluations} converged evaluations of {r.tried} tried (N = {r.n}): the phantom variable
        on {ph.join(', ')}, each coefficient within ±{fmt(r.bound, 2)}; objective {r.optFun} (
        {SEMSENS_OBJECTIVE_LABEL[r.optFun as SemsensObjective] ?? ''}), archive {r.k}, {r.ants}{' '}
        ants, seed {r.seed}. SEMsens {r.engine.version}, lavaan {r.engine.lavaan ?? ''}. Evaluations
        whose fit warned (e.g. a negative variance) are left out, as SEMsens does.
      </p>
      <SemsensChart r={r} />
      <Table
        title="The paths under an unmeasured confounder"
        file="semsens-paths"
        columns={['Path', 'Model β', 'p', 'Mean β', 'Minimum β', 'Maximum β', 'Sign can flip']}
        rows={summary.map((s) => {
          const [b, p, mean, lo, hi] = s.values;
          return [
            c(`${s.from} → ${s.to}`),
            c(b),
            pCell(Number.isFinite(p) ? p : null),
            c(mean),
            c(lo),
            c(hi),
            c(includesZero(lo, hi)),
          ];
        })}
        note="Standardised estimates (std.all): the model’s, and their mean, minimum and maximum over the converged evaluations (SEMsens sens.tables). A range far from the model’s estimate, or one that includes 0, means a confounder within the bound could explain the path away."
      />
      <Table
        title="Where significance flips"
        file="semsens-flip"
        columns={['Path', 'Model p', 'p under the confounder', ...ph.map((n) => `Phantom → ${n}`)]}
        rows={flips.map((f) => [
          c(`${f.from} → ${f.to}`),
          pCell(Number.isFinite(f.values[0]) ? f.values[0] : null),
          c(Number.isFinite(f.values[1]) ? fmtP(f.values[1]) : 'no flip found'),
          ...phCells(f.values.slice(2)),
        ])}
        note={`The breakpoint: for a significant path, the smallest non-significant p found and the confounder that gives it (its standardised coefficients on each construct); for a non-significant path, the largest significant p. No flip found: no confounder within ±${fmt(r.bound, 2)} the search tried changes the path’s significance at ${fmt(r.alpha, 3)}.`}
      />
      <Table
        title="The confounder at each path’s smallest and largest estimate"
        file="semsens-extremes"
        columns={['Path', 'At', ...ph.map((n) => `Phantom → ${n}`)]}
        rows={inInterest(r.atMin).flatMap((mn) => {
          const mx = r.atMax.find((x) => key(x) === key(mn));
          return [
            [c(`${mn.from} → ${mn.to}`), c('minimum β'), ...phCells(mn.values)],
            [c(''), c('maximum β'), ...phCells(mx?.values ?? [])],
          ];
        })}
      />
      <Table
        title="Phantom coefficients over the evaluations"
        file="semsens-phantom"
        columns={['Phantom →', 'Mean', 'Minimum', 'Maximum']}
        rows={r.phantom.map((p) => [
          c(p.construct),
          c(p.values[0]),
          c(p.values[1]),
          c(p.values[2]),
        ])}
        note="Standardised coefficients of the phantom variable (the sensitivity parameters) in the converged evaluations."
      />
    </div>
  );
}

export const semsensArgs = (o: SemsensOptions, ctx: AnalysisCtx): SemsensArgs => ({
  ...semsensTargets(o, ctx.model),
  optFun: o.optFun,
  k: o.k,
  ants: o.ants,
  maxIter: o.maxIter,
  bound: o.bound,
  alpha: o.alpha,
  seed: ctx.settings.seed,
});
const pairs = (v: unknown): [string, string][] =>
  Array.isArray(v)
    ? v
        .slice(0, 200)
        .flatMap((p) =>
          Array.isArray(p) && p.length === 2 && name(p[0]) && name(p[1])
            ? [[name(p[0]), name(p[1])] as [string, string]]
            : [],
        )
    : [];

export const semsensAnalysis: AnalysisType<SemsensOptions, SemsensResult> = {
  id: 'semsens',
  title: 'Sensitivity to an unmeasured confounder (SEM)',
  sub: 'phantom-variable sensitivity analysis of the paths, searched by ant colony optimisation (SEMsens)',
  group: 'CB-SEM model',
  fitsModel: true,
  defaults: () => ({
    paths: [],
    phantoms: [],
    optFun: 4,
    k: 20,
    ants: 10,
    maxIter: 200,
    bound: 1,
    alpha: 0.05,
  }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          paths: pairs(raw.paths),
          phantoms: Array.isArray(raw.phantoms)
            ? [
                ...new Set(
                  raw.phantoms
                    .slice(0, 9)
                    .map((x) => name(x))
                    .filter(Boolean),
                ),
              ]
            : [],
          optFun: (SEMSENS_OBJECTIVES as readonly number[]).includes(raw.optFun as number)
            ? (raw.optFun as SemsensObjective)
            : 4,
          k: clampStrict(raw.k, 2, 500, 20, true),
          ants: clampStrict(raw.ants, 1, 100, 10, true),
          maxIter: clampStrict(raw.maxIter, 2, 20000, 200, true),
          bound: clampStrict(raw.bound, 0.05, 1, 1),
          alpha: clampStrict(raw.alpha, 0.001, 0.2, 0.05),
        }
      : null,
  Options: SemsensForm,
  View: ({ result }) => <SemsensView r={result} />,
  blocked: (o, ctx) => {
    const what = 'Sensitivity analysis (SEMsens)';
    const b = cbModelBlocked(ctx, what, false);
    if (b) return b;
    const m = ctx.model!;
    if (m.multigroup) return `${what} is for a single group: remove the grouping.`;
    if (m.multilevel) return `${what} is not available for two-level models.`;
    if (m.moderations.length) return `${what} is not available with latent interactions.`;
    if (ctx.settings.missing === 'mi')
      return `${what} is not available with multiple imputation; use FIML or casewise deletion.`;
    const t = semsensTargets(o, m);
    if (!t.paths.length) return 'Draw at least one path between constructs.';
    if (t.phantoms.length < 2 || t.phantoms.length > 9)
      return 'The phantom variable must affect 2 to 9 constructs.';
    if (o.maxIter < o.k) return 'Allow at least as many evaluations as the archive size (k).';
    return null;
  },
  fingerprint: (o, ctx) => {
    const a = semsensArgs(o, ctx);
    return cbFingerprint(ctx, [
      a.paths.map((p) => p.join('>')).join('|'),
      a.phantoms.join('|'),
      a.optFun,
      a.k,
      a.ants,
      a.maxIter,
      a.bound,
      a.alpha,
      a.seed,
    ]);
  },
  run: async (o, ctx) =>
    (await import('../rengine/sensitivity')).semsensR(cbCall(ctx), semsensArgs(o, ctx)),
  script: async (o, ctx) =>
    (await import('../rengine/sensitivity')).semsensScriptR(cbCall(ctx), semsensArgs(o, ctx)),
  summary: (o) =>
    `objective ${o.optFun}, ${o.maxIter} evaluations${o.paths.length ? `, ${o.paths.length} path${o.paths.length === 1 ? '' : 's'}` : ''}`,
};
