// Specification search (as Amos): the arrows marked optional on the canvas are left in or out in every combination,
// each model fitted by lavaan, and the models ranked by BIC or AIC (with χ², df, CFI, RMSEA); a chosen model can be
// applied to the canvas (the arrows it leaves out are deleted).

import { useState } from 'react';
import { fmt } from '../format';
import { type ModelState } from '../model/project';
import type { ArrowRef, SpecModel } from '../rengine/search';
import type { REngineInfo } from '../rengine/lavaan';
import { c, pCell, Table, type Row } from '../components/results/Table';
import { useStore } from '../store';
import { cbCall, cbFingerprint, cbModelBlocked } from './cbModel';
import { Choice, isObj, oneOf } from './common';
import type { AnalysisType } from './types';

/** At most this many optional arrows (2^12 = 4096 models). */
export const MAX_OPTIONAL = 12;
const LIKELIHOOD = ['ML', 'MLR', 'MLM', 'MLMV'];

/** An optional arrow of the diagram: its id, what it is, its label, and its reference for R. */
export interface OptionalArrow {
  id: string;
  kind: 'path' | 'correlation';
  label: string;
  ref: ArrowRef;
}

/** The arrows marked optional (paths, then covariances), in the order the search numbers them. */
export function optionalArrows(model: ModelState): OptionalArrow[] {
  const name = new Map(model.constructs.map((k) => [k.id, k.name]));
  return [
    ...model.paths
      .filter((p) => p.optional)
      .map(
        (p): OptionalArrow => ({
          id: p.id,
          kind: 'path',
          label: `${name.get(p.from)} → ${name.get(p.to)}`,
          ref: { type: 'path', from: name.get(p.from)!, to: name.get(p.to)! },
        }),
      ),
    ...(model.correlations ?? [])
      .filter((k) => k.optional)
      .map(
        (k): OptionalArrow =>
          k.kind === 'construct'
            ? {
                id: k.id,
                kind: 'correlation',
                label: `${name.get(k.a)} ↔ ${name.get(k.b)}`,
                ref: { type: 'cov', kind: 'construct', a: name.get(k.a)!, b: name.get(k.b)! },
              }
            : {
                id: k.id,
                kind: 'correlation',
                label: `${k.a} ↔ ${k.b}`,
                ref: { type: 'cov', kind: 'indicator', a: k.a, b: k.b },
              },
      ),
  ];
}

/** Why the optional arrows cannot be searched (null when they can). */
export function optionalBlocked(model: ModelState): string | null {
  const opt = optionalArrows(model);
  if (!opt.length)
    return 'Mark the arrows that may be left out as optional: right-click a path or covariance on the canvas → Make optional.';
  if (opt.length > MAX_OPTIONAL)
    return `${opt.length} optional arrows would mean ${(2 ** opt.length).toLocaleString('en')} models: mark at most ${MAX_OPTIONAL} (${(2 ** MAX_OPTIONAL).toLocaleString('en')} models).`;
  const held = [
    ...model.paths.filter((p) => p.optional && (p.fixed !== undefined || p.label)),
    ...(model.correlations ?? []).filter(
      (k) => k.optional && (k.fixed !== undefined || k.label || k.byGroup?.length),
    ),
  ];
  if (held.length)
    return `An optional arrow must be a free, unlabelled parameter: ${optionalArrows({
      ...model,
      paths: model.paths.filter((p) => held.includes(p)),
      correlations: (model.correlations ?? []).filter((k) => held.includes(k)),
    })
      .map((a) => a.label)
      .join(', ')} is fixed or labelled.`;
  const moderated = model.paths.filter(
    (p) => p.optional && model.moderations.some((mo) => mo.path === p.id),
  );
  if (moderated.length) return 'A moderated path cannot be optional (its moderation needs it).';
  return null;
}

export interface SpecSearchOptions {
  criterion: 'bic' | 'aic';
  shown: number;
}
export interface SpecSearchResult {
  arrows: { id: string; kind: 'path' | 'correlation'; label: string }[];
  models: SpecModel[];
  estimator: string;
  warnings: string[];
  engine: REngineInfo;
}

/** A model ranked: its number (1 = every optional arrow in), the criterion's distance from the best, and its weight (Amos's BIC p / Akaike weight). */
export interface RankedModel {
  index: number;
  model: SpecModel;
  value: number;
  delta: number;
  weight: number;
}

/** Converged models with a finite criterion, best first; weights exp(−Δ/2) normalised (Burnham & Anderson; Amos's BIC_p and AIC_p). */
export function rankModels(models: SpecModel[], criterion: 'bic' | 'aic'): RankedModel[] {
  const ok = models
    .map((model, index) => ({ index, model, value: model[criterion] }))
    .filter(
      (m): m is { index: number; model: SpecModel; value: number } =>
        m.model.converged && m.value !== null,
    );
  if (!ok.length) return [];
  const best = Math.min(...ok.map((m) => m.value));
  const w = ok.map((m) => Math.exp(-(m.value - best) / 2)),
    total = w.reduce((a, b) => a + b, 0);
  return ok
    .map((m, i) => ({ ...m, delta: m.value - best, weight: w[i] / total }))
    .sort((a, b) => a.value - b.value || a.index - b.index);
}

/** The best model for each number of free parameters (Amos's summary), fewest parameters first. */
export function bestByParameters(ranked: RankedModel[]): RankedModel[] {
  const out = new Map<number, RankedModel>();
  for (const r of ranked)
    if (r.model.npar !== null && !out.has(r.model.npar)) out.set(r.model.npar, r);
  return [...out.values()].sort((a, b) => a.model.npar! - b.model.npar!);
}

/** The diagram with model `keep`'s choice applied: the optional arrows it leaves out deleted. */
export function applySpecModel(
  model: ModelState,
  arrows: SpecSearchResult['arrows'],
  keep: boolean[],
): ModelState {
  const drop = new Set(arrows.filter((_, j) => !keep[j]).map((a) => a.id));
  return {
    ...model,
    paths: model.paths.filter((p) => !drop.has(p.id)),
    correlations: (model.correlations ?? []).filter((k) => !drop.has(k.id)),
  };
}

const inModel = (r: SpecSearchResult, keep: boolean[]) =>
  keep.every(Boolean)
    ? 'all'
    : keep.some(Boolean)
      ? r.arrows
          .filter((_, j) => keep[j])
          .map((a) => a.label)
          .join('; ')
      : 'none';

function SpecSearchView({
  r,
  o,
  current,
}: {
  r: SpecSearchResult;
  o: SpecSearchOptions;
  current: boolean;
}) {
  const ranked = rankModels(r.models, o.criterion);
  const [pick, setPick] = useState(0);
  const C = o.criterion.toUpperCase();
  const failed = r.models.length - r.models.filter((m) => m.converged).length;
  const shown = o.shown > 0 ? ranked.slice(0, o.shown) : ranked;
  const row = (x: RankedModel, rank?: number): Row => [
    ...(rank !== undefined ? [c(rank, undefined, 0)] : []),
    c(x.index + 1, undefined, 0),
    c(inModel(r, x.model.keep)),
    c(x.model.npar, undefined, 0),
    c(x.model.df, undefined, 0),
    c(x.model.chisq, undefined, 3),
    pCell(x.model.p),
    c(x.model.cfi, undefined, 3),
    c(x.model.rmsea, undefined, 3),
    c(x.model.aic, undefined, 2),
    c(x.model.bic, undefined, 2),
    c(x.delta, undefined, 2),
    c(x.weight, undefined, 3),
  ];
  const cols = [
    'Model',
    'Optional arrows in the model',
    'Parameters',
    'df',
    'χ²',
    'p',
    'CFI',
    'RMSEA',
    'AIC',
    'BIC',
    `${C}₀`,
    `${C} p`,
  ];
  const chosen = ranked[Math.min(pick, ranked.length - 1)];
  const apply = () => {
    if (!chosen) return;
    const s = useStore.getState();
    s.commit((m) => applySpecModel(m, r.arrows, chosen.model.keep));
    s.toast(
      'success',
      `Model ${chosen.index + 1} applied: ${r.arrows.filter((_, j) => !chosen.model.keep[j]).length} optional arrow(s) deleted (Undo restores them).`,
    );
  };
  return (
    <div className="tables">
      <Table
        title={`Models ranked by ${C}`}
        file="specification-search"
        columns={['Rank', ...cols]}
        rows={shown.map((x, i) => row(x, i + 1))}
        note={`${r.models.length} models: every combination of the ${r.arrows.length} optional arrow${r.arrows.length === 1 ? '' : 's'} (${r.arrows.map((a, j) => `${j + 1}. ${a.label}`).join('; ')}), each left out by fixing it at zero, so every variable stays in the model (Amos’s specification search). ${r.estimator} with the model’s missing-data treatment; χ² is the standard statistic. ${C}₀ = ${C} − the smallest ${C}; ${C} p = exp(−${C}₀/2) normalised over the models (${o.criterion === 'bic' ? 'the posterior probability with equal prior probabilities, Amos’s BIC_p' : 'the Akaike weight'}).${failed ? ` ${failed} model${failed === 1 ? '' : 's'} did not converge or could not be fitted and ${failed === 1 ? 'is' : 'are'} not ranked.` : ''}${shown.length < ranked.length ? ` The ${shown.length} best of ${ranked.length} are shown (Shown, in the options).` : ''} lavaan ${r.engine.version}.`}
      />
      <Table
        title={`Best model for each number of parameters (${C})`}
        file="specification-search-best"
        columns={cols}
        rows={bestByParameters(ranked).map((x) => row(x))}
        note="As Amos’s summary: for each number of free parameters, the model with the smallest criterion. Compare down the rows how much χ² each further parameter buys."
      />
      {ranked.length > 0 && (
        <div style={{ flexBasis: '100%', width: '100%' }}>
          <h4 style={{ margin: '12px 0 6px' }}>Apply a model to the canvas</h4>
          <div
            className="field"
            style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
          >
            <select
              className="select"
              aria-label="Model to apply"
              value={Math.min(pick, ranked.length - 1)}
              onChange={(e) => setPick(Number(e.target.value))}
            >
              {ranked.map((x, i) => (
                <option
                  key={x.index}
                  value={i}
                >{`Rank ${i + 1}: model ${x.index + 1} (${C} ${fmt(x.value, 2)}) — ${inModel(r, x.model.keep)}`}</option>
              ))}
            </select>
            <button
              className="btn sm"
              disabled={!current}
              onClick={apply}
              title={
                current
                  ? 'Delete the optional arrows this model leaves out'
                  : 'The model or data changed since the search: run it again first'
              }
            >
              Apply
            </button>
          </div>
          <p className="hint">
            Deletes the optional arrows the chosen model leaves out; the others stay on the canvas,
            still optional. Undo restores them.
            {current ? '' : ' Run the search again first: the model or data changed since.'}
          </p>
        </div>
      )}
    </div>
  );
}

const SHOWN: [string, string][] = [
  ['10', '10'],
  ['25', '25'],
  ['100', '100'],
  ['0', 'All'],
];

export const specSearchAnalysis: AnalysisType<SpecSearchOptions, SpecSearchResult> = {
  id: 'specsearch',
  title: 'Specification search',
  sub: 'every combination of the optional arrows, ranked by BIC or AIC (as Amos; lavaan)',
  group: 'CB-SEM model',
  fitsModel: true,
  display: ['criterion', 'shown'],
  defaults: () => ({ criterion: 'bic', shown: 25 }),
  parseOptions: (raw) =>
    isObj(raw)
      ? {
          criterion: oneOf(raw.criterion, ['bic', 'aic'] as const, 'bic'),
          shown: [10, 25, 100, 0].includes(raw.shown as number) ? (raw.shown as number) : 25,
        }
      : null,
  Options: ({ options: o, set, ctx, disabled }) => {
    const n = ctx.model ? optionalArrows(ctx.model).length : 0;
    return (
      <fieldset className="card-options" disabled={disabled}>
        <p className="hint" style={{ marginTop: 0 }}>
          Which arrows does the model need? Mark arrows as optional on the canvas (right-click a
          path or covariance → Make optional; drawn dash-dotted): every combination of them is
          fitted, at most {MAX_OPTIONAL} optional arrows ({(2 ** MAX_OPTIONAL).toLocaleString('en')}{' '}
          models).{' '}
          {n ? `Now ${n} optional, ${(2 ** n).toLocaleString('en')} models.` : 'None marked yet.'}{' '}
          The estimator and missing-data treatment are the Model settings’ ({ctx.settings.estimator}
          ).
        </p>
        <Choice
          label="Rank by"
          value={o.criterion}
          options={
            [
              ['bic', 'BIC'],
              ['aic', 'AIC'],
            ] as const
          }
          onChange={(criterion) => set({ ...o, criterion })}
        />
        <Choice
          label="Shown"
          value={String(o.shown)}
          options={SHOWN}
          onChange={(v) => set({ ...o, shown: Number(v) })}
        />
      </fieldset>
    );
  },
  View: ({ result, options, current }) => (
    <SpecSearchView r={result} o={options} current={current} />
  ),
  blocked: (_o, ctx) =>
    cbModelBlocked(ctx, 'The specification search', false) ??
    (LIKELIHOOD.includes(ctx.settings.estimator)
      ? null
      : 'The specification search ranks models by AIC and BIC: choose a maximum-likelihood estimator (ML, MLR, MLM or MLMV) in the Model settings.') ??
    (ctx.model?.ordered?.length
      ? 'The specification search ranks models by AIC and BIC, which ordinal indicators (WLSMV) do not have.'
      : null) ??
    optionalBlocked(ctx.model!),
  fingerprint: (_o, ctx) =>
    cbFingerprint(ctx, ctx.model ? optionalArrows(ctx.model).map((a) => `${a.id}:${a.label}`) : []),
  run: async (_o, ctx) => {
    const arrows = optionalArrows(ctx.model!);
    const r = await (
      await import('../rengine/search')
    ).specSearchR(
      cbCall(ctx),
      arrows.map((a) => a.ref),
    );
    return {
      arrows: arrows.map(({ id, kind, label }) => ({ id, kind, label })),
      models: r.models,
      estimator: ctx.settings.estimator,
      warnings: r.warnings,
      engine: r.engine,
    };
  },
  script: async (_o, ctx) =>
    (await import('../rengine/search')).specSearchScriptR(
      cbCall(ctx),
      optionalArrows(ctx.model!).map((a) => a.ref),
    ),
  summary: (o) => `ranked by ${o.criterion.toUpperCase()}`,
};
