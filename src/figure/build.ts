// The figure of a model: every shape and arrow of the diagram, with the
// estimates a caller supplies. The canvas (its labels and the figure export)
// and the PLS-SEM vs CB-SEM comparison card both draw from it, so the two can
// never show different diagrams.

import { copulaLayout } from '../components/CopulaLayer';
import { covarianceLayout } from '../components/CovarianceLayer';
import { heldLoading } from '../diagramLabels';
import { constructGeometry, interceptSegment, meanSegment, moderatorSegment, pathOffset, pathSegment, quadraticLoop } from '../geometry';
import { impliedIntercepts, impliedMainEffects, type Method } from '../model/project';
import type { PlacedModel } from '../placement';
import type { FigureInput, FigureLabel } from './render';

type Estimate = { value: number | null; p?: number | null } | null | undefined;
type Coefficient = { beta: number | null; p?: number | null } | null | undefined;
export type CorrelationKey = ReturnType<typeof covarianceLayout>['curves'][number]['k'];

/** The estimates shown on the figure; a missing lookup draws the shape without a label. */
export interface FigureValues {
  indicator?: (name: string, construct: string) => number | null;
  /** Loadings shown as fixed (drawn as such) beyond the model's own held ones. */
  fixed?: (name: string) => boolean;
  r2?: (construct: string) => number | null;
  path?: (from: string, to: string) => Coefficient;
  moderation?: (id: string) => Coefficient;
  higherOrder?: (parent: string, child: string) => { value: number; fixed: boolean } | null;
  /** Error variance of an indicator or a construct's disturbance. */
  error?: (kind: 'indicator' | 'construct', name: string) => number | null;
  correlation?: (k: CorrelationKey) => Estimate;
  mean?: (name: string) => Estimate;
  copula?: (from: string, to: string) => Coefficient;
}

export interface FigureOptions {
  showErrors: boolean;
  showIntercepts?: boolean;
  showImpliedEffects?: boolean;
  /** Unstandardised estimates: no reliabilities (1 − error variance) beside the error terms. */
  unstd?: boolean;
}

const label = (v: number | null | undefined, p: number | null = null, fixed = false): FigureLabel | null => (v === null || v === undefined ? null : { value: v, p, fixed });

/** The figure of a model placed for this figure (placement.ts: circles, shown boxes), with these estimates. */
export function buildFigureInput(m: PlacedModel, method: Method, values: FigureValues, opts: FigureOptions): FigureInput {
  const byId = new Map(m.constructs.map((c) => [c.id, c]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const constructs = m.constructs.map((c) => {
    const esem = !!m.esem?.blocks.some((b) => b.constructs.includes(c.id));
    const indicators = c.indicators.map((name) => {
      const v = values.indicator?.(name, c.name) ?? null;
      const held = heldLoading(c, method, name, esem);
      const fixed = !!values.fixed?.(name) || held !== undefined;
      return v === null ? (held !== undefined ? { value: held, p: null, fixed: true } : null) : { value: v, p: null, fixed };
    });
    // CPA: observed variables (single items, mean scores) are drawn as rectangles, latent ones as ellipses.
    const observed = method === 'process' && !(c.latent && c.indicators.length > 1);
    return { c, geom: constructGeometry(c), r2: values.r2?.(c.name) ?? null, indicators, ...(observed ? { observed } : {}) };
  });
  // The moderators' implied main effects (dashed), when shown.
  const impliedPaths = opts.showImpliedEffects ? impliedMainEffects(m).map((e) => ({ id: '', from: e.from, to: e.to, implied: true })) : [];
  const paths = [...m.paths, ...impliedPaths].flatMap((p) => {
    const s = byId.get(p.from), t = byId.get(p.to);
    const seg = s && t ? pathSegment(s, t, pathOffset(m.paths, p.from, p.to)) : null;
    if (!seg) return [];
    const l = values.path?.(nameOf(p.from), nameOf(p.to));
    return [{ key: 'implied' in p ? `implied:${p.from}:${p.to}` : p.id, ...seg, label: label(l?.beta, l?.p ?? null), ...('line' in p && p.line ? { line: p.line } : {}), ...('curved' in p && p.curved ? { curved: true } : {}), moderated: m.moderations.some((mo) => mo.path === p.id), ...('implied' in p ? { implied: true } : {}) }];
  });
  const moderations = m.moderations.flatMap((mo) => {
    const p = m.paths.find((q) => q.id === mo.path);
    const s = p && byId.get(p.from), t = p && byId.get(p.to), mod = byId.get(mo.moderator);
    // (a reciprocal pair: each arrow on its own side, as the moderator layer draws it)
    const seg = s && t ? pathSegment(s, t, pathOffset(m.paths, p!.from, p!.to)) : null;
    if (!seg || !mod) return [];
    const l = values.moderation?.(mo.id);
    if (mod.id === p!.from) {
      const q = quadraticLoop(mod, seg);
      return [{ key: `mod:${mo.id}`, x1: q.x1, y1: q.y1, x2: q.x2, y2: q.y2, label: label(l?.beta, l?.p ?? null), loop: { ...q, tag: `${mod.name}²` } }];
    }
    return [{ key: `mod:${mo.id}`, ...moderatorSegment(mod, seg), label: label(l?.beta, l?.p ?? null) }];
  });
  const higherOrder = m.constructs.flatMap((parent) => (parent.components ?? []).flatMap((cid) => {
    const child = byId.get(cid);
    const seg = child ? (parent.type === 'composite' ? pathSegment(child, parent) : pathSegment(parent, child)) : null;
    if (!seg || !child) return [];
    const l = values.higherOrder?.(parent.name, child.name);
    return [{ key: `ho:${parent.id}:${cid}`, ...seg, label: l ? { value: l.value, p: null, fixed: l.fixed } : null }];
  }));
  const cov = covarianceLayout(m, method === 'cbsem', opts.showErrors);
  // (direct effects on indicators: drawn as arrows like a higher-order loading)
  higherOrder.push(...cov.sharedLoadings.map((d) => {
    const c = byId.get(d.construct)!;
    const v = values.indicator?.(d.indicator, c.name) ?? heldLoading(c, method, d.indicator) ?? null;
    return { key: `shared:${d.construct}:${d.indicator}`, x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, label: v === null ? null : { value: v, p: null, fixed: false } };
  }));
  higherOrder.push(...cov.direct.map((d) => ({ key: `ip:${d.p.id}`, x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2, label: null })));
  const reliability = (value: number | null) => (value === null || opts.unstd ? null : 1 - value);
  const errors = [
    ...[...cov.places.entries()].map(([name, { term }]) => {
      const value = values.error?.('indicator', name) ?? null;
      return { term, kind: 'indicator' as const, value, name, r2: reliability(value) };
    }),
    ...cov.disturbances.map(({ c, term }) => {
      const value = values.error?.('construct', c.name) ?? null;
      return { term, kind: 'disturbance' as const, value, r2: reliability(value) };
    }),
  ];
  const correlations = cov.curves.map(({ k, curve }) => {
    const l = values.correlation?.(k);
    return { d: curve.d, heads: curve.heads, lx: curve.lx, ly: curve.ly, nx: curve.nx, ny: curve.ny,
      points: [[curve.x1, curve.y1], [curve.x2, curve.y2], [curve.lx, curve.ly]] as [number, number][], label: label(l?.value, l?.p ?? null) };
  });
  // The constant and its arrows (means and intercepts).
  const constant = m.constant;
  const means = constant ? (m.means ?? []).flatMap((t) => {
    const c = byId.get(t.target);
    const seg = c && meanSegment(constant, c);
    if (!seg) return [];
    const l = values.mean?.(c.name);
    return [{ key: `mean:${t.id}`, ...seg, label: label(l?.value ?? (t.fixed !== undefined ? t.fixed : null), l?.p ?? null, t.fixed !== undefined && l == null) }];
  }) : [];
  const intercepts = constant && opts.showIntercepts ? impliedIntercepts(m).flatMap((e) => {
    const c = byId.get(e.construct);
    const box = c && constructGeometry(c).indicators.find((b) => b.name === e.indicator);
    const seg = c && box && interceptSegment(constant, c, box);
    if (!seg) return [];
    const l = values.mean?.(e.indicator);
    return [{ key: `intercept:${e.construct}:${e.indicator}`, ...seg, label: label(l?.value ?? null, l?.p ?? null) }];
  }) : [];
  const copulas = copulaLayout(m).map((g) => ({
    cx: g.cx, cy: g.cy,
    targets: g.targets.map((t) => {
      const l = values.copula?.(nameOf(g.from), nameOf(t.to));
      return { x1: t.x1, y1: t.y1, x2: t.x2, y2: t.y2, label: label(l?.beta, l?.p ?? null) };
    }),
  }));
  return { method, ...(m.notes?.length ? { notes: m.notes.map((k) => ({ x: k.x, y: k.y, text: k.text })) } : {}), constructs, paths, moderations, higherOrder, errors, correlations, ...(copulas.length ? { copulas } : {}), ...(constant && (means.length || intercepts.length) ? { constant, means, intercepts } : {}) };
}
