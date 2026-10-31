// CB-SEM extras of the model on the canvas as analysis cards (lavaan): the
// Bollen-Stine bootstrap p of the chi-square test, pairwise parameter
// comparisons (AMOS's critical ratios for differences) and factor score weights.

import type { CbEstimator } from '../engine/cbsem';
import { quantileSorted } from '../engine/stats';
import { fmt } from '../format';
import { toSpec, validateModel } from '../model/project';
import type { BollenStineResult, CbCall, CompareParamsResult, ParamKind, ScoreMethod, ScoreWeightsResult } from '../rengine/cbExtras';
import { c, pCell, Table, type Row } from '../components/results/Table';
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
  const cols = rawData(ctx) ? columnsFingerprint(ctx, [...new Set([...ctx.model.constructs.flatMap((k) => k.indicators), ...(spec.multigroup ? [spec.multigroup.column] : []), ...(spec.weights ? [spec.weights] : [])])])
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

export const compareParamsAnalysis: AnalysisType<CompareParamsOptions, CompareParamsResult> = {
  id: 'cbcompare', title: 'Parameter comparisons', sub: 'pairwise z-tests of differences between estimates (critical ratios)', group: CB_GROUP,
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
  blocked: (o, ctx) => cbModelBlocked(ctx, 'Comparing parameters', false) ?? (o.kinds.length ? null : 'Choose which parameters to compare.'),
  fingerprint: (_o, ctx) => cbFingerprint(ctx),
  run: async (o, ctx) => (await import('../rengine/cbExtras')).compareParamsR(callOf(ctx), o.kinds),
  script: async (o, ctx) => (await import('../rengine/cbExtras')).compareParamsScriptR(callOf(ctx), o.kinds),
  summary: (o) => o.kinds.map((k) => KINDS.find(([id]) => id === k)![1].toLowerCase()).join(', ') || 'no parameters chosen',
};

// ---------- factor score weights ----------

export interface ScoreWeightsOptions { method: ScoreMethod }

function ScoreWeightsView({ r }: { r: ScoreWeightsResult }) {
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

export const scoreWeightsAnalysis: AnalysisType<ScoreWeightsOptions, ScoreWeightsResult> = {
  id: 'scoreweights', title: 'Factor score weights', sub: 'how each factor score is computed from the observed variables', group: CB_GROUP,
  defaults: () => ({ method: 'regression' }),
  parseOptions: (raw) => (isObj(raw) ? { method: raw.method === 'Bartlett' ? 'Bartlett' : 'regression' } : null),
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <Hint text={`The weights that turn the observed variables into factor scores, from the fitted model. ${fitNote(ctx)}`} />
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
  blocked: (_o, ctx) => cbModelBlocked(ctx, 'Factor score weights', false) ?? (ctx.model?.multigroup ? 'Factor score weights are shown for one group: remove the grouping.' : null),
  fingerprint: (_o, ctx) => cbFingerprint(ctx),
  run: async (o, ctx) => (await import('../rengine/cbExtras')).scoreWeightsR(callOf(ctx), o.method),
  script: async (o, ctx) => (await import('../rengine/cbExtras')).scoreWeightsScriptR(callOf(ctx), o.method),
  summary: (o) => `${o.method === 'regression' ? 'regression' : 'Bartlett'} method`,
};
