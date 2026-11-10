// Nonlinear paths and causality assessment (after WarpPLS, Kock): each path of the PLS-SEM model straight, U-shaped
// (quadratic) or S-shaped (cubic), estimated by regressing the construct scores on polynomial terms of their predictors'
// scores, with each curve drawn; and Kock's causality assessment indices from the linear estimates.

import { ChartFrame } from '../components/ChartFrame';
import { Table, c, pCell, type Row } from '../components/results/Table';
import { causalityIndices, nonlinearPaths, pathCurve, type CausalityIndices, type NonlinearEquation, type PathShape } from '../engine/nonlinear';
import { SERIES_COLORS } from '../figure/palette';
import { fmt } from '../format';
import { fingerprint } from './codec';
import { isObj, oneOf, sourceFingerprint } from './common';
import type { AnalysisCtx, AnalysisType } from './types';

const SHAPES = ['linear', 'quadratic', 'cubic'] as const;
const SHAPE_LABEL: Record<PathShape, string> = { linear: 'Linear', quadratic: 'U-curve (x, x²)', cubic: 'S-curve (x, x², x³)' };
const key = (from: string, to: string) => `${from}→${to}`;

/** Each path's shape, by "from→to" (construct names); a path not listed is quadratic. */
export interface NonlinearOptions { shapes: Record<string, PathShape> }
export interface NonlinearResult {
  equations: NonlinearEquation[];
  indices: CausalityIndices;
  /** Per path: the shape and the scores, for the chart. */
  paths: { from: string; to: string; shape: PathShape; x: number[]; y: number[] }[];
}

const shapeOf = (o: NonlinearOptions, from: string, to: string): PathShape => o.shapes[key(from, to)] ?? 'quadratic';
/** The structural paths of the current PLS results (constructs of the model only). */
const pathsOf = (ctx: AnalysisCtx) => {
  const p = ctx.pls;
  if (!p) return [];
  return p.constructs.flatMap((from, i) => p.constructs.flatMap((to, j) => (p.hasPath[i][j] ? [{ from, to }] : [])));
};

/** The analysis on PLS results: polynomial paths on the construct scores and the causality indices. */
export function analyseNonlinear(pls: NonNullable<AnalysisCtx['pls']>, o: NonlinearOptions): NonlinearResult {
  const C = pls.constructs;
  const equations = nonlinearPaths(pls.scores, C, pls.hasPath, (f, t) => shapeOf(o, f, t));
  const paths = C.flatMap((from, i) => C.flatMap((to, j) => (pls.hasPath[i][j] ? [{ from, to, shape: shapeOf(o, from, to), x: Array.from(pls.scores[i]), y: Array.from(pls.scores[j]) }] : [])));
  return { equations, indices: causalityIndices(C, pls.hasPath, pls.pathCoef, pls.constructCor), paths };
}

function Curve({ eq, path, k }: { eq: NonlinearEquation; path: NonlinearResult['paths'][number]; k: number }) {
  const width = 300, height = 210, pad = { l: 46, r: 10, t: 10, b: 34 };
  const lo = Math.min(...path.x), hi = Math.max(...path.x);
  const pts = pathCurve(eq, path.from, lo, hi);
  const ylo = Math.min(...path.y, ...pts.map((p) => p[1])), yhi = Math.max(...path.y, ...pts.map((p) => p[1]));
  const W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const sx = (x: number) => pad.l + ((x - lo) / (hi - lo || 1)) * W;
  const sy = (y: number) => pad.t + ((yhi - y) / (yhi - ylo || 1)) * H;
  const color = SERIES_COLORS[k % SERIES_COLORS.length];
  const terms = eq.terms.filter((t) => t.from === path.from);
  const caption = <figcaption className="hint" style={{ marginTop: 4 }}>{SHAPE_LABEL[path.shape]}: {terms.map((t) => `b${t.power > 1 ? `(x${t.power === 2 ? '²' : '³'})` : ''} = ${fmt(t.b)}`).join(', ')}; the other predictors at their mean.</figcaption>;
  return (
    <ChartFrame id={`warp:${path.from}:${path.to}`} name={`nonlinear-${path.from}-${path.to}`} width={width} height={height} caption={caption}
      defaults={{ x: `${path.from} (score)`, y: `${path.to} (score)` }}>
      {(labels) => (
        <svg className="slopes" width={width} height={height} role="img" aria-label={`${path.from} → ${path.to}: scores and the fitted ${path.shape} curve`}>
          <line className="axis" x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + H} />
          <line className="axis" x1={pad.l} y1={pad.t + H} x2={pad.l + W} y2={pad.t + H} />
          <text x={pad.l - 4} y={sy(yhi) + 4} textAnchor="end">{yhi.toFixed(1)}</text>
          <text x={pad.l - 4} y={sy(ylo) + 4} textAnchor="end">{ylo.toFixed(1)}</text>
          <text x={sx(lo)} y={height - 16} textAnchor="start">{lo.toFixed(1)}</text>
          <text x={sx(hi)} y={height - 16} textAnchor="end">{hi.toFixed(1)}</text>
          <text className="axis-title" x={pad.l + W / 2} y={height - 2} textAnchor="middle">{labels.x}</text>
          <text className="axis-title" transform={`translate(11 ${pad.t + H / 2}) rotate(-90)`} textAnchor="middle">{labels.y}</text>
          {path.x.map((x, r) => <circle key={r} cx={sx(x)} cy={sy(path.y[r])} r={1.8} fill={color} fillOpacity={0.3} />)}
          <polyline points={pts.map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
        </svg>
      )}
    </ChartFrame>
  );
}

const verdict = (v: number, min: number) => c(v >= min ? `acceptable (≥ ${min})` : `below ${min}`, v >= min ? 'good' : 'bad');
const sup = (p: number) => (p === 2 ? '²' : p === 3 ? '³' : '');

function View({ result: r }: { result: NonlinearResult }) {
  const k = r.indices;
  const coefRows: Row[] = r.equations.flatMap((e) => e.terms.map((t) => [c(`${t.from}${sup(t.power)} → ${e.to}`), c(t.b), c(t.se), c(t.t), pCell(t.p)]));
  return (
    <>
      <div className="tables">
        <Table title="Polynomial path coefficients" file="nonlinear-paths" columns={['Term', 'b', 'Std. error', 't', 'p']} rows={coefRows}
          note="OLS of each endogenous construct's scores on its predictors' scores and their powers (intercept included; t test with n − k − 1 df). The polynomial stands in for WarpPLS's warping (Kock 2010); a significant x² or x³ term is evidence of a nonlinear path." />
        <Table title="R²" file="nonlinear-r2" columns={['Construct', 'Linear', 'Nonlinear', 'Gain']} rows={r.equations.map((e) => [c(e.to), c(e.r2Linear), c(e.r2), c(e.r2 - e.r2Linear)])} />
        <Table title="Causality assessment indices" file="causality-indices" columns={['Index', 'Value', 'Assessment']}
          rows={[[c('Simpson’s paradox ratio (SPR)'), c(k.spr), verdict(k.spr, 0.7)], [c('R-squared contribution ratio (RSCR)'), c(k.rscr), verdict(k.rscr, 0.9)], [c('Statistical suppression ratio (SSR)'), c(k.ssr), verdict(k.ssr, 0.7)]]}
          note="Kock (2015, 2022), from the linear path coefficients β and the correlations r of the linked constructs: Simpson’s paradox where β and r differ in sign; R² contribution β·r; suppression where |β/r| > 1.3. Ideally 1. The nonlinear bivariate causality direction ratio (NLBCDR) is not reported: it rests on WarpPLS’s warping algorithms, which are not published in closed form." />
        <Table title="Paths" file="causality-paths" columns={['Path', 'β', 'r', 'R² contribution', 'Simpson’s paradox', 'Suppression']}
          rows={k.paths.map((p) => [c(`${p.from} → ${p.to}`), c(p.beta), c(p.r), c(p.contribution), c(p.simpson ? 'yes' : 'no', p.simpson ? 'bad' : ''), c(p.suppression ? 'yes' : 'no', p.suppression ? 'warn' : '')])} />
      </div>
      <div className="chart-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {r.paths.map((p, i) => { const eq = r.equations.find((e) => e.to === p.to); return eq ? <Curve key={key(p.from, p.to)} eq={eq} path={p} k={i} /> : null; })}
      </div>
    </>
  );
}

export const nonlinearAnalysis: AnalysisType<NonlinearOptions, NonlinearResult> = {
  id: 'nonlinear', title: 'Nonlinear paths and causality', sub: 'U- and S-shaped paths on the construct scores, Kock’s causality indices (WarpPLS)', group: 'PLS-SEM model',
  fitsModel: true,
  defaults: () => ({ shapes: {} }),
  parseOptions: (raw) => {
    if (!isObj(raw)) return null;
    const s = isObj(raw.shapes) ? raw.shapes : {};
    // (at most 500 paths; keys are path names, values one of the shapes)
    return { shapes: Object.fromEntries(Object.entries(s).slice(0, 500).filter(([k2]) => typeof k2 === 'string' && k2.length <= 300).map(([k2, v]) => [k2, oneOf(v, SHAPES, 'quadratic')])) };
  },
  Options: ({ options: o, set, ctx, disabled }) => {
    const paths = pathsOf(ctx);
    return (
      <>
        <p className="hint" style={{ marginTop: 0 }}>Works on the construct scores of the current PLS-SEM results (calculated first when needed). Choose each path’s shape:</p>
        {!paths.length && <p className="hint">Calculate the PLS-SEM model to list its paths.</p>}
        {paths.map(({ from, to }) => (
          <div className="field" key={key(from, to)}>
            <label htmlFor={`warp-${from}-${to}`}>{from} → {to}</label>
            <select id={`warp-${from}-${to}`} className="select" disabled={disabled} value={shapeOf(o, from, to)} onChange={(e) => set({ shapes: { ...o.shapes, [key(from, to)]: oneOf(e.target.value, SHAPES, 'quadratic') } })}>
              {SHAPES.map((s) => <option key={s} value={s}>{SHAPE_LABEL[s]}</option>)}
            </select>
          </div>
        ))}
      </>
    );
  },
  View,
  blocked: (_o, ctx) => {
    if (ctx.settings.method !== 'pls') return 'This works on PLS-SEM models: switch the model to PLS-SEM (Model tab).';
    if (!ctx.model?.paths.length) return 'Draw a PLS path model first (Model tab).';
    if (ctx.model.moderations.length || ctx.model.copulas?.length || ctx.model.threeWay?.length) return 'This works on models without interaction or copula terms (the curves replace them).';
    if (!ctx.pls) return 'Calculate the PLS-SEM model first (Model tab).';
    return null;
  },
  fingerprint: (o, ctx) => {
    if (!ctx.pls) return null;
    const s = sourceFingerprint('scores', ctx, ctx.pls.constructs);
    return s && fingerprint([s, JSON.stringify(ctx.pls.hasPath), JSON.stringify(ctx.pls.pathCoef), JSON.stringify(pathsOf(ctx).map((p) => shapeOf(o, p.from, p.to)))]);
  },
  run: async (o, ctx) => analyseNonlinear(ctx.pls!, o),
  summary: (o) => { const n = Object.values(o.shapes).filter((s) => s === 'linear').length; return n ? `${n} linear path${n > 1 ? 's' : ''}, the others curved` : 'curved paths'; },
};
