// Propensity score matching (MatchIt) and weighting (WeightIt) as an analysis
// card, with balance by cobalt.

import { useState } from 'react';
import { fmt } from '../format';
import type { MatchInput, MatchMethod, MatchResult } from '../rengine/match';
import { ChartFrame } from '../components/ChartFrame';
import { OrderedPicker } from '../components/OrderedPicker';
import { c, pCell, Table } from '../components/results/Table';
import { clampNum, ColumnSelect, columnsFingerprint, flag, isObj, missingColumns, name, names, oneOf, rawData } from './common';
import type { AnalysisType, OptionsProps } from './types';

export type MatchPreset = Partial<MatchInput>;
export type MatchOptions = Omit<MatchInput, 'seed' | 'confidence' | 'effectModel' | 'weightMethod' | 'link' | 'matchEffect'> & { effectModel: 'ipw' | 'dr'; weightMethod: 'glm' | 'ebal'; link: 'logit' | 'probit'; matchEffect: 'difference' | 'dr' };
type MatchCardResult = MatchResult & { input: MatchInput };

const METHODS: { id: MatchMethod; label: string; hint: string }[] = [
  { id: 'nearest', label: 'Nearest neighbour', hint: 'Each treated case gets its closest control(s) on the propensity score (greedy). Estimates the ATT.' },
  { id: 'optimal', label: 'Optimal pair', hint: 'Pairs that minimise the total distance (optmatch). Estimates the ATT.' },
  { id: 'full', label: 'Full matching', hint: 'Every case in a matched set with at least one treated and one control case; nothing discarded (optmatch). ATT or ATE.' },
  { id: 'subclass', label: 'Subclassification', hint: 'Strata of the propensity score; cases weighted within strata. ATT or ATE.' },
  { id: 'cem', label: 'Coarsened exact', hint: 'Exact matching on coarsened covariates (bins); unmatched cases are dropped.' },
  { id: 'exact', label: 'Exact', hint: 'Only cases with identical covariate values are matched: for few, categorical covariates.' },
  { id: 'weighting', label: 'Weighting (IPW, WeightIt)', hint: 'No matching: every case is weighted by its inverse probability of the treatment it got (propensity score by logistic regression), so the weighted groups resemble each other. ATT, ATE or ATC; nothing discarded.' },
];

/** Love plot: absolute standardised mean differences before and after matching. */
function LovePlot({ b }: { b: MatchResult['balance'] }) {
  const rows = b.filter((x) => Number.isFinite(x.diffBefore));
  const W = 460, rowH = 20, pad = { l: 150, r: 16, t: 12, b: 40 };
  const H = pad.t + pad.b + rows.length * rowH;
  const max = Math.max(0.25, ...rows.flatMap((x) => [Math.abs(x.diffBefore), Math.abs(x.diffAfter)]));
  const sx = (v: number) => pad.l + (Math.abs(v) / max) * (W - pad.l - pad.r);
  return (
    <ChartFrame id="match:love" name="love-plot" width={W} height={H} defaults={{ x: 'Absolute standardised mean difference', y: '' }}>
      {(labels) => (
        <svg className="mc-chart" width={W} height={H} role="img" aria-label="Love plot">
          <line className="grid-line" x1={sx(0.1)} x2={sx(0.1)} y1={pad.t} y2={H - pad.b} strokeDasharray="4 3" />
          <text x={sx(0.1)} y={H - pad.b + 14} textAnchor="middle">0.1</text>
          <text x={sx(0)} y={H - pad.b + 14} textAnchor="middle">0</text>
          <text x={sx(max)} y={H - pad.b + 14} textAnchor="end">{fmt(max, 2)}</text>
          {rows.map((x, i) => {
            const y = pad.t + i * rowH + rowH / 2;
            return (
              <g key={x.variable}>
                <text x={pad.l - 6} y={y + 4} textAnchor="end">{x.variable}</text>
                <line x1={sx(x.diffBefore)} x2={sx(x.diffAfter)} y1={y} y2={y} stroke="#cbd5e1" />
                <circle cx={sx(x.diffBefore)} cy={y} r={4} fill="none" stroke="#94a3b8" strokeWidth={1.6} />
                <circle cx={sx(x.diffAfter)} cy={y} r={4} fill="#6d28d9" />
              </g>
            );
          })}
          <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 4} textAnchor="middle" className="axis-title">{labels.x}</text>
        </svg>
      )}
    </ChartFrame>
  );
}

function MatchView({ r, input }: { r: MatchResult; input: MatchInput }) {
  const level = Math.round(100 * input.confidence);
  const weighting = r.method === 'weighting';
  return (
    <div className="tables">
      {weighting && r.weightMethod === 'ebal' && <div className="hint">Entropy balancing (Hainmueller 2012): weights that make the control group’s covariate means equal the treated group’s exactly.</div>}
      <Table title="Sample sizes" file="matching-counts" columns={['', 'Control', 'Treated']} rows={r.counts.map((x) => [c(x.row), c(x.control, undefined, Number.isInteger(x.control) ? 0 : 2), c(x.treated, undefined, Number.isInteger(x.treated) ? 0 : 2)])}
        note={weighting ? `Effective sample size: how many unweighted cases the weighted group is worth (Kish). Weights from ${fmt(r.weights!.controlRange[0], 3)} to ${fmt(r.weights!.controlRange[1], 3)} among controls; the largest ${fmt(r.weights!.max, 2)}. Very large weights make the estimate unstable.` : 'Matched (ESS): the effective sample size after weighting. Unmatched cases are not used.'} />
      <LovePlot b={r.balance} />
      <div className="hint">Open circles: before {weighting ? 'weighting' : 'matching'}; filled: after. Differences under 0.1 (dashed) are usually considered balanced.</div>
      <Table title="Covariate balance" file="matching-balance" columns={['Covariate', 'Type', 'Std. diff. before', 'Std. diff. after', 'Variance ratio before', 'Variance ratio after']}
        rows={r.balance.map((x) => [c(x.variable), c(x.type), c(x.diffBefore), { ...c(x.diffAfter), bold: Math.abs(x.diffAfter) >= 0.1 }, c(x.ratioBefore), c(x.ratioAfter)])}
        note="cobalt: standardised mean differences (bold: still 0.1 or more) and variance ratios (close to 1 is good) for each covariate, factor levels separately." />
      {r.effect && (
        <Table title={`Treatment effect (${r.estimand}${weighting ? `, ${r.effectModel === 'ipw' ? 'IPW' : 'doubly robust'}` : ''})`} file="matching-effect"
          columns={['Estimate', 'Std. error', weighting ? 'z' : 't', 'p', `${level}% CI low`, `${level}% CI high`, weighting ? 'n' : 'n (matched)']}
          rows={[[c(r.effect.est), c(r.effect.se), c(r.effect.t, undefined, 2), pCell(r.effect.p), c(r.effect.ciLow), c(r.effect.ciHigh), c(r.effect.n, undefined, 0)]]}
          note={weighting
            ? (r.effectModel === 'ipw'
              ? 'IPW: the weighted difference in the outcome between treated and controls (lm_weightit), with standard errors that account for estimating the weights (M-estimation; WeightIt).'
              : `Doubly robust: the weighted outcome model with the covariates and their interactions with treatment, averaged over the ${r.estimand === 'ATT' ? 'treated' : r.estimand === 'ATC' ? 'controls' : 'whole sample'} by g-computation (marginaleffects); consistent if either the propensity or the outcome model is right. Standard errors account for estimating the weights (WeightIt’s recommended approach).`)
            : r.matchEffect === 'dr'
              ? `The outcome model with the covariates and their interactions with treatment, fitted to the matched sample with the matching weights and averaged over the ${r.estimand === 'ATT' ? 'treated' : r.estimand === 'ATC' ? 'controls' : 'matched sample'} by g-computation (marginaleffects); ${input.replace ? 'HC3 robust standard errors (matching with replacement)' : 'standard errors clustered by matched set'}, as in MatchIt’s “Getting started” vignette.`
              : `Difference in the outcome between treated and controls in the matched sample, weighted by the matching weights; ${input.replace ? 'HC3 robust standard errors (matching with replacement)' : 'standard errors clustered by matched set'} (MatchIt’s recommended approach).`} />
      )}
      {r.warnings.length > 0 && <div>{r.warnings.map((w, i) => <div key={i} className="issue warning">{w}</div>)}</div>}
    </div>
  );
}


const pairsOf = (m: MatchMethod) => m === 'nearest' || m === 'optimal';

/** What R gets: settings that do not apply to the method are left at their neutral values. */
export function toInput(o: MatchOptions, seed: number, confidence: number): MatchInput {
  const pairs = pairsOf(o.method);
  return {
    treatment: o.treatment, covariates: o.covariates, outcome: o.outcome, method: o.method, distance: o.distance,
    estimand: pairs && o.estimand === 'ATE' ? 'ATT' : o.estimand, ratio: pairs ? o.ratio : 1,
    caliper: o.method === 'nearest' ? o.caliper : null, replace: o.method === 'nearest' && o.replace, seed, confidence,
    ...(o.method === 'weighting' ? { effectModel: o.effectModel, ...(o.weightMethod === 'ebal' ? { weightMethod: 'ebal' as const } : {}) } : {}),
    ...(['nearest', 'optimal', 'full', 'subclass'].includes(o.method) && o.distance === 'glm' && o.link === 'probit' ? { link: 'probit' as const } : {}),
    ...(o.method !== 'weighting' && o.matchEffect === 'dr' ? { matchEffect: 'dr' as const } : {}),
  };
}

function MatchOptionsForm({ options: o, set, ctx, disabled }: OptionsProps<MatchOptions>) {
  const columns = rawData(ctx)?.names ?? [];
  const [caliper, setCaliper] = useState(o.caliper === null ? '' : String(o.caliper));
  const m = METHODS.find((x) => x.id === o.method)!;
  const pairs = pairsOf(o.method);
  if (!columns.length) return <div className="empty-results">Import raw data first.</div>;
  return (
    <fieldset className="card-options" disabled={disabled}>
      <ColumnSelect id="match-t" label="Treatment (two values; the higher is “treated”)" value={o.treatment} columns={columns} exclude={[...o.covariates, o.outcome]} onChange={(treatment) => set({ ...o, treatment })} />
      <OrderedPicker label="Covariates (measured before treatment)" columns={columns.filter((n) => n !== o.treatment && n !== o.outcome)} value={o.covariates} onChange={(covariates) => set({ ...o, covariates })} />
      <ColumnSelect id="match-y" label="Outcome (optional: estimates the effect)" optional="None (balance only)" value={o.outcome} columns={columns} exclude={[o.treatment, ...o.covariates]} onChange={(outcome) => set({ ...o, outcome })} />
      <div className="field">
        <label htmlFor="match-m">Method</label>
        <select id="match-m" className="select" value={o.method} onChange={(e) => set({ ...o, method: e.target.value as MatchMethod })}>
          {METHODS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
        <div className="hint">{m.hint}</div>
      </div>
      {o.method === 'weighting' && (
        <div className="field">
          <label>Weights</label>
          <div className="segmented">
            <button className={o.weightMethod === 'glm' ? 'on' : ''} onClick={() => set({ ...o, weightMethod: 'glm' })} title="Inverse probability weights from a logistic propensity score">Propensity score</button>
            <button className={o.weightMethod === 'ebal' ? 'on' : ''} onClick={() => set({ ...o, weightMethod: 'ebal' })} title="Entropy balancing (Hainmueller 2012): weights that balance the covariate means exactly">Entropy balancing</button>
          </div>
        </div>
      )}
      {o.method !== 'weighting' && o.outcome && (
        <div className="field">
          <label>Effect</label>
          <div className="segmented">
            <button className={o.matchEffect === 'difference' ? 'on' : ''} onClick={() => set({ ...o, matchEffect: 'difference' })} title="The weighted difference in the outcome between treated and controls in the matched data">Difference</button>
            <button className={o.matchEffect === 'dr' ? 'on' : ''} onClick={() => set({ ...o, matchEffect: 'dr' })} title="The weighted outcome model with the covariates and their interactions with treatment, averaged by g-computation (MatchIt's vignette)">With covariates</button>
          </div>
        </div>
      )}
      {o.method === 'weighting' && (
        <div className="field">
          <label>Effect</label>
          <div className="segmented">
            <button className={o.effectModel === 'dr' ? 'on' : ''} onClick={() => set({ ...o, effectModel: 'dr' })} title="Weighted outcome model with the covariates, averaged by g-computation">Doubly robust</button>
            <button className={o.effectModel === 'ipw' ? 'on' : ''} onClick={() => set({ ...o, effectModel: 'ipw' })} title="Weighted difference between treated and controls">IPW</button>
          </div>
        </div>
      )}
      {o.method !== 'exact' && o.method !== 'cem' && o.method !== 'weighting' && (
        <div className="field">
          <label>Distance</label>
          <div className="segmented">
            <button className={o.distance === 'glm' && o.link === 'logit' ? 'on' : ''} onClick={() => set({ ...o, distance: 'glm', link: 'logit' })}>Propensity score (logit)</button>
            <button className={o.distance === 'glm' && o.link === 'probit' ? 'on' : ''} onClick={() => set({ ...o, distance: 'glm', link: 'probit' })}>Propensity score (probit)</button>
            <button className={o.distance === 'mahalanobis' ? 'on' : ''} disabled={o.method === 'subclass'} onClick={() => set({ ...o, distance: 'mahalanobis' })}>Mahalanobis</button>
          </div>
        </div>
      )}
      <div className="field">
        <label>Estimand</label>
        <div className="segmented">
          {(['ATT', 'ATE', 'ATC'] as const).map((x) => <button key={x} className={toInput(o, 0, 0).estimand === x ? 'on' : ''} disabled={pairs && x === 'ATE'} onClick={() => set({ ...o, estimand: x })}>{x}</button>)}
        </div>
        <div className="hint">ATT: the effect for the treated; ATE: for everyone; ATC: for the controls.</div>
      </div>
      {pairs && (
        <div className="row2">
          <div className="field"><label htmlFor="match-ratio">Controls per treated</label>
            <input id="match-ratio" className="input num" type="number" min={1} max={10} value={o.ratio} onChange={(e) => set({ ...o, ratio: Math.max(1, Math.min(10, Math.round(Number(e.target.value)) || 1)) })} /></div>
          {o.method === 'nearest' && <div className="field"><label htmlFor="match-cal">Caliper (SD of the distance)</label>
            <input id="match-cal" className="input num" placeholder="none" value={caliper} onChange={(e) => {
              setCaliper(e.target.value);
              const v = Number(e.target.value);
              set({ ...o, caliper: e.target.value.trim() === '' ? null : Number.isFinite(v) && v > 0 ? v : -1 });
            }} /></div>}
        </div>
      )}
      {o.method === 'nearest' && (
        <label className="check"><input type="checkbox" checked={o.replace} onChange={(e) => set({ ...o, replace: e.target.checked })} /><span>Match with replacement (a control can be used more than once)</span></label>
      )}
    </fieldset>
  );
}

const METHOD_IDS = ['nearest', 'optimal', 'full', 'exact', 'cem', 'subclass', 'weighting'] as const;

export const matchAnalysis: AnalysisType<MatchOptions, MatchCardResult> = {
  id: 'match',
  title: 'Propensity score matching',
  sub: 'matching, weighting, balance, treatment effect (MatchIt, WeightIt)',
  group: 'Regression and causal inference',
  defaults: () => ({ treatment: '', covariates: [], outcome: '', method: 'nearest', distance: 'glm', estimand: 'ATT', ratio: 1, caliper: null, replace: false, effectModel: 'dr', weightMethod: 'glm', link: 'logit', matchEffect: 'difference' }),
  parseOptions: (raw) => (isObj(raw) ? {
    treatment: name(raw.treatment), covariates: names(raw.covariates), outcome: name(raw.outcome),
    method: oneOf(raw.method, METHOD_IDS, 'nearest'), distance: oneOf(raw.distance, ['glm', 'mahalanobis'] as const, 'glm'),
    estimand: oneOf(raw.estimand, ['ATT', 'ATE', 'ATC'] as const, 'ATT'), ratio: clampNum(raw.ratio, 1, 10, 1, true),
    caliper: raw.caliper === null || raw.caliper === undefined ? null : clampNum(raw.caliper, -1, 100, -1),
    replace: flag(raw.replace), effectModel: oneOf(raw.effectModel, ['ipw', 'dr'] as const, 'dr'),
    // (cards saved before these options: the logistic score, the difference, propensity-score weights)
    weightMethod: oneOf(raw.weightMethod, ['glm', 'ebal'] as const, 'glm'), link: oneOf(raw.link, ['logit', 'probit'] as const, 'logit'),
    matchEffect: oneOf(raw.matchEffect, ['difference', 'dr'] as const, 'difference'),
  } : null),
  Options: MatchOptionsForm,
  View: ({ result }) => <MatchView r={result} input={result.input} />,
  blocked: (o, ctx) => {
    if (!o.treatment) return 'Choose the treatment.';
    if (!o.covariates.length) return 'Choose at least one covariate.';
    if (o.method === 'nearest' && o.caliper !== null && !(o.caliper > 0)) return 'The caliper must be a positive number (or empty for none).';
    return missingColumns(ctx, [o.treatment, ...o.covariates, o.outcome], o.method === 'weighting' ? 'Weighting' : 'Matching');
  },
  fingerprint: (o, ctx) => columnsFingerprint(ctx, [o.treatment, ...o.covariates, o.outcome], [ctx.settings.seed, ctx.settings.confidence]),
  run: async (o, ctx) => {
    const input = toInput(o, ctx.settings.seed, ctx.settings.confidence);
    return { ...(await (await import('../rengine/match')).matchR(rawData(ctx)!, input)), input };
  },
  script: async (o, ctx) => (await import('../rengine/match')).matchScriptR(rawData(ctx)!, toInput(o, ctx.settings.seed, ctx.settings.confidence)),
  summary: (o) => (o.treatment ? `${o.treatment} on ${o.covariates.length} covariate${o.covariates.length === 1 ? '' : 's'}${o.outcome ? ` → ${o.outcome}` : ''} · ${METHODS.find((m) => m.id === o.method)!.label}` : 'not set up yet'),
};
