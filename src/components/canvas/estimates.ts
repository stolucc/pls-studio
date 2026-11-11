// The estimates the diagram shows, for whichever method produced the results: per construct and indicator, per
// arrow, and the CB-SEM (co)variances. Shared by the canvas's nodes, edges and layers and its figure export.

import { useCallback, useMemo } from 'react';
import type { Construct, Correlation, Method, ModelState, Settings } from '../../model/project';
import { useStore, type Results } from '../../store';
import type { CorrelationLabel } from '../CovarianceLayer';
import type { HoLabel } from '../HigherOrderLayer';
import type { ModerationLabel } from '../ModeratorLayer';

/** Per-construct and per-indicator numbers to draw, for whichever method produced results (null: nothing to show). */
export function diagramEstimates(
  results: Results | null,
  showResults: boolean,
  method: Method,
  estimator: Settings['estimator'],
  constructs: Construct[],
  unstd: boolean,
) {
  if (!showResults || !results) return null;
  if (method === 'cbsem' && estimator === '2SLS' && results.miiv) {
    // MIIV-2SLS: unstandardised coefficients; standardised ones when the R engine supplied them (MIIVsem + lavaan).
    const miiv = results.miiv;
    const est = miiv.estimates;
    const std = !unstd && est.some((e) => e.std !== undefined);
    const val = (e: { est: number; std?: number }) => (std ? (e.std ?? null) : e.est);
    const loadingOf = new Map<string, number | null>(
      est.filter((e) => e.op === '=~').map((e) => [e.rhs, val(e)]),
    );
    const markers = new Set(
      constructs.flatMap((k) => (k.indicators.length > 1 ? [k.indicators[0]] : [])),
    );
    for (const m of markers) loadingOf.set(m, std ? (miiv.fixedStd?.[m] ?? null) : 1);
    return {
      r2: (name: string) => (std || miiv.r2 ? (miiv.r2?.[name] ?? null) : null),
      indicator: (name: string) => loadingOf.get(name) ?? null,
      fixed: (name: string) => markers.has(name),
      reflectiveThresholds: () => std,
      moderation: (): ModerationLabel | null => null,
      path: (from: string, to: string) => {
        const e = est.find((x) => x.op === '~' && x.lhs === to && x.rhs === from);
        return { beta: e ? val(e) : null, p: e ? e.p : null };
      },
    };
  }
  if (method === 'cbsem' && results.cb) {
    const cb = results.cb;
    // Standardised (std.all) or unstandardised estimates, as chosen on the canvas.
    const ind = new Map(cb.indicators.map((x, k) => [x.name, k]));
    const loading = (name: string) => {
      const k = ind.get(name);
      return k === undefined
        ? undefined
        : cb.estimates.find(
            (e) =>
              (e.op === '=~' || e.op === '<~') &&
              e.rhs === name &&
              e.lhs === cb.constructs[cb.indicators[k].construct],
          );
    };
    return {
      r2: (name: string) => {
        const j = cb.constructs.indexOf(name);
        return j >= 0 ? cb.r2Constructs[j] : null;
      },
      indicator: (name: string, construct?: string) => {
        const k = ind.get(name);
        if (k === undefined) return null;
        // An indicator of several factors: this factor's loading.
        const own = construct
          ? cb.estimates.find((x) => x.op === '=~' && x.lhs === construct && x.rhs === name)
          : undefined;
        if (own && cb.estimates.filter((x) => x.op === '=~' && x.rhs === name).length > 1)
          return unstd ? own.est : own.std;
        // Composites show their weights (as in PLS), common factors their loadings.
        const e = loading(name);
        return unstd ? (e?.est ?? null) : e?.op === '<~' ? e.std : cb.stdLoadings[k];
      },
      fixed: (name: string) =>
        loading(name)?.kind === 'fixed-loading' || loading(name)?.kind === 'fixed-weight',
      reflectiveThresholds: () => !unstd,
      moderation: (from: string, moderator: string, to: string): ModerationLabel | null => {
        const mo = cb.moderations.find(
          (x) => x.from === from && x.moderator === moderator && x.to === to,
        );
        if (!mo) return null;
        const name = cb.constructs[mo.construct];
        const e = cb.estimates.find((x) => x.op === '~' && x.lhs === to && x.rhs === name);
        return { beta: e ? (unstd ? e.est : e.std) : null, p: e?.p ?? null };
      },
      path: (from: string, to: string) => {
        const i = cb.constructs.indexOf(from),
          j = cb.constructs.indexOf(to);
        if (i < 0 || j < 0) return { beta: null, p: null };
        const boot = results.boot?.stats.find((s) => s.key === `path:${from}:${to}`)?.p;
        const e = cb.estimates.find((x) => x.op === '~' && x.lhs === to && x.rhs === from);
        return { beta: unstd ? (e?.est ?? null) : cb.stdPaths[i][j], p: boot ?? e?.p ?? null };
      },
      // A mean is in the variable's units; the standardised form (mean / SD) is what lavaan's std.all gives.
      mean: (name: string) => {
        const e = cb.estimates.find(
          (x) => (x.kind === 'mean' || x.kind === 'intercept') && x.lhs === name,
        );
        return e ? { value: unstd ? e.est : e.std, p: e.p } : null;
      },
    };
  }
  if (method === 'process' && results.process) {
    // Unstandardised OLS coefficients: a path shows the coefficient of its predictor in the
    // outcome's equation (the effect where the moderators are 0), a moderation its product term.
    const eqs = results.process.equations;
    const coef = (to: string, vars: string[]) => {
      const k = [...vars].sort().join('*');
      return eqs
        .find((e) => e.outcome === to)
        ?.coefficients.find((c) => [...c.term].sort().join('*') === k);
    };
    return {
      r2: (name: string) => eqs.find((e) => e.outcome === name)?.r2 ?? null,
      indicator: () => null,
      reflectiveThresholds: () => false,
      path: (from: string, to: string) => {
        const c = coef(to, [from]);
        return { beta: c?.est ?? null, p: c?.p ?? null };
      },
      moderation: (from: string, moderator: string, to: string): ModerationLabel | null => {
        const c = coef(to, [from, moderator]);
        return c ? { beta: c.est, p: c.p } : null;
      },
      threeWay: (from: string, w: string, z: string, to: string): ModerationLabel | null => {
        const c = coef(to, [from, w, z]);
        return c ? { beta: c.est, p: c.p } : null;
      },
    };
  }
  if (method === 'pls' && results.pls) {
    const pls = results.pls;
    const idx = new Map(pls.indicators.map((x, k) => [x.name, k]));
    const typeOf = new Map(constructs.map((c) => [c.name, c.type]));
    return {
      r2: (name: string) => {
        const j = pls.constructs.indexOf(name);
        return j >= 0 ? pls.rSquared[j] : null;
      },
      indicator: (name: string) => {
        const k = idx.get(name);
        if (k === undefined) return null;
        return typeOf.get(pls.constructs[pls.indicators[k].construct]) === 'composite'
          ? pls.weights[k]
          : pls.loadings[k];
      },
      reflectiveThresholds: (type: string) => type === 'factor',
      path: (from: string, to: string) => {
        const i = pls.constructs.indexOf(from),
          j = pls.constructs.indexOf(to);
        return {
          beta: i >= 0 && j >= 0 ? pls.pathCoef[i][j] : null,
          p: results.boot?.stats.find((s) => s.key === `path:${from}:${to}`)?.p ?? null,
        };
      },
      moderation: (from: string, moderator: string, to: string): ModerationLabel | null => {
        const mo = pls.moderations.find(
          (x) => x.from === from && x.moderator === moderator && x.to === to,
        );
        if (!mo) return null;
        const name = pls.constructs[mo.construct],
          j = pls.constructs.indexOf(to);
        return {
          beta: pls.pathCoef[mo.construct][j],
          p: results.boot?.stats.find((s) => s.key === `path:${name}:${to}`)?.p ?? null,
        };
      },
      threeWay: (
        from: string,
        moderator: string,
        moderator2: string,
        to: string,
      ): ModerationLabel | null => {
        const t = pls.threeWay?.find(
          (x) =>
            x.from === from &&
            x.moderator === moderator &&
            x.moderator2 === moderator2 &&
            x.to === to,
        );
        if (!t) return null;
        const name = pls.constructs[t.construct],
          j = pls.constructs.indexOf(to);
        return {
          beta: pls.pathCoef[t.construct][j],
          p: results.boot?.stats.find((s) => s.key === `path:${name}:${to}`)?.p ?? null,
        };
      },
    };
  }
  return null;
}

/** The diagram's estimates and the lookups of each kind of label, memoised for the canvas. */
export function useEstimateLabels(
  model: ModelState,
  method: Method,
  estimator: Settings['estimator'],
  results: Results | null,
  showResults: boolean,
  unstd: boolean,
) {
  const st = useStore.getState;
  const display = useMemo(
    () => diagramEstimates(results, showResults, method, estimator, model.constructs, unstd),
    [showResults, results, method, model.constructs, estimator, unstd],
  );
  /** CB-SEM estimates of correlations and error variances (standardised). */
  const cbEst =
    showResults && method === 'cbsem' && estimator !== '2SLS' ? (results?.cb ?? null) : null;
  // MIIV-2SLS (R engine): (co)variances from MIIVsem's var.cov step, without standard errors.
  const miivVar =
    showResults && method === 'cbsem' && estimator === '2SLS'
      ? (results?.miiv?.variances ?? null)
      : null;
  const correlationLabel = useCallback(
    (k: Correlation): CorrelationLabel | null => {
      const nameOf = (id: string) =>
        k.kind === 'construct' ? model.constructs.find((c) => c.id === id)?.name : id;
      const a = nameOf(k.a),
        b = nameOf(k.b);
      if (miivVar) {
        const v = miivVar.find(
          (x) =>
            x.lhs !== x.rhs &&
            x.latent === (k.kind === 'construct') &&
            ((x.lhs === a && x.rhs === b) || (x.lhs === b && x.rhs === a)),
        );
        return v ? { value: unstd ? v.est : v.std, p: null } : null;
      }
      if (!cbEst) return null;
      const e = cbEst.estimates.find(
        (x) =>
          x.op === '~~' &&
          x.lhs !== x.rhs &&
          ((x.lhs === a && x.rhs === b) || (x.lhs === b && x.rhs === a)) &&
          (k.kind === 'indicator' ? x.kind === 'rescov' : x.kind !== 'rescov'),
      );
      return e ? { value: unstd ? e.est : e.std, p: e.p } : null;
    },
    [cbEst, miivVar, model.constructs, unstd],
  );
  const errorValue = useCallback(
    (kind: Correlation['kind'], name: string): number | null => {
      if (miivVar) {
        const v = miivVar.find(
          (x) => x.lhs === name && x.rhs === name && x.latent === (kind === 'construct'),
        );
        return v ? (unstd ? v.est : v.std) : null;
      }
      if (!cbEst) return null;
      const e = cbEst.estimates.find(
        (x) =>
          x.lhs === name &&
          x.rhs === name &&
          x.op === '~~' &&
          (kind === 'indicator' ? x.kind === 'residual' : x.kind === 'lvcov'),
      );
      return e ? (unstd ? e.est : e.std) : null;
    },
    [cbEst, miivVar, unstd],
  );

  // The estimate of a mean arrow (CB-SEM results only).
  const meanOf = useCallback(
    (name: string): { value: number | null; p: number | null } | null =>
      display && 'mean' in display && typeof display.mean === 'function'
        ? display.mean(name)
        : null,
    [display],
  );

  const moderationLabel = useCallback(
    (id: string): ModerationLabel | null => {
      if (!display) return null;
      const m = st().model;
      const three = m.threeWay?.find((t) => t.id === id);
      const mo = m.moderations.find((x) => x.id === (three ? three.moderation : id));
      const p = mo && m.paths.find((q) => q.id === mo.path);
      if (!mo || !p) return null;
      const name = (cid: string) => m.constructs.find((c) => c.id === cid)?.name ?? '';
      if (three)
        return (
          display.threeWay?.(name(p.from), name(mo.moderator), name(three.moderator), name(p.to)) ??
          null
        );
      return display.moderation(name(p.from), name(mo.moderator), name(p.to));
    },
    [display, st],
  );

  const hoLoading = useCallback(
    (parent: string, child: string): HoLabel | null => {
      if (method === 'pls') {
        // Second-order PLS construct: weights into a composite, loadings of a common factor (as for indicators).
        const pls = showResults ? results?.pls : null;
        const h = pls?.higherOrder?.find(
          (x) => pls.constructs[x.construct] === parent && pls.constructs[x.component] === child,
        );
        if (!h) return null;
        return {
          value:
            model.constructs.find((k) => k.name === parent)?.type === 'composite'
              ? h.weight
              : h.loading,
          fixed: false,
        };
      }
      if (method !== 'cbsem') return null;
      const par = model.constructs.find((k) => k.name === parent),
        kid = model.constructs.find((k) => k.name === child);
      const held = kid && par?.componentLoadings?.[kid.id];
      const isMarker = par?.components?.[0] === kid?.id && !par?.markerFree;
      const marker =
        held !== undefined
          ? { value: held, fixed: true }
          : isMarker
            ? { value: 1, fixed: true }
            : null;
      if (!showResults) return marker;
      if (estimator === '2SLS') {
        const m = results?.miiv;
        const e = m?.estimates.find((x) => x.op === '=~' && x.lhs === parent && x.rhs === child);
        if (e) return { value: !unstd && e.std !== undefined ? e.std : e.est, fixed: false };
        const fs = m?.fixedStd?.[child];
        return marker && !unstd && fs !== undefined ? { value: fs, fixed: true } : marker;
      }
      const e = results?.cb?.estimates.find(
        (x) => x.op === '=~' && x.lhs === parent && x.rhs === child,
      );
      return e ? { value: unstd ? e.est : e.std, fixed: e.kind === 'fixed-loading' } : marker;
    },
    [showResults, method, results, estimator, model.constructs, unstd],
  );

  return { display, correlationLabel, errorValue, meanOf, moderationLabel, hoLoading };
}
