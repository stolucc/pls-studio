// PLS-SEM and CB-SEM side by side on the model on the canvas: the same diagram estimated by both, and their estimates
// in one table (the built-in engines, so that the comparison needs no R).

import { Table, c, type Row } from '../components/results/Table';
import { estimateCb, type CbResult } from '../engine/cbsem';
import { estimatePls } from '../engine/pls';
import type { PlsResult } from '../engine/types';
import { buildFigureInput, type FigureValues } from '../figure/build';
import { renderFigureSvg } from '../figure/render';
import { circlesFor, placeModel } from '../placement';
import type { FigureStyle } from '../figure/style';
import { makeCovariancesExplicit, toSpec, type ModelState } from '../model/project';
import { fingerprint } from './codec';
import { columnsFingerprint, isObj, rawData } from './common';
import type { AnalysisType } from './types';

export interface MethodCompareResult {
  paths: { from: string; to: string; pls: number; cb: number | null }[];
  loadings: { construct: string; indicator: string; pls: number; cb: number | null }[];
  r2: { construct: string; pls: number | null; cb: number | null }[];
  n: { pls: number; cb: number };
  /** The diagram under each method, as SVG. */
  figures: { pls: string; cb: string };
}

/** The diagram of a model with the estimates of one method (the canvas's figure, standardised). */
export function comparisonFigure(
  model: ModelState,
  method: 'pls' | 'cbsem',
  pls: PlsResult,
  cb: CbResult,
  style: FigureStyle,
) {
  const byId = new Map(model.constructs.map((k) => [k.id, k]));
  const std = (op: string, lhs: string, rhs: string) =>
    cb.estimates.find((e) => e.op === op && e.lhs === lhs && e.rhs === rhs)?.std ?? null;
  const values: FigureValues =
    method === 'pls'
      ? {
          indicator: (name) =>
            pls.loadings[pls.indicators.findIndex((i) => i.name === name)] ?? null,
          r2: (name) => pls.rSquared[pls.constructs.indexOf(name)] ?? null,
          path: (from, to) => ({
            beta: pls.pathCoef[pls.constructs.indexOf(from)]?.[pls.constructs.indexOf(to)] ?? null,
          }),
        }
      : {
          indicator: (name, construct) => std('=~', construct, name),
          r2: (name) => cb.r2Constructs[cb.constructs.indexOf(name)] ?? null,
          path: (from, to) => ({ beta: std('~', to, from) }),
          error: (_kind, name) => std('~~', name, name),
          correlation: (k) => {
            const a = k.kind === 'construct' ? (byId.get(k.a)?.name ?? k.a) : k.a;
            const b = k.kind === 'construct' ? (byId.get(k.b)?.name ?? k.b) : k.b;
            return { value: std('~~', a, b) ?? std('~~', b, a) };
          },
        };
  return renderFigureSvg(
    buildFigureInput(placeModel(model, circlesFor(style, method)), method, values, {
      showErrors: method === 'cbsem',
    }),
    style,
  ).svg;
}

export function compareMethods(
  data: Parameters<typeof estimatePls>[0],
  model: ModelState,
  style: FigureStyle,
  missing: 'mean' | 'casewise',
): MethodCompareResult {
  const spec = toSpec(model);
  const pls = estimatePls(data, spec, { missing });
  // CB-SEM correlates the exogenous factors whose pairs are not confirmed as uncorrelated (lavaan's default, and what PLS
  // does with every pair of exogenous composites): otherwise the comparison would set their correlation to zero.
  const cbModel = makeCovariancesExplicit(model);
  const cb = estimateCb(data, toSpec(cbModel), 'casewise');
  const std = (op: string, lhs: string, rhs: string) =>
    cb.estimates.find((e) => e.op === op && e.lhs === lhs && e.rhs === rhs)?.std ?? null;
  const C = pls.constructs;
  return {
    paths: spec.paths.map((p) => ({
      from: p.from,
      to: p.to,
      pls: pls.pathCoef[C.indexOf(p.from)][C.indexOf(p.to)],
      cb: std('~', p.to, p.from),
    })),
    loadings: spec.constructs.flatMap((k) =>
      k.indicators.map((indicator) => ({
        construct: k.name,
        indicator,
        pls: pls.loadings[pls.indicators.findIndex((i) => i.name === indicator)],
        cb: std('=~', k.name, indicator),
      })),
    ),
    r2: C.flatMap((name, j) =>
      pls.rSquared[j] === null
        ? []
        : [
            {
              construct: name,
              pls: pls.rSquared[j],
              cb: cb.r2Constructs[cb.constructs.indexOf(name)] ?? null,
            },
          ],
    ),
    n: { pls: pls.n, cb: cb.n },
    figures: {
      pls: comparisonFigure(model, 'pls', pls, cb, style),
      cb: comparisonFigure(cbModel, 'cbsem', pls, cb, style),
    },
  };
}

function View({ result: r }: { result: MethodCompareResult }) {
  const diff = (a: number, b: number | null) => (b === null ? null : a - b);
  const rows = (items: { label: string; pls: number | null; cb: number | null }[]): Row[] =>
    items.map((x) => [c(x.label), c(x.pls), c(x.cb), c(x.pls === null ? null : diff(x.pls, x.cb))]);
  const img = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return (
    <>
      <div className="method-compare">
        <figure>
          <figcaption>PLS-SEM</figcaption>
          <img src={img(r.figures.pls)} alt="The model with its PLS-SEM estimates" />
        </figure>
        <figure>
          <figcaption>CB-SEM</figcaption>
          <img src={img(r.figures.cb)} alt="The model with its CB-SEM estimates" />
        </figure>
      </div>
      <div className="tables">
        <Table
          title="Paths"
          file="compare-paths"
          columns={['Path', 'PLS-SEM', 'CB-SEM (std.)', 'Difference']}
          rows={rows(r.paths.map((p) => ({ label: `${p.from} → ${p.to}`, pls: p.pls, cb: p.cb })))}
          note={`The composite estimates of PLS-SEM are typically attenuated for common factors, and CB-SEM’s common-factor estimates larger; PLSc corrects for that. N = ${r.n.pls} (PLS-SEM), ${r.n.cb} (CB-SEM).`}
        />
        <Table
          title="Loadings"
          file="compare-loadings"
          columns={['Indicator', 'PLS-SEM', 'CB-SEM (std.)', 'Difference']}
          rows={rows(
            r.loadings.map((l) => ({
              label: `${l.construct} → ${l.indicator}`,
              pls: l.pls,
              cb: l.cb,
            })),
          )}
        />
        {r.r2.length > 0 && (
          <Table
            title="R²"
            file="compare-r2"
            columns={['Construct', 'PLS-SEM', 'CB-SEM', 'Difference']}
            rows={rows(r.r2.map((x) => ({ label: x.construct, pls: x.pls, cb: x.cb })))}
          />
        )}
      </div>
    </>
  );
}

export const methodCompareAnalysis: AnalysisType<Record<string, never>, MethodCompareResult> = {
  id: 'methodcompare',
  title: 'PLS-SEM and CB-SEM compared',
  sub: 'the model on the canvas estimated by both, side by side',
  group: 'PLS-SEM model',
  fitsModel: true,
  defaults: () => ({}),
  parseOptions: (raw) => (isObj(raw) ? {} : null),
  Options: () => (
    <p className="hint" style={{ marginTop: 0 }}>
      The same diagram by PLS-SEM (standard, as its weighting modes) and by CB-SEM (ML, casewise
      deletion): built-in engines, so the result is the same whichever engine is selected. The
      diagrams use the current figure style.
    </p>
  ),
  View,
  blocked: (_o, ctx) => {
    if (!ctx.model?.constructs.length) return 'Draw a model first.';
    if (!rawData(ctx)) return 'This needs raw data: PLS-SEM cannot use a covariance matrix.';
    if (ctx.model.moderations.length || ctx.model.copulas?.length || ctx.model.threeWay?.length)
      return 'The comparison works on models without interaction or copula terms.';
    if (ctx.model.constructs.some((k) => k.components?.length))
      return 'The comparison works on first-order models.';
    if (ctx.model.constructs.some((k) => k.type === 'composite'))
      return 'The comparison estimates common factors in both methods: make the composites common factors first (their panel).';
    if (!ctx.model.paths.length) return 'Draw at least one path.';
    return null;
  },
  fingerprint: (_o, ctx) => {
    if (!ctx.model || !ctx.data) return null;
    const cols = columnsFingerprint(
      ctx,
      ctx.model.constructs.flatMap((k) => k.indicators),
    );
    return (
      cols &&
      fingerprint([
        cols,
        JSON.stringify(toSpec(ctx.model)),
        ctx.settings.missing,
        JSON.stringify(ctx.settings.figure),
      ])
    );
  },
  run: async (_o, ctx) =>
    compareMethods(
      ctx.data!,
      ctx.model!,
      ctx.settings.figure,
      ctx.settings.missing === 'casewise' ? 'casewise' : 'mean',
    ),
  summary: () => 'the model by both methods',
};
