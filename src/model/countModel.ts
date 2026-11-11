// CB-SEM models with count indicators (ModelState.count): lavaan has no count outcomes, so the diagram is written in
// the Integration ML card's Mplus syntax (analyses/quadmlSyntax.ts) and estimated by its numerical integration
// (rengine/R/quadml.R). This module decides whether a diagram can be written that way, and writes it: every factor
// pair the diagram leaves uncorrelated is written @0 (the card's defaults correlate them, as Mplus's do), a free latent
// mean fixes its marker's intercept at 0 (as the canvas does for lavaan), and what the engine does not fit (groups,
// levels, robust estimators other than MLR, imputation, composites, interactions, …) is refused with a reason.

import {
  COUNT_KINDS,
  endogenousIds,
  type Construct,
  type CountKind,
  type ModelState,
  type Settings,
} from './project';

export const COUNT_NAMES: Record<CountKind, string> = {
  poisson: 'Poisson',
  nb: 'negative binomial',
  zip: 'zero-inflated Poisson',
  zinb: 'zero-inflated negative binomial',
};
/** Short badges on the canvas. */
export const COUNT_BADGES: Record<CountKind, string> = {
  poisson: 'cnt',
  nb: 'nb',
  zip: 'zip',
  zinb: 'zinb',
};
/** Mplus's COUNT options. */
const MPLUS_COUNT: Record<CountKind, string> = { poisson: '', nb: 'nb', zip: 'i', zinb: 'nbi' };

/** The count indicators of the model (declared and still an indicator of some construct). */
export const countIndicators = (model: Pick<ModelState, 'constructs' | 'count'>): string[] =>
  Object.keys(model.count ?? {}).filter(
    (n) =>
      COUNT_KINDS.includes(model.count![n]) &&
      model.constructs.some((c) => c.indicators.includes(n)),
  );

export interface CountSyntax {
  /** The card's input: VARIABLE and ANALYSIS options, then MODEL. */
  syntax: string;
  /** The factors' names in the syntax (lower case, as the card reports them) back to the constructs' names. */
  names: Record<string, string>;
  /** Casewise deletion: the card drops the cases with a missing value in the model's columns first. */
  casewise: boolean;
}

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;
const RESERVED = new Set([
  'by',
  'on',
  'with',
  'xwith',
  'is',
  'are',
  'model',
  'variable',
  'analysis',
  'all',
  'off',
]);

/**
 * The diagram in the Integration ML card's syntax, or why it cannot be estimated that way. `columns`: the data's
 * column names (null without data).
 */
export function countModelSyntax(
  model: ModelState,
  settings: Pick<Settings, 'method' | 'estimator' | 'missing'>,
  columns: string[] | null,
  opts: { moments?: boolean } = {},
): CountSyntax | { error: string } {
  const err = (error: string) => ({ error });
  const counts = countIndicators(model);
  if (!counts.length)
    return err('No indicator is declared a count (right-click an indicator: Treat as count…).');
  if (settings.method !== 'cbsem')
    return err('Count indicators are a CB-SEM declaration: choose CB-SEM.');
  if (opts.moments) return err('Count indicators need raw data, not a covariance matrix.');
  if (settings.estimator !== 'ML' && settings.estimator !== 'MLR')
    return err(
      `With count indicators the model is estimated by maximum likelihood with numerical integration: choose ML, or MLR for robust (sandwich) standard errors, not ${settings.estimator}.`,
    );
  if (settings.missing !== 'casewise' && settings.missing !== 'fiml')
    return err(
      'With count indicators choose casewise deletion or FIML for missing values (FIML: every observed value, the missing ones integrated over); mean replacement, pairwise deletion, multiple imputation and the two-stage approaches are not available.',
    );
  if (model.multigroup)
    return err(
      'Multiple groups are not available with count indicators: the integration engine fits one group.',
    );
  if (model.multilevel) return err('Two-level models are not available with count indicators.');
  if (model.weights) return err('Sampling weights are not available with count indicators.');
  if (model.cluster)
    return err(
      'Sampling clusters (cluster-robust standard errors) are not available with count indicators.',
    );
  if (model.auxiliary?.length)
    return err('Auxiliary variables are not available with count indicators.');
  if (model.esem?.blocks.length) return err('ESEM blocks are not available with count indicators.');
  if (model.moderations.length || model.threeWay?.length)
    return err('Latent interactions (moderation arrows) are not available with count indicators.');
  if (model.defined?.length || model.waldTests?.length || model.inequalities?.trim())
    return err(
      'Defined parameters, Wald tests and inequality constraints are not available with count indicators.',
    );
  const ordered = new Set(model.ordered ?? []);
  const isCount = (n: string) => counts.includes(n);
  for (const n of counts)
    if (ordered.has(n)) return err(`${n} is declared both ordinal and a count.`);
  for (const c of model.constructs) {
    if (c.covariate && c.indicators.some(isCount))
      return err(
        `${c.indicators[0]} is an observed covariate (conditioned on, not modelled): a count declaration applies to indicators and outcomes.`,
      );
    if (c.type === 'composite')
      return err(
        `${c.name} is a composite: with count indicators every construct is a common factor.`,
      );
    if (c.components?.length)
      return err(`${c.name} is a higher-order factor: not available with count indicators.`);
    if (
      c.reliability !== undefined ||
      c.freeError ||
      c.markerFree ||
      (c.reliabilities && Object.keys(c.reliabilities).length)
    )
      return err(
        `${c.name}: known reliabilities, a free single-indicator error and a free marker are not available with count indicators.`,
      );
  }
  for (const t of model.parameters ?? [])
    if (t.byGroup?.length || t.free || t.kind === 'scale')
      return err(
        'Scale factors, freed defaults and values per group are not available with count indicators.',
      );
  for (const t of model.means ?? [])
    if (t.byGroup?.length || t.bias !== undefined)
      return err(
        'Mean values per group and measurement biases are not available with count indicators.',
      );
  for (const k of model.correlations ?? [])
    if (k.byGroup?.length)
      return err('Covariance values per group are not available with count indicators.');

  // Names: data columns as they are (the card reads plain names), factors renamed where needed.
  const byId = new Map(model.constructs.map((c) => [c.id, c]));
  const observedOf = (c: Construct) => c.covariate || c.indicators.length === 1;
  const used = [...new Set(model.constructs.flatMap((c) => c.indicators))];
  for (const n of used) {
    if (!IDENT.test(n) || RESERVED.has(n.toLowerCase()))
      return err(
        `The column “${n}” needs a plain name for the integration engine (letters, digits and _; starting with a letter): rename it on the Data tab.`,
      );
    if (columns && !columns.includes(n)) return err(`${n} is not a column of the data.`);
  }
  const lowerCols = new Set((columns ?? used).map((n) => n.toLowerCase()));
  const seen = new Map<string, string>();
  for (const n of columns ?? used) {
    const l = n.toLowerCase();
    if (seen.has(l) && seen.get(l) !== n && used.some((u) => u.toLowerCase() === l))
      return err(
        `The columns ${seen.get(l)} and ${n} differ only in case: rename one (the integration engine ignores case).`,
      );
    seen.set(l, n);
  }
  const fname = new Map<string, string>(),
    names: Record<string, string> = {};
  for (const c of model.constructs) {
    if (observedOf(c) || !c.indicators.length) continue;
    let base = (c.name.replace(/[^A-Za-z0-9_]/g, '_') || 'f')
      .replace(/^(?=[^A-Za-z])/, 'f')
      .toLowerCase();
    if (RESERVED.has(base)) base = `${base}_f`;
    let n = base,
      k = 2;
    while (lowerCols.has(n) || [...fname.values()].includes(n)) n = `${base}_${k++}`;
    fname.set(c.id, n);
    names[n] = c.name;
  }
  for (const c of model.constructs)
    if (!observedOf(c) && !c.indicators.length)
      return err(`${c.name} has no indicators: not available with count indicators.`);
  const node = (c: Construct) => (observedOf(c) ? c.indicators[0] : fname.get(c.id)!);
  const label = (l: string | undefined) => {
    if (!l) return '';
    if (!IDENT.test(l))
      throw new Error(
        `The label “${l}” needs a plain name (letters, digits and _) for the integration engine.`,
      );
    return ` (${l})`;
  };
  const at = (v: number | undefined) => (v === undefined ? '' : `@${v}`);

  try {
    const lines: string[] = [];
    // Measurement: one statement per indicator (the first one's loading fixed at 1 unless held or scaled by the variance).
    for (const c of model.constructs) {
      if (observedOf(c)) continue;
      const f = fname.get(c.id)!;
      c.indicators.forEach((i, k) => {
        const held = c.fixedLoadings?.[i];
        const free = held === undefined && (k > 0 || c.scaling === 'variance');
        lines.push(
          `${f} BY ${i}${held !== undefined ? at(held) : free ? '*' : ''}${held === undefined ? label(c.loadingLabels?.[i]) : ''};`,
        );
      });
      if (c.scaling === 'variance') lines.push(`${f}@1;`);
    }
    // Structural paths and direct effects on indicators.
    for (const p of model.paths) {
      const a = byId.get(p.from),
        b = byId.get(p.to);
      if (!a || !b) continue;
      if (a.indicators.length === 1 && !a.covariate && isCount(a.indicators[0]))
        throw new Error(
          `${a.indicators[0]} is a count: regressions on count variables are not fitted (a count is an outcome or an indicator).`,
        );
      lines.push(
        `${node(b)} ON ${node(a)}${at(p.fixed)}${p.fixed === undefined ? label(p.label) : ''};`,
      );
    }
    for (const p of model.indicatorPaths ?? []) {
      const a = byId.get(p.from);
      if (a)
        lines.push(
          `${p.to} ON ${node(a)}${at(p.fixed)}${p.fixed === undefined ? label(p.label) : ''};`,
        );
    }
    // Covariances: as drawn; every other pair of factors the engine would correlate by default fixed at 0.
    const drawn = new Set<string>();
    const key = (a: string, b: string) => [a, b].sort().join('|');
    for (const k of model.correlations ?? []) {
      if (k.kind === 'construct') {
        const a = byId.get(k.a),
          b = byId.get(k.b);
        if (!a || !b) continue;
        if (a.covariate || b.covariate) {
          if (a.covariate && b.covariate) continue;
          throw new Error(
            `${a.covariate ? a.indicators[0] : b.indicators[0]} is an observed covariate: the integration engine conditions on covariates, so covariances with them are not estimated.`,
          );
        }
        drawn.add(key(a.id, b.id));
        lines.push(
          `${node(a)} WITH ${node(b)}${k.zero ? '@0' : at(k.fixed)}${k.zero || k.fixed !== undefined ? '' : label(k.label)};`,
        );
      } else {
        if (isCount(k.a) || isCount(k.b))
          throw new Error(
            `${isCount(k.a) ? k.a : k.b} is a count: its errors cannot be correlated (count indicators are independent given the factors).`,
          );
        lines.push(
          `${k.a} WITH ${k.b}${at(k.fixed)}${k.fixed === undefined ? label(k.label) : ''};`,
        );
      }
    }
    const endo = endogenousIds(model);
    const factors = model.constructs.filter((c) => !observedOf(c));
    for (let i = 0; i < factors.length; i++)
      for (let j = i + 1; j < factors.length; j++) {
        const a = factors[i],
          b = factors[j];
        if (endo.has(a.id) === endo.has(b.id) && !drawn.has(key(a.id, b.id)))
          lines.push(`${node(a)} WITH ${node(b)}@0;`);
      }
    // Means (with the constant): a free latent mean fixes its marker's intercept at 0.
    const intercepts = new Set(
      (model.parameters ?? [])
        .filter((t) => t.kind === 'intercept' && t.indicator)
        .map((t) => t.target),
    );
    if (model.constant)
      for (const m of model.means ?? []) {
        const c = byId.get(m.target);
        if (!c || c.covariate) continue;
        lines.push(`[${node(c)}${at(m.fixed)}]${m.fixed === undefined ? label(m.label) : ''};`);
        if (m.fixed === undefined && !observedOf(c) && !intercepts.has(c.indicators[0]))
          lines.push(`[${c.indicators[0]}@0];`);
      }
    // Held or labelled variances, intercepts and thresholds.
    for (const t of model.parameters ?? []) {
      const c = t.indicator ? undefined : byId.get(t.target);
      if (!t.indicator && !c) continue;
      if (c?.covariate) continue;
      const v = t.indicator ? t.target : node(c!);
      const tail = `${at(t.fixed)}${t.fixed === undefined ? label(t.label) : ''}`;
      if (t.kind === 'variance') {
        if (t.indicator && isCount(t.target))
          throw new Error(`${t.target} is a count: it has no error variance.`);
        if (tail) lines.push(`${v}${tail};`);
      } else if (t.kind === 'intercept')
        lines.push(`[${v}${at(t.fixed)}]${t.fixed === undefined ? label(t.label) : ''};`);
      else
        lines.push(
          `[${v}$${t.threshold ?? 1}${at(t.fixed)}]${t.fixed === undefined ? label(t.label) : ''};`,
        );
    }
    // VARIABLE and ANALYSIS: the count and ordinal declarations (the kinds with an option first, Poisson last), the estimator.
    const decl: string[] = [];
    const cat = used.filter((n) => ordered.has(n));
    if (cat.length) decl.push(`CATEGORICAL = ${cat.join(' ')};`);
    const groups = (['nb', 'zip', 'zinb'] as const)
      .map((k) => [k, counts.filter((n) => model.count![n] === k)] as const)
      .filter(([, ns]) => ns.length);
    const pois = counts.filter((n) => model.count![n] === 'poisson');
    decl.push(
      `COUNT = ${[...groups.map(([k, ns]) => `${ns.join(' ')} (${MPLUS_COUNT[k]})`), ...(pois.length ? [pois.join(' ')] : [])].join(' ')};`,
    );
    decl.push(`ANALYSIS: ESTIMATOR = ${settings.estimator};`);
    return {
      syntax: [...decl, 'MODEL:', ...lines].join('\n'),
      names,
      casewise: settings.missing === 'casewise',
    };
  } catch (e) {
    return err((e as Error).message);
  }
}
