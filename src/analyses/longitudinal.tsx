// Longitudinal models as analysis cards: latent growth curves and the
// random-intercept cross-lagged panel model (lavaan), and growth mixture
// models (lcmm).

import { useState } from 'react';
import { fmt } from '../format';
import type { GrowthInput, GrowthResult, LongEstimate, RiclpmInput, RiclpmResult } from '../rengine/longitudinal';
import type { GmmInput, GmmModel, GmmResult } from '../rengine/mixed';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { Choice, clampNum, ColumnSelect, columnsFingerprint, flag, isObj, missingColumns, name, names, oneOf, rawData } from './common';
import type { AnalysisCtx, AnalysisType, OptionsProps } from './types';

export interface GrowthOptions { measures: string[]; times: number[]; shape: GrowthInput['shape']; covariates: string[] }
export interface RiclpmOptions { x: string[]; y: string[]; equal: boolean }
export interface GmmOptions {
  format: 'wide' | 'long'; measures: string[]; times: number[]; subject: string; time: string; outcome: string;
  covariates: string[]; shape: GmmInput['shape']; random: GmmInput['random']; to: number; nrep: number;
}
type WithInput<R, I> = R & { input: I };

const fitCards = (f: Partial<Record<'chisq' | 'df' | 'cfi' | 'rmsea' | 'srmr', number>>) => (
  <div className="stat-cards">
    {([['χ²', f.chisq, 2], ['df', f.df, 0], ['CFI', f.cfi, 3], ['RMSEA', f.rmsea, 3], ['SRMR', f.srmr, 3]] as const).map(([k, v, d]) => (
      <div className="stat-card" key={k}><div className="k">{k}</div><div className="v">{v === undefined ? '—' : fmt(v, d)}</div></div>
    ))}
  </div>
);
const estRow = (e: LongEstimate, label: string): Row => [c(label), c(e.est), c(e.se), c(e.z), pCell(e.p), c(e.std)];
const estCols = ['Parameter', 'Estimate', 'Std. error', 'z', 'p', 'Standardised'];

function GrowthView({ r }: { r: GrowthResult }) {
  const name: Record<string, string> = { i: 'Intercept', s: 'Slope', q: 'Quadratic' };
  const f = (x: string) => name[x] ?? x;
  const means = r.estimates.filter((e) => e.op === '~1');
  const vars = r.estimates.filter((e) => e.op === '~~');
  const regs = r.estimates.filter((e) => e.op === '~');
  const W = 460, H = 240, pad = { l: 56, r: 14, t: 12, b: 40 };
  const all = [...r.impliedMeans, ...r.observedMeans];
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const t0 = Math.min(...r.times), t1 = Math.max(...r.times);
  const sx = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi + 0.08 * span - v) / (span * 1.16)) * (H - pad.t - pad.b);
  return (
    <div className="tables">
      {fitCards(r.fit)}
      <Table title={regs.length ? 'Growth factors: intercepts' : 'Growth factors: means'} file="growth-means" columns={estCols} rows={means.map((e) => estRow(e, f(e.lhs)))}
        note={regs.length
          ? 'With covariates these are intercepts: the expected level (at time score 0) and change per unit of time when every covariate is 0.'
          : 'The intercept mean is the average level at time score 0; the slope mean the average change per unit of time.'} />
      <Table title="Growth factors: variances and covariances" file="growth-variances" columns={estCols}
        rows={vars.map((e) => estRow(e, e.lhs === e.rhs ? f(e.lhs) : `${f(e.lhs)} ↔ ${f(e.rhs)}`))}
        note="Variances: how much people differ in level and change; covariance: whether people who start higher change faster." />
      {regs.length > 0 && <Table title="Covariates predicting the growth factors" file="growth-covariates" columns={estCols} rows={regs.map((e) => estRow(e, `${e.rhs} → ${f(e.lhs)}`))} />}
      <ChartFrame id="growth:trajectory" name="growth-trajectory" width={W} height={H} defaults={{ x: 'Time', y: 'Mean' }}>
        {(labels) => (
          <svg className="mc-chart" width={W} height={H} role="img" aria-label="Mean trajectory">
            <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(lo)} y2={sy(lo)} />
            <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(hi)} y2={sy(hi)} />
            <text x={pad.l - 6} y={sy(lo) + 4} textAnchor="end">{fmt(lo, 2)}</text>
            <text x={pad.l - 6} y={sy(hi) + 4} textAnchor="end">{fmt(hi, 2)}</text>
            {r.times.map((t, i) => <text key={i} x={sx(t)} y={H - pad.b + 16} textAnchor="middle">{r.measures[i]}</text>)}
            <path d={r.times.map((t, i) => `${i ? 'L' : 'M'} ${sx(t)} ${sy(r.impliedMeans[i])}`).join(' ')} stroke="#6d28d9" strokeWidth={2.2} fill="none" />
            {r.times.map((t, i) => <circle key={i} cx={sx(t)} cy={sy(r.observedMeans[i])} r={4} fill="#0f9d63" />)}
            <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
            <text transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
          </svg>
        )}
      </ChartFrame>
      <div className="hint">Line: model-implied mean at each occasion; dots: observed means.</div>
    </div>
  );
}

function RiclpmView({ r, input }: { r: RiclpmResult; input: RiclpmInput }) {
  const lagged = r.estimates.filter((e) => e.op === '~');
  const lbl = (e: LongEstimate) => {
    const v = (s: string) => (s.startsWith('wx') ? `${input.x[0].replace(/\d+$/, '') || 'X'}` : `${input.y[0].replace(/\d+$/, '') || 'Y'}`);
    const wave = (s: string) => s.slice(2);
    const kind = e.lhs.slice(0, 2) === e.rhs.slice(0, 2) ? 'autoregressive' : 'cross-lagged';
    return `${v(e.rhs)}(${wave(e.rhs)}) → ${v(e.lhs)}(${wave(e.lhs)}), ${kind}`;
  };
  const between = r.estimates.filter((e) => e.op === '~~' && e.lhs.startsWith('RI'));
  return (
    <div className="tables">
      {fitCards(r.fit)}
      <Table title="Within-person lagged effects" file="riclpm-lagged" columns={estCols} rows={lagged.map((e) => estRow(e, lbl(e)))}
        note={`Effects among within-person deviations from each person's own mean (Hamaker, Kuiper & Grasman, 2015)${r.equal ? ', held equal over time' : ''}. Cross-lagged: a person above their usual level on one variable is later above (or below) their usual level on the other.`} />
      <Table title="Between-person: random intercepts" file="riclpm-between" columns={estCols}
        rows={between.map((e) => estRow(e, e.lhs === e.rhs ? `Variance of ${e.lhs}` : `${e.lhs} ↔ ${e.rhs} (standardised: correlation)`))}
        note="Stable differences between persons, separated from the within-person dynamics." />
      <Table title="RI-CLPM versus the traditional cross-lagged panel model" file="riclpm-vs-clpm" columns={['Model', 'χ²', 'df', 'CFI', 'RMSEA', 'Δχ²', 'Δdf', 'p']}
        rows={[
          [c('CLPM (no random intercepts)'), c(r.clpmFit.chisq ?? null), c(r.clpmFit.df ?? null, '', 0), c(r.clpmFit.cfi ?? null), c(r.clpmFit.rmsea ?? null), c(null), c(null), c(null)],
          [c('RI-CLPM'), c(r.fit.chisq ?? null), c(r.fit.df ?? null, '', 0), c(r.fit.cfi ?? null), c(r.fit.rmsea ?? null), c(r.comparison.chisqDiff), c(r.comparison.dfDiff, '', 0), pCell(r.comparison.p)],
        ]}
        note="A significant difference favours the random intercepts: stable between-person differences would otherwise be mistaken for lagged effects. The test is conservative (variances on the boundary)." />
    </div>
  );
}

const COLORS = ['#6d28d9', '#0f9d63', '#d97706', '#2563eb', '#db2777', '#0891b2'];

/** Best model by BIC (the usual choice for the number of classes). */
export const bestByBic = (models: GmmModel[]) => models.reduce((a, b) => (b.bic < a.bic ? b : a), models[0]);

function Trajectories({ r, m }: { r: GmmResult; m: GmmModel }) {
  const W = 480, H = 260, pad = { l: 56, r: 14, t: 12, b: 40 };
  const all = [...m.trajectories.flat(), ...(m.observed ?? []).flat().filter((v): v is number => v !== null)];
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const t0 = r.times[0], t1 = r.times[r.times.length - 1];
  const sx = (t: number) => pad.l + ((t - t0) / (t1 - t0 || 1)) * (W - pad.l - pad.r);
  const sy = (v: number) => pad.t + ((hi + 0.08 * span - v) / (span * 1.16)) * (H - pad.t - pad.b);
  return (
    <ChartFrame id="gmm:trajectories" name="growth-mixture-trajectories" width={W} height={H} defaults={{ x: 'Time', y: 'Outcome' }}>
      {(labels) => (
        <svg className="mc-chart" width={W} height={H} role="img" aria-label="Class trajectories">
          <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(lo)} y2={sy(lo)} />
          <line className="grid-line" x1={pad.l} x2={W - pad.r} y1={sy(hi)} y2={sy(hi)} />
          <text x={pad.l - 6} y={sy(lo) + 4} textAnchor="end">{fmt(lo, 2)}</text>
          <text x={pad.l - 6} y={sy(hi) + 4} textAnchor="end">{fmt(hi, 2)}</text>
          <text x={sx(t0)} y={H - pad.b + 16} textAnchor="middle">{fmt(t0, 2)}</text>
          <text x={sx(t1)} y={H - pad.b + 16} textAnchor="middle">{fmt(t1, 2)}</text>
          {m.trajectories.map((tr, k) => (
            <g key={k}>
              <path d={tr.map((v, i) => `${i ? 'L' : 'M'} ${sx(r.times[i])} ${sy(v)}`).join(' ')} stroke={COLORS[k % COLORS.length]} strokeWidth={2.2} fill="none" />
              {m.observed?.[k]?.map((v, i) => v !== null && <circle key={i} cx={sx(r.observedTimes[i])} cy={sy(v)} r={3.5} fill={COLORS[k % COLORS.length]} opacity={0.7} />)}
              <text x={W - pad.r} y={sy(tr[tr.length - 1]) - 5} textAnchor="end" fill={COLORS[k % COLORS.length]}>Class {k + 1} ({fmt(100 * m.shares[k], 0)}%)</text>
            </g>
          ))}
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
          <text transform={`translate(11 ${pad.t + (H - pad.t - pad.b) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{labels.y}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

export function GmmView({ r }: { r: GmmResult }) {
  const best = bestByBic(r.models);
  const [k, setK] = useState(best.k);
  const m = r.models.find((x) => x.k === k) ?? best;
  return (
    <div className="tables">
      <Table title="Number of classes" file="gmm-classes" columns={['Classes', 'Log-likelihood', 'Parameters', 'AIC', 'BIC', 'SABIC', 'Entropy', 'Smallest class', 'Converged']}
        rows={r.models.map((x) => [c(x.k, undefined, 0), c(x.logLik, undefined, 2), c(x.npar, undefined, 0), c(x.aic, undefined, 1), { ...c(x.bic, undefined, 1), bold: x.k === best.k },
          c(x.sabic, undefined, 1), c(x.entropy), c(`${fmt(100 * Math.min(...x.shares), 1)}%`), c(x.converged ? 'yes' : 'no')])}
        note={`${r.n} persons, ${r.observations} observations. Lower BIC is better (bold: the lowest); entropy near 1 means well-separated classes. Very small classes (under about 5%) are often not worth keeping. Each solution with two or more classes is the best of several random starts; if the best log-likelihood was found only once, run more starts.`} />
      <div className="segmented wrap" role="radiogroup" aria-label="Solution shown" style={{ alignSelf: 'flex-start' }}>
        {r.models.map((x) => <button key={x.k} role="radio" aria-checked={x.k === k} className={x.k === k ? 'on' : ''} onClick={() => setK(x.k)}>{x.k} {x.k === 1 ? 'class' : 'classes'}</button>)}
      </div>
      <Trajectories r={r} m={m} />
      <div className="hint">Lines: each class’s mean trajectory (covariates at their means); dots: observed means of the people assigned to the class{m.observed ? '' : ' (shown when there are at most 20 distinct occasions)'}.</div>
      <Table title={`Parameters, ${m.k} ${m.k === 1 ? 'class' : 'classes'}`} file={`gmm-${m.k}-parameters`} columns={['Parameter', 'Estimate', 'Std. error', 'p']}
        rows={m.params.map((p) => [c(p.name), c(p.est), c(p.se), pCell(p.p)])}
        note="Class membership: log-odds of each class relative to the last one. Then the class-specific trajectory coefficients (… class k), the covariates, the random-effect variances and covariances (varcov) and the residual standard error (stderr), in lcmm's names." />
    </div>
  );
}


const IN_TIME_ORDER = 'Click columns below in time order.';
const MISSING_NOTE: Partial<Record<string, string>> = { fiml: ', FIML', pairwise: ', pairwise deletion', twostage: ', two-stage', robusttwostage: ', robust two-stage' };
/** lavaan settings from the project: ML or MLR, and its missing-data treatment. */
const lavaanOf = (ctx: Pick<AnalysisCtx, 'settings'>) => ({ estimator: ctx.settings.estimator === 'MLR' ? 'MLR' as const : 'ML' as const, missing: ctx.settings.missing });
/** Time scores 0, 1, 2, … unless given. */
const timeScores = (measures: string[], times: number[]) => (times.length ? times : measures.map((_, i) => i));
const parseTimes = (v: unknown) => (Array.isArray(v) ? v.slice(0, 500).map(Number).filter(Number.isFinite) : []);

/** Time scores typed as text; the options keep the numbers once they are valid. */
function TimesField({ id, measures, times, onChange, hint }: { id: string; measures: string[]; times: number[]; onChange: (t: number[]) => void; hint?: string }) {
  const [text, setText] = useState(times.join(', '));
  return (
    <div className="field">
      <label htmlFor={id}>Time scores</label>
      <input id={id} className="input" value={text} placeholder={measures.map((_, i) => i).join(', ') || '0, 1, 2, 3'}
        onChange={(e) => {
          setText(e.target.value);
          const v = e.target.value.trim() ? e.target.value.split(/[,\s]+/).filter(Boolean).map(Number) : [];
          if (v.every(Number.isFinite)) onChange(v);
        }} />
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function GrowthOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<GrowthOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) return <div className="empty-results">Import raw data with repeated measures first.</div>;
  const l = lavaanOf(ctx);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <OrderedPicker label="Repeated measures (in time order)" hint={IN_TIME_ORDER} columns={columns.filter((n) => !o.covariates.includes(n))} value={o.measures} onChange={(measures) => set({ ...o, measures })} />
      <TimesField id="growth-times" measures={o.measures} times={o.times} onChange={(times) => set({ ...o, times })}
        hint="Default 0, 1, 2, …: the intercept is the level at the first occasion. Use e.g. 0, 0.5, 1, 2 for unequal spacing." />
      <Choice label="Shape" value={o.shape} onChange={(shape) => set({ ...o, shape })} options={[['linear', 'Linear'], ['quadratic', 'Quadratic'], ['basis', 'Latent basis']]}
        hint="Latent basis: the first two time scores fixed (0, 1), the others estimated, so the shape of change is free." />
      <OrderedPicker label="Covariates predicting the growth factors (optional)" columns={columns.filter((n) => !o.measures.includes(n))} value={o.covariates} onChange={(covariates) => set({ ...o, covariates })} />
      <div className="hint">lavaan {l.estimator}{MISSING_NOTE[l.missing] ?? ''} (from the Model settings).</div>
    </fieldset>
  );
}

function RiclpmOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<RiclpmOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) return <div className="empty-results">Import raw data with repeated measures first.</div>;
  const l = lavaanOf(ctx);
  return (
    <fieldset className="card-options" disabled={disabled}>
      <OrderedPicker label="Variable X at each wave" hint={IN_TIME_ORDER} columns={columns.filter((n) => !o.y.includes(n))} value={o.x} onChange={(x) => set({ ...o, x })} />
      <OrderedPicker label="Variable Y at the same waves" hint={IN_TIME_ORDER} columns={columns.filter((n) => !o.x.includes(n))} value={o.y} onChange={(y) => set({ ...o, y })} />
      <label className="check"><input type="checkbox" checked={o.equal} onChange={(e) => set({ ...o, equal: e.target.checked })} />
        <span>Hold the lagged effects equal over time<br /><span className="hint">For equally spaced waves; test it against the free model by comparing fit.</span></span></label>
      <div className="hint">lavaan {l.estimator}{MISSING_NOTE[l.missing] ?? ''} (from the Model settings).</div>
    </fieldset>
  );
}

function GmmOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<GmmOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  if (!columns.length) return <div className="empty-results">Import raw data with repeated measures first.</div>;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <Choice label="Data layout" value={o.format} onChange={(format) => set({ ...o, format })} options={[['wide', 'One column per occasion'], ['long', 'One row per occasion']]} />
      {o.format === 'wide' ? (
        <>
          <OrderedPicker label="Repeated measures (in time order)" hint={IN_TIME_ORDER} columns={columns.filter((n) => !o.covariates.includes(n))} value={o.measures} onChange={(measures) => set({ ...o, measures })} />
          <TimesField id="gmm-times" measures={o.measures} times={o.times} onChange={(times) => set({ ...o, times })} />
        </>
      ) : (
        <>
          <ColumnSelect id="gmm-subject" label="Person (subject id)" value={o.subject} columns={columns} exclude={[o.time, o.outcome, ...o.covariates]} onChange={(subject) => set({ ...o, subject })} />
          <ColumnSelect id="gmm-time" label="Time" value={o.time} columns={columns} exclude={[o.subject, o.outcome, ...o.covariates]} onChange={(time) => set({ ...o, time })} />
          <ColumnSelect id="gmm-outcome" label="Outcome" value={o.outcome} columns={columns} exclude={[o.subject, o.time, ...o.covariates]} onChange={(outcome) => set({ ...o, outcome })} />
        </>
      )}
      <OrderedPicker label="Covariates (optional, same effect in every class)" columns={columns.filter((n) => ![...(o.format === 'wide' ? o.measures : [o.subject, o.time, o.outcome])].includes(n))} value={o.covariates} onChange={(covariates) => set({ ...o, covariates })} />
      <Choice label="Trajectory" value={o.shape} onChange={(shape) => set({ ...o, shape })} options={[['linear', 'Linear'], ['quadratic', 'Quadratic']]} />
      <Choice label="Random effects within classes" value={o.random} onChange={(random) => set({ ...o, random })} options={[['none', 'None (LCGA)'], ['intercept', 'Intercept'], ['slope', 'Intercept + slope']]}
        hint="None: latent class growth analysis (people within a class follow its trajectory exactly). With random effects, people vary around their class’s trajectory." />
      <div className="row2">
        <div className="field"><label htmlFor="gmm-to">Classes: 1 to</label>
          <input id="gmm-to" className="input num" type="number" min={2} max={6} value={o.to} onChange={(e) => set({ ...o, to: Math.max(2, Math.min(6, Math.round(Number(e.target.value)) || 2)) })} /></div>
        <div className="field"><label htmlFor="gmm-nrep">Random starts</label>
          <input id="gmm-nrep" className="input num" type="number" min={5} max={100} value={o.nrep} onChange={(e) => set({ ...o, nrep: Math.max(5, Math.min(100, Math.round(Number(e.target.value)) || 5)) })} /></div>
      </div>
      <div className="hint">Mixture models have local optima: each solution starts from {o.nrep} random starting values (seed from the Model settings; lcmm::gridsearch). This takes a while.</div>
    </fieldset>
  );
}

export const growthInput = (o: GrowthOptions, ctx: Pick<AnalysisCtx, 'settings'>): GrowthInput => ({ ...o, times: timeScores(o.measures, o.times), ...lavaanOf(ctx) });
export const riclpmInput = (o: RiclpmOptions, ctx: Pick<AnalysisCtx, 'settings'>): RiclpmInput => ({ ...o, ...lavaanOf(ctx) });
export function gmmInput(o: GmmOptions, seed: number): GmmInput {
  const common = { shape: o.shape, random: o.random, classes: Array.from({ length: o.to }, (_, i) => i + 1), covariates: o.covariates, nrep: o.nrep, seed };
  return o.format === 'wide' ? { ...common, format: 'wide', measures: o.measures, times: timeScores(o.measures, o.times) } : { ...common, format: 'long', subject: o.subject, time: o.time, outcome: o.outcome };
}
const gmmColumns = (o: GmmOptions) => [...(o.format === 'wide' ? o.measures : [o.subject, o.time, o.outcome]), ...o.covariates];

export const growthAnalysis: AnalysisType<GrowthOptions, WithInput<GrowthResult, GrowthInput>> = {
  id: 'growth',
  title: 'Latent growth curve',
  sub: 'linear, quadratic or free change over occasions (lavaan)',
  group: 'Longitudinal',
  defaults: () => ({ measures: [], times: [], shape: 'linear', covariates: [] }),
  parseOptions: (raw) => (isObj(raw) ? { measures: names(raw.measures), times: parseTimes(raw.times), shape: oneOf(raw.shape, ['linear', 'quadratic', 'basis'] as const, 'linear'), covariates: names(raw.covariates) } : null),
  Options: GrowthOptionsForm,
  View: ({ result }) => <GrowthView r={result} />,
  blocked: (o, ctx) => {
    if (o.measures.length < 3) return 'Choose at least three repeated measures.';
    if (o.times.length && o.times.length !== o.measures.length) return 'Give one time score per measure (or none for 0, 1, 2, …).';
    return missingColumns(ctx, [...o.measures, ...o.covariates], 'A growth curve');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [...o.measures, ...o.covariates], [lavaanOf(ctx).estimator, lavaanOf(ctx).missing]),
  run: async (o, ctx) => { const input = growthInput(o, ctx); return { ...(await (await import('../rengine/longitudinal')).growthR(rawData(ctx)!, input)), input }; },
  script: async (o, ctx) => (await import('../rengine/longitudinal')).growthScriptR(rawData(ctx)!, growthInput(o, ctx)),
  summary: (o) => `${o.measures.length} occasions · ${o.shape === 'basis' ? 'latent basis' : o.shape}${o.covariates.length ? ` · ${o.covariates.length} covariates` : ''}`,
};

export const riclpmAnalysis: AnalysisType<RiclpmOptions, WithInput<RiclpmResult, RiclpmInput>> = {
  id: 'riclpm',
  title: 'Random-intercept cross-lagged panel model',
  sub: 'RI-CLPM: within-person cross-lagged effects (lavaan)',
  group: 'Longitudinal',
  defaults: () => ({ x: [], y: [], equal: false }),
  parseOptions: (raw) => (isObj(raw) ? { x: names(raw.x), y: names(raw.y), equal: flag(raw.equal) } : null),
  Options: RiclpmOptionsForm,
  View: ({ result }) => <RiclpmView r={result} input={result.input} />,
  blocked: (o, ctx) => {
    if (o.x.length < 3) return 'Choose X at three or more waves.';
    if (o.x.length !== o.y.length) return 'Choose Y at the same number of waves as X.';
    return missingColumns(ctx, [...o.x, ...o.y], 'The RI-CLPM');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [...o.x, ...o.y], [lavaanOf(ctx).estimator, lavaanOf(ctx).missing]),
  run: async (o, ctx) => { const input = riclpmInput(o, ctx); return { ...(await (await import('../rengine/longitudinal')).riclpmR(rawData(ctx)!, input)), input }; },
  script: async (o, ctx) => (await import('../rengine/longitudinal')).riclpmScriptR(rawData(ctx)!, riclpmInput(o, ctx)),
  summary: (o) => `${o.x.length} waves${o.equal ? ' · equal lagged effects' : ''}`,
};

export const gmmAnalysis: AnalysisType<GmmOptions, GmmResult> = {
  id: 'gmm',
  title: 'Growth mixture model',
  sub: 'classes of trajectories, LCGA (lcmm)',
  group: 'Longitudinal',
  defaults: () => ({ format: 'wide', measures: [], times: [], subject: '', time: '', outcome: '', covariates: [], shape: 'linear', random: 'intercept', to: 3, nrep: 30 }),
  parseOptions: (raw) => (isObj(raw) ? {
    format: raw.format === 'long' ? 'long' : 'wide', measures: names(raw.measures), times: parseTimes(raw.times),
    subject: name(raw.subject), time: name(raw.time), outcome: name(raw.outcome), covariates: names(raw.covariates),
    shape: oneOf(raw.shape, ['linear', 'quadratic'] as const, 'linear'), random: oneOf(raw.random, ['none', 'intercept', 'slope'] as const, 'intercept'),
    to: clampNum(raw.to, 2, 6, 3, true), nrep: clampNum(raw.nrep, 5, 100, 30, true),
  } : null),
  Options: GmmOptionsForm,
  View: ({ result }) => <GmmView key={result.models.length + result.n} r={result} />,
  blocked: (o, ctx) => {
    if (o.format === 'wide') {
      if (o.measures.length < 3) return 'Choose at least three repeated measures.';
      if (o.times.length && o.times.length !== o.measures.length) return 'Give one time score per measure (or none for 0, 1, 2, …).';
    } else {
      if (!o.subject || !o.time || !o.outcome) return 'Choose the person, time and outcome columns.';
      if (new Set([o.subject, o.time, o.outcome]).size < 3) return 'The person, time and outcome columns must be different.';
    }
    return missingColumns(ctx, gmmColumns(o), 'A growth mixture model');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, gmmColumns(o), [ctx.settings.seed]),
  run: async (o, ctx) => (await import('../rengine/mixed')).gmmR(rawData(ctx)!, gmmInput(o, ctx.settings.seed)),
  script: async (o, ctx) => (await import('../rengine/mixed')).gmmScriptR(rawData(ctx)!, gmmInput(o, ctx.settings.seed)),
  summary: (o) => `${o.format === 'wide' ? `${o.measures.length} occasions` : `${o.outcome || '…'} by ${o.time || '…'}`} · 1–${o.to} classes · ${o.random === 'none' ? 'LCGA' : `random ${o.random}`}`,
};
