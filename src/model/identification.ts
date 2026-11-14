// Identification checks run before a CB-SEM estimation (part of validateModel): a factor with two
// indicators and nothing else to identify it, a second-order factor on two first-order factors,
// more free parameters than variances and covariances (df < 0), fewer clusters than between-level
// parameters, and WLSMV without ordinal indicators. Errors only where the model cannot be
// identified at all; warnings where identification depends on the data or on constraints.
//
// Rules: Bollen (1989, ch. 7: the t-rule, the three- and two-indicator rules); Rindskopf & Rose
// (1988) for second-order factors.

import { buildCbModel } from '../engine/cbsem';
import type { Dataset } from '../engine/types';
import { toSpec, usesConstraints } from './project';
import type { Construct, Issue, ModelState, Settings } from './project';

type IdSettings = Pick<Settings, 'method'> & Partial<Pick<Settings, 'estimator' | 'engine'>>;

/** Whether a construct takes part in anything beyond its own indicators. */
function related(model: ModelState, c: Construct): boolean {
  const touchesPath = model.paths.some((p) => p.from === c.id || p.to === c.id);
  const correlated = (model.correlations ?? []).some(
    (k) => k.kind === 'construct' && !k.zero && (k.a === c.id || k.b === c.id),
  );
  const errorCorrelated = (model.correlations ?? []).some(
    (k) => k.kind === 'indicator' && (c.indicators.includes(k.a) || c.indicators.includes(k.b)),
  );
  const indicatorPath = (model.indicatorPaths ?? []).some(
    (p) => c.indicators.includes(p.from) || c.indicators.includes(p.to),
  );
  const hierarchical =
    (c.components?.length ?? 0) > 0 || model.constructs.some((k) => k.components?.includes(c.id));
  const moderated = (model.moderations ?? []).some((mo) => mo.moderator === c.id);
  const esem = (model.esem?.blocks ?? []).some((b) => b.constructs.includes(c.id));
  const shared = model.constructs.some(
    (k) => k.id !== c.id && k.indicators.some((i) => c.indicators.includes(i)),
  );
  return (
    touchesPath ||
    correlated ||
    errorCorrelated ||
    indicatorPath ||
    hierarchical ||
    moderated ||
    esem ||
    shared
  );
}

/** Whether constraints on the factor's own parameters could identify it (fixed or equal loadings, known reliabilities, held values). */
function constrained(model: ModelState, c: Construct): boolean {
  const fixed = Object.keys(c.fixedLoadings ?? {}).length > 0;
  const labels = Object.values(c.loadingLabels ?? {});
  const equal = new Set(labels).size < labels.length;
  const reliabilities = Object.keys(c.reliabilities ?? {}).length > 0;
  const held = (model.parameters ?? []).some(
    (t) => t.target === c.id || c.indicators.includes(t.target),
  );
  return fixed || equal || reliabilities || held || !!model.inequalities?.trim();
}

/**
 * A CB-SEM factor with exactly two indicators and no relation to any other construct, and no
 * constraint on its own parameters: it is not identified (four free parameters for three moments;
 * Bollen 1989, the two-indicator rule needs a correlation with another factor).
 */
export function isolatedTwoIndicatorFactor(model: ModelState, c: Construct): boolean {
  return (
    c.type === 'factor' &&
    c.indicators.length === 2 &&
    !c.covariate &&
    !related(model, c) &&
    !constrained(model, c)
  );
}

/** A second-order factor on exactly two first-order factors with neither loading held at a value. */
function twoComponentIssues(model: ModelState): Issue[] {
  const out: Issue[] = [];
  for (const c of model.constructs) {
    if (c.components?.length !== 2) continue;
    if (Object.keys(c.componentLoadings ?? {}).length) continue;
    const linked = model.paths.some((p) => p.from === c.id || p.to === c.id);
    const how = linked
      ? 'Here it is identified only through its paths to other constructs, which must not be close to zero.'
      : 'Hold its two loadings equal or at a value, or measure it by three or more first-order factors.';
    out.push({
      level: 'warning',
      message: `"${c.name}" is a second-order factor on two first-order factors: on its own it is not identified, since three or more are needed (Rindskopf & Rose, 1988). ${how}`,
      constructId: c.id,
    });
  }
  return out;
}

/** What estimateCb's model builder covers exactly: one group and level, no mean structure, ESEM, composites, constraints or interactions. */
function plainModel(model: ModelState): boolean {
  return (
    !model.multigroup &&
    !model.multilevel &&
    !model.esem?.blocks.length &&
    !model.moderations.length &&
    !model.constant &&
    !model.means?.length &&
    !model.ordered?.length &&
    !model.indicatorPaths?.length &&
    !model.parameters?.length &&
    !model.threeWay?.length &&
    !model.copulas?.length &&
    !Object.keys(model.count ?? {}).length &&
    !usesConstraints(model) &&
    model.constructs.every(
      (c) =>
        c.type === 'factor' &&
        c.reliability === undefined &&
        !c.freeError &&
        !Object.keys(c.loadingLabels ?? {}).length &&
        !Object.keys(c.reliabilities ?? {}).length,
    )
  );
}

/** The free parameters and the moments of a plain model (as the built-in engine counts them), or null. */
export function parameterCount(model: ModelState): { free: number; moments: number } | null {
  if (!plainModel(model)) return null;
  try {
    const cm = buildCbModel(toSpec(model));
    const kx = cm.covariates.length;
    const moments = (cm.p * (cm.p + 1)) / 2 - (kx * (kx + 1)) / 2;
    return { free: cm.params.length, moments };
  } catch {
    // (a model the builder refuses is reported by the other checks)
    return null;
  }
}

/** df < 0: more free parameters than variances and covariances (Bollen 1989, the t-rule). */
function negativeDfIssues(model: ModelState): Issue[] {
  const n = parameterCount(model);
  if (!n || n.free <= n.moments) return [];
  return [
    {
      level: 'error',
      message: `The model has ${n.free} free parameters but only ${n.moments} variances and covariances to estimate them from (df = ${n.moments - n.free}): it is not identified (Bollen, 1989, the t-rule). Remove paths or correlations, or add indicators.`,
    },
  ];
}

/** About how many parameters the between level of a two-level model has (intercepts included), or null. */
export function betweenParameterCount(model: ModelState): number | null {
  const ml = model.multilevel;
  if (!ml) return null;
  // (observed covariates are within-level variables or fixed: no between-level parameters of their own)
  const measured = model.constructs.filter((c) => !c.covariate);
  const p = new Set(measured.flatMap((c) => c.indicators)).size;
  if (ml.between === 'saturated') return (p * (p + 1)) / 2 + p;
  if (ml.between !== 'same' && ml.between !== 'factors') return null;
  const within: ModelState = { ...model, multilevel: undefined };
  // (the factors model: the factors' measurement part, then their regressions on the cluster covariates)
  const keep = new Set(measured.map((c) => c.id));
  const between: ModelState =
    ml.between === 'factors'
      ? {
          ...within,
          constructs: measured,
          paths: [],
          moderations: [],
          correlations: (model.correlations ?? []).filter(
            (k) => k.kind === 'indicator' || (keep.has(k.a) && keep.has(k.b)),
          ),
        }
      : within;
  const n = parameterCount(between);
  if (!n) return null;
  const factors = measured.filter((c) => c.indicators.length > 1).length;
  const covariates = ml.between === 'factors' ? (ml.betweenCovariates?.length ?? 0) : 0;
  return n.free + p + covariates * factors;
}

/** Fewer clusters than between-level parameters: the between-level estimates and tests are not trustworthy. */
function clusterIssues(model: ModelState, data: Dataset | null): Issue[] {
  const ml = model.multilevel;
  if (!ml || !data || data.moments) return [];
  const col = data.cols[data.names.indexOf(ml.column)];
  if (!col) return [];
  const clusters = new Set(Array.from(col).filter((x) => !Number.isNaN(x))).size;
  const params = betweenParameterCount(model);
  if (params === null || clusters < 2 || clusters >= params) return [];
  return [
    {
      level: 'warning',
      message: `${clusters} clusters for about ${params} between-level parameters: with fewer clusters than between-level parameters the between-level standard errors and χ² are not trustworthy. Simplify the between level (e.g. fewer free parameters or a saturated between model only when the clusters allow it), or collect more clusters (Maas & Hox, 2005).`,
    },
  ];
}

/** WLSMV with no ordinal indicator: lavaan then fits continuous data by DWLS, usually not what was meant. */
function wlsmvIssues(model: ModelState, method: IdSettings): Issue[] {
  // (the built-in engine refuses WLSMV already: checkCbsemEstimator)
  if (method.estimator !== 'WLSMV' || method.engine === 'builtin') return [];
  const assigned = new Set(model.constructs.flatMap((c) => c.indicators));
  if ((model.ordered ?? []).some((i) => assigned.has(i))) return [];
  return [
    {
      level: 'warning',
      message:
        'WLSMV is chosen but no indicator is marked ordinal: lavaan then treats the data as continuous and fits them by diagonally weighted least squares. For Likert items with few categories, mark them ordinal (Data tab); for continuous, non-normal data, MLR is the usual choice.',
    },
  ];
}

/** The identification issues of a CB-SEM model, in display order (the two-indicator rule is in checkComponentsOrIndicators). */
export function identificationIssues(
  model: ModelState,
  data: Dataset | null,
  method: IdSettings,
): Issue[] {
  if (method.method !== 'cbsem' || method.estimator === '2SLS') return [];
  return [
    ...twoComponentIssues(model),
    ...negativeDfIssues(model),
    ...clusterIssues(model, data),
    ...wlsmvIssues(model, method),
  ];
}
