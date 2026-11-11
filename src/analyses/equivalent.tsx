// Equivalent models: the alternatives to the structural model on the canvas that fit any data equally well (Lee &
// Hershberger's replacing rules, model/equivalent.ts), each drawn as a small diagram and confirmed by fitting it
// with lavaan (the same χ² and df); one can be applied to the canvas.

import { useMemo } from 'react';
import { buildFigureInput } from '../figure/build';
import { renderFigureSvg } from '../figure/render';
import type { FigureStyle } from '../figure/style';
import { applyStructure, describeChange, equivalentModels, structureOf } from '../model/equivalent';
import { toSpec, type Correlation, type ModelState, type Path } from '../model/project';
import { circlesFor, placeModel } from '../placement';
import type { REngineInfo } from '../rengine/lavaan';
import type { VariantFit } from '../rengine/search';
import { c, Table, type Row } from '../components/results/Table';
import { useStore } from '../store';
import { cbCall, cbFingerprint, cbModelBlocked } from './cbModel';
import { clampNum, isObj } from './common';
import type { AnalysisCtx, AnalysisType } from './types';

export interface EquivalentOptions {
  max: number;
}
export interface EquivalentAlternative {
  paths: Path[];
  correlations: Correlation[];
  changes: string[];
  rules: (1 | 2)[];
  fit: VariantFit | null;
}
export interface EquivalentResult {
  model: ModelState;
  fit: VariantFit | null;
  alternatives: EquivalentAlternative[];
  truncated: boolean;
  warnings: string[];
  engine: REngineInfo;
}

/** Same fit: both converged, the same df, χ² equal to 1e-6 (relative to χ², at least 1e-6 absolute). */
export function sameFit(a: VariantFit | null, b: VariantFit | null): boolean {
  if (
    !a ||
    !b ||
    !a.converged ||
    !b.converged ||
    a.df === null ||
    a.df !== b.df ||
    a.chisq === null ||
    b.chisq === null
  )
    return false;
  return Math.abs(a.chisq - b.chisq) <= 1e-6 * Math.max(1, Math.abs(a.chisq));
}

/** The alternatives of the diagram's structural model, as diagrams. */
export function alternativesOf(
  model: ModelState,
  max: number,
): { alternatives: Omit<EquivalentAlternative, 'fit'>[]; truncated: boolean } {
  const base = structureOf(model);
  const name = (id: string) => model.constructs.find((k) => k.id === id)?.name ?? id;
  const { models, truncated } = equivalentModels(model, max);
  return {
    truncated,
    alternatives: models.map((e) => {
      const m = applyStructure(model, e.structure);
      return {
        paths: m.paths,
        correlations: m.correlations ?? [],
        changes: e.changes.map((ch) => describeChange(ch, name, base, e.structure)),
        rules: e.rules,
      };
    }),
  };
}

const img = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
const figureOf = (m: ModelState, style: FigureStyle) =>
  renderFigureSvg(
    buildFigureInput(placeModel(m, circlesFor(style, 'cbsem')), 'cbsem', {}, { showErrors: false }),
    style,
  ).svg;

function EquivalentView({ r, current }: { r: EquivalentResult; current: boolean }) {
  const style = useStore((s) => s.settings.figure);
  const figures = useMemo(
    () => [
      figureOf(r.model, style),
      ...r.alternatives.map((a) =>
        figureOf({ ...r.model, paths: a.paths, correlations: a.correlations }, style),
      ),
    ],
    [r, style],
  );
  if (!r.alternatives.length)
    return (
      <p className="muted">
        The replacing rules give no alternative to this structural model: no saturated block at its
        start and no two constructs with the same predictors joined by one arrow (arrows that are
        fixed or labelled, and constructs that are covariates, higher-order, ESEM factors or
        moderated, keep their relations).
      </p>
    );
  const apply = (a: EquivalentAlternative, k: number) => {
    const s = useStore.getState();
    s.commit((m) => ({ ...m, paths: a.paths, correlations: a.correlations }));
    s.toast('success', `Equivalent model ${k} applied to the canvas (Undo restores the model).`);
  };
  const confirmed = r.alternatives.filter((a) => sameFit(r.fit, a.fit)).length;
  const fmtFit = (f: VariantFit | null) =>
    f && f.converged ? `χ² = ${f.chisq?.toFixed(3)}, df = ${f.df}` : 'did not converge';
  const rows: Row[] = [
    [
      c('Model on the canvas'),
      c('—'),
      c(''),
      c(r.fit?.chisq ?? null, undefined, 4),
      c(r.fit?.df ?? null, undefined, 0),
      c(null),
      c(''),
    ],
    ...r.alternatives.map(
      (a, i): Row => [
        c(`Equivalent ${i + 1}`),
        c(a.changes.join('; ')),
        c(a.rules.join(', ')),
        c(a.fit?.chisq ?? null, undefined, 4),
        c(a.fit?.df ?? null, undefined, 0),
        c(
          a.fit?.chisq != null && r.fit?.chisq != null ? a.fit.chisq - r.fit.chisq : null,
          undefined,
          6,
        ),
        sameFit(r.fit, a.fit) ? c('yes', 'good') : c('no', 'bad'),
      ],
    ),
  ];
  return (
    <>
      <div className="tables">
        <Table
          title="The model and its equivalent alternatives"
          file="equivalent-models"
          columns={['Model', 'Changes', 'Rule', 'χ²', 'df', 'Δχ²', 'Same fit']}
          rows={rows}
          note={`${r.alternatives.length} alternative${r.alternatives.length === 1 ? '' : 's'}${r.truncated ? ' (more exist: raise the maximum)' : ''}, ${confirmed} confirmed by lavaan ${r.engine.version}: the same χ² and df (|Δχ²| ≤ 10⁻⁶ χ²), each model fitted from lavaan’s default and from simple starting values and the lower minimum kept (a reparameterised model can stop at a local minimum). Rule 1: a saturated block at the start of the model receiving no arrow from outside, whose paths and covariances are interchangeable; Rule 2: two constructs with the same predictors, where X → Y, Y → X and ζX ↔ ζY are interchangeable (Lee & Hershberger 1990; Kline 2016, Rules 11.1–11.2). Equivalent models cannot be told apart by any fit statistic: only theory, design (time order, manipulation) or other data can choose between them (MacCallum et al. 1993).${r.fit?.df === 0 ? ' The model is saturated (df = 0): every identified alternative fits perfectly, so equal χ² confirms little here; the rules themselves make them equivalent.' : ''}`}
        />
      </div>
      <div className="equivalent-grid">
        {[null, ...r.alternatives].map((a, i) => (
          <figure key={i} className="equivalent-figure">
            <img
              src={img(figures[i])}
              alt={i === 0 ? 'The model on the canvas' : `Equivalent model ${i}`}
            />
            <figcaption>
              <strong>{i === 0 ? 'Model on the canvas' : `Equivalent ${i}`}</strong> ·{' '}
              {fmtFit(a ? a.fit : r.fit)}
              {a && (sameFit(r.fit, a.fit) ? ' ✓' : ' (not confirmed)')}
              {a && <div className="hint">{a.changes.join('; ')}</div>}
              {a && (
                <button
                  className="btn sm"
                  disabled={!current}
                  onClick={() => apply(a, i)}
                  title={
                    current
                      ? 'Replace the structural model on the canvas by this one'
                      : 'The model or data changed: run the card again first'
                  }
                >
                  Apply to the canvas
                </button>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}

const variantsOf = (ctx: AnalysisCtx, o: EquivalentOptions) =>
  alternativesOf(ctx.model!, o.max).alternatives.map((a) => {
    const s = toSpec({ ...ctx.model!, paths: a.paths, correlations: a.correlations });
    return { paths: s.paths, covariances: s.covariances };
  });

export const equivalentAnalysis: AnalysisType<EquivalentOptions, EquivalentResult> = {
  id: 'equivalent',
  title: 'Equivalent models',
  sub: 'alternatives that fit any data equally well (Lee–Hershberger replacing rules), confirmed by lavaan',
  group: 'CB-SEM model',
  fitsModel: true,
  defaults: () => ({ max: 12 }),
  parseOptions: (raw) => (isObj(raw) ? { max: clampNum(raw.max, 1, 50, 12, true) } : null),
  Options: ({ options: o, set, ctx, disabled }) => (
    <fieldset className="card-options" disabled={disabled}>
      <p className="hint" style={{ marginTop: 0 }}>
        Which other structural models fit exactly as well? Lee &amp; Hershberger’s replacing rules
        (Stelzl 1986; MacCallum et al. 1993) generate them from the diagram: paths reversed or
        replaced by covariances within a saturated preceding block, and between constructs with the
        same predictors. Each is fitted with lavaan ({ctx.settings.estimator}, the Model settings)
        to confirm the same χ² and df. Measurement models are kept as they are.
      </p>
      <div className="field">
        <label htmlFor="eq-max">At most</label>
        <input
          id="eq-max"
          className="input"
          type="number"
          min={1}
          max={50}
          value={o.max}
          onChange={(e) => set({ max: clampNum(e.target.value, 1, 50, o.max, true) })}
        />
        <div className="hint">alternative models (1–50), nearest first.</div>
      </div>
    </fieldset>
  ),
  View: ({ result, current }) => <EquivalentView r={result} current={current} />,
  blocked: (_o, ctx) =>
    cbModelBlocked(ctx, 'Equivalent models', false) ??
    (ctx.model!.paths.length ||
    ctx.model!.correlations?.some((k) => k.kind === 'construct' && !k.zero)
      ? null
      : 'Equivalent models are alternatives to a structural model: draw paths or covariances between constructs first.'),
  fingerprint: (o, ctx) => cbFingerprint(ctx, [o.max]),
  run: async (o, ctx) => {
    const { alternatives, truncated } = alternativesOf(ctx.model!, o.max);
    const model = ctx.model!;
    if (!alternatives.length)
      return {
        model,
        fit: null,
        alternatives: [],
        truncated,
        warnings: [],
        engine: { package: 'lavaan', version: '' },
      };
    const r = await (
      await import('../rengine/search')
    ).equivalentFitsR(cbCall(ctx), variantsOf(ctx, o));
    return {
      model,
      fit: r.fits[0] ?? null,
      alternatives: alternatives.map((a, i) => ({ ...a, fit: r.fits[i + 1] ?? null })),
      truncated,
      warnings: r.warnings,
      engine: r.engine,
    };
  },
  script: async (o, ctx) =>
    (await import('../rengine/search')).equivalentFitsScriptR(cbCall(ctx), variantsOf(ctx, o)),
  summary: (o) => `at most ${o.max} alternatives`,
};
