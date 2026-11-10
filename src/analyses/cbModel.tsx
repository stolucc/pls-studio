// CB-SEM extras of the model on the canvas as analysis cards (lavaan): the
// Bollen-Stine bootstrap p of the chi-square test, pairwise parameter
// comparisons (AMOS's critical ratios for differences) and factor score weights.

import type { CbEstimator } from '../engine/cbsem';
import { quantileSorted } from '../engine/stats';
import { downloadText, fmt } from '../format';
import { toSpec, validateModel } from '../model/project';
import type { BollenStineResult, CbCall, CompareParamsResult, ParamKind, ScoreMethod, ScoreWeightsResult } from '../rengine/cbExtras';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { factorScoresUnavailable, SaveFactorScores } from '../components/results/SaveScores';
import type { FactorScores } from '../rengine/lavaan';
import { useState } from 'react';
import { fingerprint } from './codec';
import { columnsFingerprint, isObj, rawData } from './common';
import type { AnalysisCtx, AnalysisType } from './types';

const CB_GROUP = 'CB-SEM model' as const;

/** Why the CB-SEM model on the canvas cannot be used (null when it can); raw: the analysis needs raw data. */
export function cbModelBlocked(ctx: AnalysisCtx, what: string, raw = true): string | null {
  if (ctx.settings.method !== 'cbsem') return `${what} is for CB-SEM models: switch the model to CB-SEM (Model tab).`;
  if ((ctx.settings.engine ?? 'r') !== 'r') return `${what} needs the R engine (Model settings).`;
  if (!ctx.data) return 'Import data first.';
  if (raw && !rawData(ctx)) return `${what} needs raw data, not a covariance matrix.`;
  if (!ctx.model?.constructs.length) return 'Draw a CB-SEM model first (Model tab).';
  const err = validateModel(ctx.model, ctx.data, ctx.settings).find((i) => i.level === 'error');
  return err ? `Fix the model first: ${err.message}` : null;
}

/** Fingerprint of the model, the CB settings it is fitted with and its indicator columns (or the covariance matrix). */
export function cbFingerprint(ctx: AnalysisCtx, extra: (string | number | null)[] = []): string | null {
  if (ctx.settings.method !== 'cbsem' || !ctx.model || !ctx.data) return null;
  const spec = toSpec(ctx.model);
  const cols = rawData(ctx) ? columnsFingerprint(ctx, [...new Set([...ctx.model.constructs.flatMap((k) => k.indicators), ...(spec.multigroup ? [spec.multigroup.column] : []), ...(spec.weights ? [spec.weights] : []), ...(spec.cluster ? [spec.cluster] : [])])])
    : JSON.stringify(ctx.data.moments);
  return cols && fingerprint([cols, JSON.stringify(spec), ctx.settings.estimator, ctx.settings.missing, ctx.settings.interaction, ...extra]);
}

const callOf = (ctx: AnalysisCtx): CbCall => ({ data: ctx.data!, spec: toSpec(ctx.model!), missing: ctx.settings.missing, estimator: ctx.settings.estimator as CbEstimator, interaction: ctx.settings.interaction });
const fitNote = (ctx: AnalysisCtx) => `The CB-SEM model on the canvas, estimated with ${ctx.settings.estimator} (Model settings).`;
const Hint = ({ text }: { text: string }) => <p className="hint" style={{ marginTop: 0 }}>{text}</p>;
const bootOf = (ctx: AnalysisCtx) => ({ samples: Math.max(10, Math.min(100000, Math.floor(ctx.settings.bootSamples))), seed: ctx.settings.seed });

// ---------- Bollen-Stine ----------

function BollenStineView({ r }: { r: BollenStineResult }) {
  const valid = r.valid ?? r.samples;
  return (
    <div className="tables">
      <Table title="Bollen–Stine bootstrap test of exact fit" file="bollen-stine" columns={['χ²', 'df', 'p (Bollen–Stine)', 'Bootstrap samples']}
        rows={[[c(r.chisq, undefined, 3), c(r.df, undefined, 0), pCell(r.p), c(`${valid}${valid < r.samples ? ` of ${r.samples}` : ''}`)]]}
        note={`Bollen & Stine (1992): the data are transformed so that the model holds exactly, resampled with replacement, and the model refitted; p is the share of bootstrap χ² values at least as large as the observed ${fmt(r.chisq, 2)}. Unlike the usual χ² p, it does not assume multivariate normality. ${r.engine.package} ${r.engine.version}, test = "bollen.stine".`} />
      {r.boot.length > 0 && (
        <Table title="Bootstrap χ² distribution" file="bollen-stine-quantiles" columns={['Mean', '50%', '90%', '95%', '99%', 'Observed']}
          rows={[[c(r.boot.reduce((a, b) => a + b, 0) / r.boot.length, undefined, 2), ...[0.5, 0.9, 0.95, 0.99].map((q) => c(quantile(r.boot, q), undefined, 2)), c(r.chisq, undefined, 2)]]}
          note="Quantiles of χ² over the bootstrap samples: the observed value above the 95% quantile rejects exact fit at the 5% level." />
      )}
    </div>
  );
}

/** Quantile (type 7, as R's default). */
/** Quantile of unsorted values (R's type 7): the engine's, on a sorted copy. */
export const quantile = (v: number[], q: number): number => quantileSorted([...v].sort((a, b) => a - b), q);

export const bollenStineAnalysis: AnalysisType<Record<string, never>, BollenStineResult> = {
  id: 'bollenstine', title: 'Bollen–Stine bootstrap', sub: 'p of the χ² test without assuming normality (lavaan)', group: CB_GROUP,
  fitsModel: true,
  defaults: () => ({}),
  parseOptions: (raw) => (isObj(raw) ? {} : null),
  Options: ({ ctx }) => <Hint text={`Bootstrap test of exact fit (Bollen & Stine 1992): the χ² p-value when the data are not multivariate normal. ${fitNote(ctx)} ${bootOf(ctx).samples} bootstrap samples and seed ${bootOf(ctx).seed} from the Model settings; each sample refits the model, so this takes a while.`} />,
  View: ({ result }) => <BollenStineView r={result} />,
  blocked: (_o, ctx) => cbModelBlocked(ctx, 'The Bollen–Stine bootstrap') ?? (ctx.model?.ordered?.length ? 'The Bollen–Stine bootstrap is for continuous indicators; this model has ordinal ones.' : null),
  fingerprint: (_o, ctx) => cbFingerprint(ctx, [bootOf(ctx).samples, bootOf(ctx).seed]),
  run: async (_o, ctx) => (await import('../rengine/cbExtras')).bollenStineR(callOf(ctx), bootOf(ctx)),
  script: async (_o, ctx) => (await import('../rengine/cbExtras')).bollenStineScriptR(callOf(ctx), bootOf(ctx)),
  summary: () => 'the CB-SEM model on the canvas',
};

// ---------- pairwise parameter comparisons ----------

export interface CompareParamsOptions { kinds: ParamKind[] }
const KINDS: [ParamKind, string][] = [['paths', 'Structural paths'], ['loadings', 'Loadings'], ['variances', 'Variances'], ['covariances', 'Covariances']];

function CompareParamsView({ r }: { r: CompareParamsResult }) {
  if (!r.params.length) return <div className="muted">No free parameters of the chosen kinds.</div>;
  const n = r.params.length;
  const rows: Row[] = r.params.map((p, i) => [c(`${i + 1}. ${p.label}`), c(p.est), ...Array.from({ length: n }, (_, j) => {
    const z = r.z[i]?.[j] ?? null;
    return j >= i || z === null ? c('') : { ...c(z, Math.abs(z) > 1.96 ? 'bad' : 'dim', 2), bold: Math.abs(z) > 1.96 };
  })]);
  return (
    <div className="tables">
      <Table title="Critical ratios for differences between parameters" file="parameter-comparisons" columns={['Parameter', 'Estimate', ...r.params.map((_, j) => String(j + 1))]} rows={rows}
        note="z = (row − column) / SE of the difference, from the covariance matrix of the estimates (as AMOS’s critical ratios for differences). |z| > 1.96 (bold): the two differ at the 5% level (two-sided, no correction for the number of comparisons). Unstandardised estimates: compare parameters on the same scale. Parameters held equal appear once." />
    </div>
  );
}

/** Structural paths alone: a pairwise comparison needs at least two free ones (paths held equal by a label count once). */
function tooFewPaths(o: CompareParamsOptions, ctx: AnalysisCtx): string | null {
  if (o.kinds.length !== 1 || o.kinds[0] !== 'paths' || !ctx.model) return null;
  const free = ctx.model.paths.filter((p) => p.fixed === undefined);
  const n = new Set(free.map((p) => p.label ?? p.id)).size;
  return n >= 2 ? null : `The model has ${n === 0 ? 'no free structural paths' : 'one free structural path'}: a comparison needs at least two. Draw more paths, or compare loadings, variances or covariances too.`;
}

export const compareParamsAnalysis: AnalysisType<CompareParamsOptions, CompareParamsResult> = {
  id: 'cbcompare', title: 'Parameter comparisons', sub: 'pairwise z-tests of differences between estimates (critical ratios)', group: CB_GROUP,
  fitsModel: true,
  defaults: () => ({ kinds: ['paths'] }),
  parseOptions: (raw) => (isObj(raw) ? { kinds: [...new Set((Array.isArray(raw.kinds) ? raw.kinds : []).filter((k): k is ParamKind => KINDS.some(([id]) => id === k)))] } : null),
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <Hint text={`Is one estimate larger than another? Every pair of the chosen parameters is tested. ${fitNote(ctx)}`} />
      <div className="field">
        <label>Parameters</label>
        {KINDS.map(([id, label]) => (
          <label key={id} className="check" style={{ marginBottom: 4 }}>
            <input type="checkbox" checked={o.kinds.includes(id)} onChange={(e) => set({ kinds: e.target.checked ? KINDS.map(([k]) => k).filter((k) => k === id || o.kinds.includes(k)) : o.kinds.filter((k) => k !== id) })} />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  ),
  View: ({ result }) => <CompareParamsView r={result} />,
  blocked: (o, ctx) => cbModelBlocked(ctx, 'Comparing parameters', false) ?? (o.kinds.length ? tooFewPaths(o, ctx) : 'Choose which parameters to compare.'),
  fingerprint: (_o, ctx) => cbFingerprint(ctx),
  run: async (o, ctx) => (await import('../rengine/cbExtras')).compareParamsR(callOf(ctx), o.kinds),
  script: async (o, ctx) => (await import('../rengine/cbExtras')).compareParamsScriptR(callOf(ctx), o.kinds),
  summary: (o) => o.kinds.map((k) => KINDS.find(([id]) => id === k)![1].toLowerCase()).join(', ') || 'no parameters chosen',
};

// ---------- factor scores (id 'scoreweights', its id from when the card showed the weights only) ----------

export interface ScoreWeightsOptions { method: ScoreMethod }

function ScoreWeightsTable({ r }: { r: ScoreWeightsResult }) {
  return (
    <div className="tables">
      <Table title={`Factor score weights (${r.method === 'regression' ? 'regression' : 'Bartlett'})`} file="factor-score-weights" columns={['Variable', ...r.factors]}
        rows={r.variables.map((v, j) => [c(v), ...r.factors.map((_, i) => c(r.weights[i]?.[j] ?? null, undefined, 4))])}
        note={r.method === 'regression'
          ? 'Each factor’s score is the weighted sum of the (centred) observed variables: Φ Λᵀ Σ⁻¹ from the model-implied matrices (Thurstone’s regression method; AMOS’s factor score weights; lavPredict(method = "regression")).'
          : 'Bartlett weights (Λᵀ Θ⁻¹ Λ)⁻¹ Λᵀ Θ⁻¹: unbiased factor scores (lavPredict(method = "Bartlett")).'} />
    </div>
  );
}

type ScoresTab = 'scores' | 'weights';
/** The card's result: the weights, and the scores themselves (absent in results from before the card computed them). */
export type FactorScoresCardResult = ScoreWeightsResult & { scores?: FactorScores | null; scoresUnavailable?: string | null };

const PREVIEW = 20;
/** Mean, SD, min and max of each factor's scores, and their correlations (over the scored cases).
 *  (`scores` holds one array per factor, over the scored cases in the order of `rows`: column-major, as cbScoresR returns it.) */
export function scoreSummary(s: FactorScores) {
  const n = s.rows.length;
  const col = (j: number) => (s.scores[j] ?? []).filter((v) => Number.isFinite(v));
  const stats = s.names.map((name, j) => {
    const x = col(j), m = x.reduce((a, b) => a + b, 0) / (x.length || 1);
    const sd = Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, x.length - 1));
    return { name, n: x.length, mean: m, sd, min: Math.min(...x), max: Math.max(...x) };
  });
  const cor = s.names.map((_, i) => s.names.map((__, j) => {
    const xi = s.scores[i] ?? [], xj = s.scores[j] ?? [];
    const mi = stats[i].mean, mj = stats[j].mean;
    let num = 0, di = 0, dj = 0;
    for (let k = 0; k < n; k++) { if (!Number.isFinite(xi[k]) || !Number.isFinite(xj[k])) continue; num += (xi[k] - mi) * (xj[k] - mj); di += (xi[k] - mi) ** 2; dj += (xj[k] - mj) ** 2; }
    return di && dj ? num / Math.sqrt(di * dj) : null;
  }));
  return { stats, cor };
}
/** All scores as CSV: the data row number, then one column per factor. */
export function scoresCsv(s: FactorScores): string {
  const cell = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? String(v) : '');
  return [['row', ...s.names].join(','), ...s.rows.map((row, k) => [row, ...s.names.map((_, j) => cell(s.scores[j]?.[k]))].join(','))].join('\n') + '\n';
}

function ScoresPanel({ r }: { r: FactorScoresCardResult }) {
  const s = r.scores;
  const label = r.method === 'regression' ? 'regression' : 'Bartlett';
  return (
    <div className="tables">
      {s ? (() => {
        const { stats, cor } = scoreSummary(s);
        return (
          <>
            <Table title={`Factor scores (${label}): summary`} file="factor-scores-summary" columns={['Factor', 'N', 'Mean', 'SD', 'Min', 'Max']}
              rows={stats.map((x): Row => [c(x.name), c(x.n, undefined, 0), c(x.mean), c(x.sd), c(x.min), c(x.max)])}
              note={r.method === 'regression' ? 'Regression scores shrink towards the mean: their SDs are below the factors’ and they correlate more strongly than the factors do.' : 'Bartlett scores are unbiased: their SDs exceed the factors’ (they include measurement error).'} />
            {s.names.length > 1 && <Table title="Correlations among the scores" file="factor-scores-correlations" columns={['', ...s.names]}
              rows={s.names.map((a, i): Row => [c(a), ...s.names.map((_, j) => (j > i ? c(null) : j === i ? c('—') : c(cor[i][j])))])} />}
            <Table title={`Scores of the first ${Math.min(PREVIEW, s.rows.length)} of ${s.rows.length} cases`} file="factor-scores-preview" columns={['Row', ...s.names]}
              rows={s.rows.slice(0, PREVIEW).map((row, k): Row => [c(row, undefined, 0), ...s.names.map((_, j) => c(s.scores[j]?.[k] ?? null))])}
              note={`Row: the case’s row in the data${s.rows.length < (s.rows.at(-1) ?? 0) ? '; rows left out of the analysis (missing values) have no score' : ''}.`} />
          </>
        );
      })() : <p className="muted">{r.scoresUnavailable ?? 'Run the card again to compute the scores.'}</p>}
      {/* (a row of its own below the tables) */}
      <div style={{ flexBasis: '100%', width: '100%' }}>
        {s && <div className="table-tools"><button className="btn sm" onClick={() => downloadText(`factor-scores-${label}.csv`, scoresCsv(s), 'text/csv')}>Download all scores (CSV)</button></div>}
        <h4 style={{ margin: '12px 0 6px' }}>Save to the dataset</h4>
        <SaveFactorScores initial={r.method} />
      </div>
    </div>
  );
}

/** Two tabs: the factor scores themselves (shown, downloadable, savable as data columns) and the weights that compute them. */
export function ScoreWeightsView({ r }: { r: FactorScoresCardResult }) {
  const [tab, setTab] = useState<ScoresTab>('scores');
  const tabs: [ScoresTab, string][] = [['scores', 'Scores'], ['weights', 'Weights']];
  return (
    <>
      <div className="segmented efa-tabs" role="tablist" aria-label="Factor scores">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'scores' ? <ScoresPanel r={r} /> : <ScoreWeightsTable r={r} />}
    </>
  );
}

export const scoreWeightsAnalysis: AnalysisType<ScoreWeightsOptions, FactorScoresCardResult> = {
  id: 'scoreweights', title: 'Factor scores', sub: 'the factor scores of every case (summary, table, CSV, data columns) and the weights that compute them', group: CB_GROUP,
  fitsModel: true,
  defaults: () => ({ method: 'regression' }),
  parseOptions: (raw) => (isObj(raw) ? { method: raw.method === 'Bartlett' ? 'Bartlett' : 'regression' } : null),
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <Hint text={`Factor scores of the fitted model: every case’s scores, summarised, previewed and downloadable, and savable as data columns (Scores tab: regression, Bartlett or plausible values); and the weights that turn the observed variables into the scores (Weights tab). ${fitNote(ctx)}`} />
      <div className="field">
        <label>Method</label>
        <div className="segmented">
          <button className={o.method === 'regression' ? 'on' : ''} onClick={() => set({ method: 'regression' })}>Regression</button>
          <button className={o.method === 'Bartlett' ? 'on' : ''} onClick={() => set({ method: 'Bartlett' })}>Bartlett</button>
        </div>
      </div>
    </fieldset>
  ),
  View: ({ result }) => <ScoreWeightsView r={result} />,
  blocked: (_o, ctx) => cbModelBlocked(ctx, 'Factor scores', false) ?? (ctx.model?.multigroup ? 'Factor scores are computed for one group: remove the grouping.' : null),
  fingerprint: (_o, ctx) => cbFingerprint(ctx),
  run: async (o, ctx) => {
    const call = callOf(ctx);
    const weights = await (await import('../rengine/cbExtras')).scoreWeightsR(call, o.method);
    // The scores of every case (lavPredict), with the same method; where they cannot be computed, why.
    const why = factorScoresUnavailable(rawData(ctx), ctx.settings);
    if (why) return { ...weights, scores: null, scoresUnavailable: why };
    const scores = await (await import('../rengine/lavaan')).cbScoresR(call.data, call.spec, call.missing, call.estimator, o.method);
    return { ...weights, scores, warnings: [...new Set([...weights.warnings, ...scores.warnings])] };
  },
  script: async (o, ctx) => (await import('../rengine/cbExtras')).scoreWeightsScriptR(callOf(ctx), o.method),
  summary: (o) => `${o.method === 'regression' ? 'regression' : 'Bartlett'} method`,
};
