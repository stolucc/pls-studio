// validateModel: the checks run before anything is estimated, in rule groups. Each group returns its issues;
// validateModel concatenates them in a fixed order (the order the issue list is shown in).
import { BIFACTOR_ROTATIONS, LAVAAN_MISSING, type Dataset } from '../engine/types';
import { processGraph } from '../process/fromModel';
import {
  constraintErrors,
  createsCycle,
  DEFAULT_SETTINGS,
  endogenousIds,
  INTERACTION_METHOD_NAMES,
  isBifactorGeneral,
  labelUses,
  unconfirmedUncorrelated,
  usesConstraints,
} from './project';
import type { Construct, Issue, ModelState, Path, Settings } from './project';
import { countIndicators, countModelSyntax } from './countModel';
import { identificationIssues, isolatedTwoIndicatorFactor } from './identification';

/** The settings validateModel reads. */
export type ValidateSettings = Pick<Settings, 'method' | 'consistent'> &
  Partial<
    Pick<
      Settings,
      | 'estimator'
      | 'engine'
      | 'missing'
      | 'interaction'
      | 'hc'
      | 'plsPackage'
      | 'plsApproach'
      | 'scheme'
      | 'hocApproach'
      | 'miMethod'
      | 'miAuxiliary'
      | 'miNominal'
    >
  >;

type Report = (message: string, constructId?: string) => void;

/** What the rule groups share, built once. */
interface Ctx {
  model: ModelState;
  data: Dataset | null;
  method: ValidateSettings;
  engine: NonNullable<ValidateSettings['engine']>;
  missingChoice: NonNullable<ValidateSettings['missing']>;
  pkg: NonNullable<ValidateSettings['plsPackage']>;
  approach: NonNullable<ValidateSettings['plsApproach']>;
  /** Latent interactions by LMS / QML (modsem) rather than product indicators. */
  lmsQml: boolean;
  /** The method a CB-SEM-only option is ignored by. */
  other: string;
  /** A covariance-matrix dataset. */
  matrix: boolean;
  /** Indicators assigned to a construct, and the ordinal ones among them. */
  assignedSet: Set<string>;
  ordered: string[];
  cname: Map<string, string>;
  cap: (t: string) => string;
}

function context(model: ModelState, data: Dataset | null, method: ValidateSettings): Ctx {
  // Ordinal indicators, WLSMV and FIML: lavaan only, raw data, compatible estimator and missing-data choice.
  const assignedSet = new Set(model.constructs.flatMap((c) => c.indicators));
  return {
    model,
    data,
    method,
    engine: method.engine ?? 'r',
    missingChoice: method.missing ?? 'mean',
    matrix: !!data?.moments,
    pkg: method.plsPackage ?? 'cSEM',
    approach: method.plsApproach ?? 'PLS-PM',
    lmsQml: (model.moderations?.length ?? 0) > 0 && (method.interaction ?? 'product') !== 'product',
    other: method.method === 'pls' ? 'PLS-SEM' : 'regression',
    assignedSet,
    ordered: (model.ordered ?? []).filter((i) => assignedSet.has(i)),
    cname: new Map(model.constructs.map((c) => [c.id, c.name])),
    cap: (t: string) => t.charAt(0).toUpperCase() + t.slice(1),
  };
}

function sink() {
  const issues: Issue[] = [];
  const err: Report = (message, constructId) => {
    issues.push({ level: 'error', message, constructId });
  };
  const warn: Report = (message, constructId) => {
    issues.push({ level: 'warning', message, constructId });
  };
  return { issues, err, warn };
}

/** Whether a construct is the moderator or the predictor of a moderation (an interaction or quadratic term). */
const inInteraction = (model: ModelState, id: string) =>
  (model.moderations ?? []).some(
    (mo) => mo.moderator === id || model.paths.find((q) => q.id === mo.path)?.from === id,
  );

/** The number of distinct values in a column, missing values (NaN) left out. */
const distinct = (col: ArrayLike<number>) =>
  new Set(Array.from(col).filter((v) => !Number.isNaN(v))).size;

/** A construct's components (higher-order) or, otherwise, its indicators. */
function checkComponentsOrIndicators(v: Ctx, c: Construct, err: Report, warn: Report) {
  const { model, method, engine, pkg, approach } = v;
  const higher = (c.components?.length ?? 0) > 0;
  if (higher) {
    if (method.method === 'pls') {
      // PLS: cSEM's two-stage approach (stage 1 the components, stage 2 the second-order construct from their scores).
      if (engine === 'builtin')
        err(
          `"${c.name}" is a second-order construct: in PLS these are estimated by cSEM or seminr. Choose “R packages” under Calculated by.`,
          c.id,
        );
      else if (pkg === 'seminr' && method.consistent)
        err(
          `"${c.name}" is a second-order construct: with consistent PLS these are estimated by cSEM. Choose cSEM, or turn off PLSc for seminr.`,
          c.id,
        );
      else if ((method.hocApproach ?? 'two_stage') === 'embedded' && pkg !== 'cSEM')
        err(
          `"${c.name}" is a second-order construct: the embedded two-stage approach is cSEM’s (.approach_2ndorder = "mixed"). Choose cSEM, or the two-stage or repeated-indicators approach.`,
          c.id,
        );
      else if (approach !== 'PLS-PM')
        err(
          `"${c.name}" is a second-order construct: these are estimated with PLS path modeling. Choose PLS-PM as the weighting approach.`,
          c.id,
        );
    }
    if (c.indicators.length)
      err(`"${c.name}" has both indicators and component constructs; remove one.`, c.id);
    if (c.components!.length < 2)
      warn(
        `"${c.name}" has a single component; a higher-order factor needs at least two (three for local identification).`,
        c.id,
      );
    if (c.markerFree) {
      // Without the marker's 1 the scale must come from a path into the factor held at a value, or from a held component loading.
      const scaled =
        model.paths.some((q) => q.to === c.id && q.fixed !== undefined && q.fixed !== 0) ||
        Object.entries(c.componentLoadings ?? {}).some(
          ([id, v]) => c.components!.includes(id) && v !== 0,
        );
      if (method.method !== 'cbsem')
        err(`"${c.name}": an estimated first component loading is a CB-SEM option.`, c.id);
      else if (!scaled)
        err(
          `"${c.name}": with the first component's loading estimated, hold a path into “${c.name}” at a value (e.g. 1) or a component loading, to set its scale.`,
          c.id,
        );
      else if (engine === 'builtin')
        err(
          `"${c.name}": an estimated first component loading is estimated by lavaan. Choose “R packages” under Calculated by.`,
          c.id,
        );
      else if (method.estimator === '2SLS')
        err(
          `"${c.name}": MIIV-2SLS scales each factor by its first component; keep that loading at 1.`,
          c.id,
        );
    }
    for (const [id, v] of Object.entries(c.componentLoadings ?? {})) {
      if (!c.components!.includes(id)) continue;
      if (!Number.isFinite(v))
        err(`"${c.name}": a component loading held at a value must be a number.`, c.id);
      else if (method.method !== 'cbsem')
        err(`"${c.name}": component loadings are held at values in CB-SEM only.`, c.id);
    }
    for (const id of c.components!) {
      const comp = model.constructs.find((k) => k.id === id);
      if (!comp) err(`"${c.name}" refers to a removed component.`, c.id);
      // lavaan estimates a component with predictors (an autoregressive latent trajectory: the waves are components of
      // intercept and slope and each wave predicts the next); the built-in engine and PLS do not.
      else if (
        model.paths.some((q) => q.to === id) &&
        (method.method !== 'cbsem' || engine === 'builtin')
      )
        err(
          `"${comp.name}" is a component of "${c.name}" and cannot also have incoming paths${method.method === 'cbsem' ? ' with the built-in engine: choose “R packages” under Calculated by' : ''}.`,
          comp.id,
        );
      else if (method.method === 'pls' && (comp.components?.length || !comp.indicators.length))
        err(
          `"${comp.name}" is a component of "${c.name}": in PLS, components are first-order constructs with indicators.`,
          comp.id,
        );
      else if (
        method.method === 'pls' &&
        (model.paths.some((q) => q.from === id) || inInteraction(model, id))
      )
        err(
          `"${comp.name}" is a component of "${c.name}" and cannot also be in the structural model (cSEM’s two-stage approach); connect "${c.name}" instead.`,
          comp.id,
        );
    }
  } else if (
    c.indicators.length === 0 &&
    !(method.method === 'cbsem' && isBifactorGeneral(model, c.id))
  )
    err(
      method.method === 'process'
        ? `"${c.name}" has no variable yet. Drag a column (or a scale's items) from the data panel onto it.`
        : `"${c.name}" has no indicators. Drag variables from the data panel onto it.`,
      c.id,
    );
  if (higher && method.method === 'process')
    err(`"${c.name}" is a higher-order construct; these are supported in CB-SEM only.`, c.id);
}

/** CB-SEM measurement options: covariates, known reliabilities, an estimated error variance. */
function checkSingleIndicatorOptions(v: Ctx, c: Construct, err: Report) {
  const { model, method, engine } = v;
  if (method.method !== 'cbsem') return;
  // The last refusal of each option: not with MIIV-2SLS, and estimated by lavaan (so not by the built-in engine).
  const needsLavaanMl = (notAvailable: string, estimated: string) => {
    if (method.estimator === '2SLS')
      err(
        `"${c.name}": ${notAvailable} not available with MIIV-2SLS; choose a maximum-likelihood estimator.`,
        c.id,
      );
    else if (engine === 'builtin')
      err(`"${c.name}": ${estimated} by lavaan. Choose “R packages” under Calculated by.`, c.id);
  };
  if (c.covariate) {
    if (c.indicators.length !== 1)
      err(`Covariate "${c.name}" must have exactly one indicator.`, c.id);
    if (model.paths.some((q) => q.to === c.id))
      err(`Covariate "${c.name}" cannot have incoming paths.`, c.id);
  }
  for (const [k, r] of Object.entries(c.reliabilities ?? {})) {
    if (!c.indicators.includes(k)) continue;
    if (!(r > 0 && r <= 1))
      err(`The reliability of ${k} ("${c.name}") must be above 0 and at most 1.`, c.id);
    else if (c.indicators.length < 2 || c.covariate)
      err(
        `"${c.name}": per-indicator reliabilities apply to a factor with several indicators (a single indicator has its own reliability field).`,
        c.id,
      );
    else needsLavaanMl('known reliabilities are', 'known reliabilities are estimated');
  }
  if (c.reliability !== undefined) {
    if (!(c.reliability > 0 && c.reliability <= 1))
      err(`The reliability of "${c.name}" must be above 0 and at most 1.`, c.id);
    else if (c.indicators.length !== 1 || c.covariate)
      err(`"${c.name}": a known reliability applies to a single-indicator factor only.`, c.id);
    else needsLavaanMl('a known reliability is', 'a known reliability is estimated');
  }
  if (c.freeError) {
    if (c.indicators.length !== 1 || c.covariate)
      err(
        `"${c.name}": an estimated error variance applies to a single-indicator factor only.`,
        c.id,
      );
    else if (c.reliability !== undefined)
      err(
        `"${c.name}": choose one: a known reliability fixes the error variance, an estimated one leaves it free.`,
        c.id,
      );
    else
      needsLavaanMl(
        'an estimated error variance of a single indicator is',
        'the error variance of a single indicator is estimated',
      );
  }
}

/** Weighting modes, composites in CB-SEM, two-indicator factors, PLSc with Mode B or sum scores. */
function checkWeighting(v: Ctx, c: Construct, err: Report, warn: Report) {
  const { model, method, engine, missingChoice } = v;
  if (c.mode !== 'A' && c.indicators.length === 1 && method.method === 'pls')
    warn(
      `"${c.name}" uses ${c.mode === 'B' ? 'Mode B' : 'sum scores'} with a single indicator; the weighting has no effect.`,
      c.id,
    );
  if (method.method === 'cbsem' && c.type === 'composite') {
    // lavaan's composites (<~, lavaan >= 0.6-20): an exact weighted sum of indicators that covary freely.
    const inBlock = (model.esem?.blocks ?? []).some((b) => b.constructs.includes(c.id));
    const isComponent = model.constructs.some((k) => k.components?.includes(c.id));
    if (engine === 'builtin')
      err(
        `"${c.name}" is a composite: in CB-SEM these are estimated by lavaan. Choose “R packages” under Calculated by.`,
        c.id,
      );
    else if (method.estimator === '2SLS')
      err(
        `"${c.name}" is a composite: not available with MIIV-2SLS; choose a maximum-likelihood estimator.`,
        c.id,
      );
    else if (c.components?.length || isComponent)
      err(
        `"${c.name}" is a composite: in CB-SEM composites cannot be higher-order constructs or their components.`,
        c.id,
      );
    else if (c.indicators.length === 1)
      err(`Composite "${c.name}" needs at least two indicators.`, c.id);
    else if (inBlock) err(`"${c.name}" is a composite and cannot be in an ESEM block.`, c.id);
    else if (model.multigroup || model.multilevel)
      err(
        `"${c.name}" is a composite: composites are not available in multiple-group or two-level models.`,
        c.id,
      );
    else if (missingChoice === 'mi' || method.estimator === 'RML')
      err(
        `"${c.name}" is a composite: not available with multiple imputation or robust ML (rsem).`,
        c.id,
      );
    else if (inInteraction(model, c.id))
      err(`"${c.name}" is a composite: latent interactions in CB-SEM need common factors.`, c.id);
    else if (c.indicators.some((i) => model.ordered?.includes(i)))
      err(
        `Composite "${c.name}" has ordinal indicators; composites need continuous indicators.`,
        c.id,
      );
    else if (Object.keys(c.fixedLoadings ?? {}).length || Object.keys(c.loadingLabels ?? {}).length)
      err(`"${c.name}" is a composite: its weights cannot be fixed or labelled.`, c.id);
    else if (
      (model.correlations ?? []).some(
        (k) => k.kind === 'indicator' && (c.indicators.includes(k.a) || c.indicators.includes(k.b)),
      )
    )
      err(
        `"${c.name}" is a composite: its indicators covary freely already, and have no error terms to correlate.`,
        c.id,
      );
  }
  if (method.method === 'cbsem' && c.type === 'factor' && c.indicators.length === 2) {
    // (with no relation and no constraint the factor cannot be identified: model/identification.ts)
    if (method.estimator !== '2SLS' && isolatedTwoIndicatorFactor(model, c))
      err(
        `"${c.name}" has two indicators and no path or correlation to another construct: it is not identified (four free parameters for three variances and covariances; Bollen, 1989). Draw its correlation with another factor, give its two loadings the same label, or add a third indicator.`,
        c.id,
      );
    else
      warn(
        `"${c.name}" has two indicators; it is only identified through its relations with other factors.`,
        c.id,
      );
  }
  if (method.method === 'pls' && method.consistent && c.type === 'factor') {
    // PLSc's correction (ρA, loadings from the weights) is derived for Mode A weights (Dijkstra & Henseler 2015).
    if (c.mode === 'B')
      warn(
        `"${c.name}" is a common factor estimated with Mode B: PLSc’s correction (ρA) assumes Mode A weights, so its corrected estimates are not known to be consistent. Use Mode A, or model "${c.name}" as a composite.`,
        c.id,
      );
    // As cSEM: PLSc corrects Mode A common factors; sum scores count as error-free (reliability 1).
    if (c.mode === 'unit' && c.indicators.length > 1)
      warn(
        `"${c.name}" is a common factor with sum scores: PLSc corrects Mode A common factors only, so "${c.name}" is treated as error-free (reliability 1) and its relations stay attenuated. Use Mode A for "${c.name}" to correct it, or model it as a composite.`,
        c.id,
      );
  }
}

/** A dataset, raw where the method needs it, and enough constructs. */
function checkPrerequisites(v: Ctx): Issue[] {
  const { issues, err } = sink();
  const { model, data, method } = v;
  if (!data) err('Import a dataset first.');
  if (data?.moments && method.method === 'pls')
    err('This dataset is a covariance matrix: PLS needs raw data. Switch to CB-SEM.');
  if (data?.moments && method.method === 'process')
    err('This dataset is a covariance matrix: conditional process analysis needs raw data.');
  if (model.constructs.length < (method.method === 'pls' ? 2 : 1))
    err(
      method.method === 'pls'
        ? 'Add at least two constructs and connect them with a path.'
        : 'Add at least one factor.',
    );
  return issues;
}

/** Each construct: its name, components or indicators, measurement options, indicators and connection. */
function checkConstructs(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, data, method } = v;
  const names = new Map<string, number>();
  for (const c of model.constructs)
    names.set(c.name.trim().toLowerCase(), (names.get(c.name.trim().toLowerCase()) ?? 0) + 1);

  const owner = new Map<string, string>();
  const available = new Set(data?.names ?? []);
  for (const c of model.constructs) {
    if (!c.name.trim()) err('A construct has an empty name.', c.id);
    else if ((names.get(c.name.trim().toLowerCase()) ?? 0) > 1)
      err(`Construct name "${c.name}" is used more than once.`, c.id);
    checkComponentsOrIndicators(v, c, err, warn);
    checkSingleIndicatorOptions(v, c, err);
    checkWeighting(v, c, err, warn);
    for (const ind of c.indicators) {
      const o = owner.get(ind);
      // (an ESEM block's factors load on all of the block's indicators: a factor outside the block may share them, Mplus example 5.30)
      const inEsem = (id: string) =>
        (model.esem?.blocks ?? []).some((b) => b.constructs.includes(id));
      const oc = model.constructs.find((k) => k.name === o);
      // (CB-SEM: an indicator may load on several common factors, e.g. the A, C and E factors of a twin model, Mplus
      //  examples 5.18 and 5.19; not on a composite, whose indicators define it, nor as an observed covariate)
      const sharedFactors =
        method.method === 'cbsem' &&
        !!oc &&
        [oc, c].every((k) => k.type === 'factor' && !k.covariate && !k.components?.length);
      if (
        o &&
        !(method.method === 'cbsem' && oc && inEsem(oc.id) !== inEsem(c.id)) &&
        !sharedFactors
      )
        err(`Indicator "${ind}" is assigned to both "${o}" and "${c.name}".`, c.id);
      owner.set(ind, c.name);
      if (data && !available.has(ind))
        err(`Indicator "${ind}" (in "${c.name}") is not in the current dataset.`, c.id);
    }
    // PLS needs every construct in the structural model; CB-SEM also handles pure CFA.
    const isComponent = model.constructs.some((k) => k.components?.includes(c.id));
    // (a moderator is connected through its moderation, which implies its effect on the outcome)
    if (
      method.method === 'pls' &&
      !isComponent &&
      !model.paths.some((p) => p.from === c.id || p.to === c.id) &&
      !(model.moderations ?? []).some((mo) => mo.moderator === c.id)
    )
      err(`"${c.name}" is not connected to any other construct.`, c.id);
  }
  return issues;
}

/** Direct effects on indicators (CB-SEM). */
function checkIndicatorPaths(v: Ctx): Issue[] {
  const { issues, err } = sink();
  const { model, method } = v;
  // Direct effects on indicators (CB-SEM): from another construct or covariate to a factor's indicator.
  for (const p of model.indicatorPaths ?? []) {
    const from = model.constructs.find((k) => k.id === p.from),
      owners = model.constructs.filter((k) => k.indicators.includes(p.to));
    if (method.method !== 'cbsem') {
      err(
        `The direct effect ${from?.name ?? '?'} → ${p.to} on an indicator is a CB-SEM parameter; switch to CB-SEM or remove it.`,
      );
      continue;
    }
    if (!from || !owners.length)
      err(
        `A direct effect on an indicator refers to a construct or indicator that is no longer in the model.`,
      );
    else if (owners.some((k) => k.type === 'composite'))
      err(`${p.to} is an indicator of a composite: a direct effect on it is not available.`);
    else if (owners.some((k) => k.id === from.id))
      err(
        `${from.name} → ${p.to} is the loading of ${p.to}; a direct effect comes from another construct or covariate.`,
      );
    else if (owners.some((k) => k.indicators.length === 1 && !k.reliability && !k.freeError))
      err(
        `${p.to} is a single indicator that stands for its construct: draw the path to the construct instead.`,
      );
  }
  return issues;
}

/** Pre-defined weights and Gaussian copulas (PLS-SEM options). */
function checkPlsOptions(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, method, approach } = v;
  for (const c of model.constructs) {
    if (!c.predefinedWeights) continue;
    if (method.method !== 'pls')
      err(
        `"${c.name}" has pre-defined weights, a PLS-SEM option: switch to PLS-SEM, or estimate its weights.`,
        c.id,
      );
    else if (c.indicators.every((i) => !c.predefinedWeights![i]))
      err(`"${c.name}": its pre-defined weights are all zero.`, c.id);
    else if (method.consistent && c.type === 'factor')
      warn(
        `"${c.name}" is a common factor with pre-defined weights: PLSc does not correct it, so it is treated as a composite.`,
        c.id,
      );
  }
  if (model.copulas?.length) {
    if (method.method !== 'pls')
      err(
        'Gaussian copulas are a PLS-SEM option here: remove them from the paths, or switch to PLS-SEM.',
      );
    else if (method.consistent)
      err('Gaussian copulas are not available with consistent PLS: switch PLSc off.');
    else if (approach !== 'PLS-PM')
      err('Gaussian copulas need PLS path modeling as the weighting approach.');
  }
  return issues;
}

/** Moderations and quadratic effects, by method. */
function checkModerations(v: Ctx): Issue[] {
  const { issues, err } = sink();
  const { model, method, cname, cap, engine, pkg } = v;
  for (const mo of model.moderations ?? []) {
    const p = model.paths.find((q) => q.id === mo.path);
    if (!p) {
      err('A moderation refers to a path that no longer exists.');
      continue;
    }
    // Conditional process models imply each moderator's main effect (src/process/fromModel.ts).
    if (method.method === 'process') continue;
    const quadratic = mo.moderator === p.from;
    const label = quadratic
      ? `the quadratic effect of ${cname.get(p.from)} on ${cname.get(p.to)}`
      : `${cname.get(mo.moderator)} moderating ${cname.get(p.from)} → ${cname.get(p.to)}`;
    if (method.method === 'cbsem' && method.estimator === '2SLS') {
      err(
        `${quadratic ? 'Quadratic effects' : 'Moderation'} (${label}) ${quadratic ? 'are' : 'is'} not available with MIIV-2SLS; choose a maximum-likelihood estimator.`,
        mo.moderator,
      );
    } else if (method.method === 'cbsem') {
      // Latent interaction via product indicators needs exogenous predictor and moderator.
      for (const id of new Set([p.from, mo.moderator])) {
        if (model.paths.some((q) => q.to === id))
          err(
            `${cap(label)}: in CB-SEM ${quadratic ? 'the predictor' : 'the predictor and moderator'} must be exogenous, but ${cname.get(id)} has incoming paths.`,
            id,
          );
      }
    } else if (mo.method && engine === 'r' && pkg !== 'seminr') {
      err(
        `${cap(label)} uses ${INTERACTION_METHOD_NAMES[mo.method]}: that interaction term is seminr’s (interaction_term) and the built-in engine’s. Choose seminr under R packages, the built-in engine, or the two-stage term.`,
        mo.moderator,
      );
    } else if (mo.method && method.consistent) {
      err(
        `${cap(label)} uses ${INTERACTION_METHOD_NAMES[mo.method]}, which is not available with PLSc: use the two-stage term, or switch consistent PLS off.`,
        mo.moderator,
      );
    } else if (method.consistent && engine === 'r' && pkg === 'seminr') {
      // cSEM and the built-in engine estimate nonlinear models with PLSc (Dijkstra & Schermelleh-Engel 2014); seminr does not.
      err(
        `${quadratic ? 'Quadratic effects' : 'Moderation'} (${label}) with PLSc ${quadratic ? 'need' : 'needs'} cSEM or the built-in engine: choose one of those, or switch consistent PLS off.`,
        mo.moderator,
      );
    }
    // The moderator's main effect on the outcome is implied (toSpec); undrawn, it must not close a cycle.
    if (
      !quadratic &&
      !model.paths.some((q) => q.from === mo.moderator && q.to === p.to) &&
      createsCycle(model.paths, mo.moderator, p.to)
    ) {
      err(
        `${cap(label)}: ${cname.get(mo.moderator)} lies downstream of ${cname.get(p.to)}, so its implied effect on ${cname.get(p.to)} would create a cycle.`,
        mo.moderator,
      );
    }
  }
  return issues;
}

/** CB-SEM: exogenous constructs left uncorrelated (asked until confirmed). */
function checkExogenousCorrelations(v: Ctx): Issue[] {
  const { issues } = sink();
  const { model, method } = v;
  // CB-SEM: the diagram is the model, so exogenous constructs without a drawn correlation are
  // uncorrelated. Usually an oversight (a CFA with orthogonal factors): ask, until confirmed.
  if (method.method === 'cbsem' && method.estimator !== '2SLS') {
    const pairs = unconfirmedUncorrelated(model);
    if (pairs.length) {
      const shown = pairs
        .slice(0, 4)
        .map(([a, b]) => `${a.name} ↔ ${b.name}`)
        .join(', ');
      const hidden = pairs.length - 4;
      const more = hidden > 0 ? ` and ${hidden} more pair${hidden > 1 ? 's' : ''}` : '';
      issues.push({
        level: 'warning',
        action: 'exogenous-correlations',
        message: `No correlation is drawn between ${shown}${more}: as exogenous constructs they are estimated as uncorrelated. Intended?`,
      });
    }
  }
  return issues;
}

/** Combinations the engines refuse (PLS packages, CB-SEM with a matrix, imputation, LMS / QML, weights). */
function checkEngineCombinations(v: Ctx): Issue[] {
  const { issues, err } = sink();
  const { model, data, method, matrix, engine, missingChoice, pkg, approach, lmsQml } = v;
  // Combinations the engines refuse: said here, before anything runs (and before R is even loaded).
  if (method.method === 'pls') {
    if (pkg === 'seminr' && engine === 'r') {
      if (method.scheme === 'centroid')
        err(
          'seminr offers the path and factor weighting schemes only; choose one of those, or cSEM.',
        );
      if (approach !== 'PLS-PM')
        err(`The ${approach} weighting approach is estimated with cSEM; choose cSEM.`);
    }
    if (engine === 'builtin' && approach !== 'PLS-PM')
      err(
        `The ${approach} weighting approach is estimated with cSEM: choose “R packages” under Calculated by.`,
      );
  }
  if (method.method === 'cbsem') {
    const mods = model.moderations.length > 0;
    if (matrix) {
      if (mods)
        err(
          'Latent interactions need raw data (product indicators); this dataset is a covariance matrix.',
        );
      if (method.estimator === 'MLR')
        err(
          'MLR needs raw data; with a covariance matrix use MLM or MLMV (with NACOV), ML, GLS or ULS.',
        );
      if (method.estimator === 'RML') err('Robust ML (rsem) needs raw data.');
      if (model.multigroup && !data?.moments?.groups)
        err(
          'Multiple-group analysis needs raw data with a grouping column, or one covariance matrix per group.',
        );
      if (model.multilevel) err('A two-level model needs raw data with a cluster column.');
      if (model.weights) err('Sampling weights need raw data.');
      if (missingChoice === 'mi') err('Multiple imputation needs raw data.');
      if (missingChoice === 'fiml')
        err('FIML needs raw data; a covariance matrix has no missing values.');
    }
    if (missingChoice === 'mi') {
      if (method.estimator && !['ML', 'MLR'].includes(method.estimator))
        err('With multiple imputation choose the ML or MLR estimator.');
      if (method.estimator === 'RML')
        err(
          'Robust ML (rsem) uses the missing values itself (EM); choose FIML or casewise instead of multiple imputation.',
        );
    }
    if (lmsQml) {
      if (model.multigroup)
        err('LMS and QML (modsem) need a single-group model; use product indicators with groups.');
      if (model.esem?.blocks.length)
        err('LMS and QML (modsem) cannot be combined with ESEM blocks; use product indicators.');
      if (model.weights)
        err(
          'Sampling weights cannot be combined with LMS / QML latent interactions; use product indicators.',
        );
    }
    if (model.weights) {
      if (model.multilevel) err('Sampling weights cannot be combined with a two-level model.');
      if (method.estimator && !['ML', 'MLR', 'MLM', 'WLSMV'].includes(method.estimator))
        err('With sampling weights choose ML, MLR or MLM (or WLSMV for ordinal indicators).');
    }
  }
  return issues;
}

/** The mean structure (the constant on the canvas): lavaan, raw data or means, no groups. */
function checkMeanStructure(v: Ctx): Issue[] {
  const { issues, err } = sink();
  const { model, data, method, matrix, engine, lmsQml } = v;
  // The mean structure (the constant on the canvas): lavaan, raw data, no groups.
  if (model.constant) {
    if (method.method !== 'cbsem')
      err(
        'The constant (means and intercepts) is a CB-SEM feature: switch to CB-SEM, or remove the triangle.',
      );
    else {
      if (engine === 'builtin')
        err(
          'Means and intercepts are estimated by lavaan: choose “R packages” under Calculated by.',
        );
      if (method.estimator === '2SLS')
        err(
          'Means and intercepts are not available with MIIV-2SLS; choose a maximum-likelihood estimator.',
        );
      if (matrix && !(data?.moments?.means || data?.moments?.groups?.every((g) => g.means)))
        err(
          'Means and intercepts need the variables’ means: this covariance matrix carries none (add a “mean” row to the matrix file, or use raw data).',
        );
      if (model.multilevel)
        err('Means and intercepts are not available in a two-level model here.');
      const nGroups = data?.moments?.groups?.length;
      for (const t of model.means ?? []) {
        if (t.bias === undefined) continue;
        const bias = Array.isArray(t.bias) ? t.bias : [t.bias];
        if (!bias.length || bias.some((b) => !Number.isFinite(b)))
          err('A marker intercept (bias) must be a number.');
        else if (Array.isArray(t.bias) && !model.multigroup)
          err('One marker intercept (bias) per group needs groups.');
        else if (Array.isArray(t.bias) && nGroups && t.bias.length !== nGroups)
          err(`A marker intercept (bias) per group needs ${nGroups} values (one per group).`);
      }
      if (lmsQml)
        err('Means and intercepts are not available with LMS / QML; use product indicators.');
      for (const t of model.means ?? []) {
        const c = model.constructs.find((k) => k.id === t.target);
        if (!c) err('A mean arrow points to a removed construct.');
        // (a curve of factors, Mplus ex. 6.14 and 6.15: identified when each component's indicators hold an intercept or threshold
        //  at a value or a label, the measurement invariance over time that carries the location)
        else if (
          c.components?.length &&
          c.components.some((id) => {
            const k = model.constructs.find((x) => x.id === id);
            return (
              k?.indicators.length !== 1 &&
              !(
                k?.indicators.length &&
                k.indicators.some((i) =>
                  (model.parameters ?? []).some(
                    (t) =>
                      t.indicator &&
                      t.target === i &&
                      (t.kind === 'intercept' || t.kind === 'threshold') &&
                      (t.fixed !== undefined || !!t.label || !!t.byGroup?.length),
                  ),
                )
              )
            );
          })
        )
          err(
            `The mean of "${c.name}" (a second-order construct) is identified only when its components are single indicators (a latent curve model) or hold an indicator’s intercept or threshold at a value or label (a curve of factors).`,
            c.id,
          );
      }
    }
  }
  return issues;
}

/** Data that no estimator can use: an indicator with no variance, or with no values at all. */
function checkDegenerateColumns(v: Ctx): Issue[] {
  const { issues, err } = sink();
  const { model, data, matrix } = v;
  // Data that no estimator can use: an indicator with no variance, or with no values at all.
  if (data && !matrix) {
    for (const c of model.constructs)
      for (const ind of c.indicators) {
        const k = data.names.indexOf(ind);
        if (k < 0) continue;
        const col = data.cols[k];
        let n = 0,
          first = NaN,
          constant = true;
        for (let i = 0; i < col.length; i++) {
          const v = col[i];
          if (Number.isNaN(v)) continue;
          if (n === 0) first = v;
          else if (v !== first) constant = false;
          n++;
        }
        if (n === 0) err(`Indicator "${ind}" (in "${c.name}") has no values.`, c.id);
        else if (constant)
          err(
            `Indicator "${ind}" (in "${c.name}") is constant (${first} in every row): it carries no information.`,
            c.id,
          );
      }
  }
  return issues;
}

/** CB-SEM: ordinal indicators, lavaan-only options, the likelihood convention, FIML. */
function checkCbsemEstimator(v: Ctx): Issue[] {
  const { issues, err } = sink();
  const { model, data, method, engine, missingChoice, ordered } = v;
  if (method.method !== 'cbsem') return issues;
  const lavaanOnly = [
    ordered.length && 'ordinal indicators',
    model.information === 'observed' && 'Standard errors from the observed information',
    method.estimator === 'WLSMV' && 'WLSMV',
    missingChoice === 'fiml' && 'FIML',
    missingChoice === 'pairwise' && 'pairwise deletion',
    (missingChoice === 'twostage' || missingChoice === 'robusttwostage') &&
      'the two-stage approach',
  ].filter(Boolean);
  if (lavaanOnly.length && engine === 'builtin')
    err(
      `${lavaanOnly.join(', ')} ${lavaanOnly.length === 1 ? 'is' : 'are'} estimated by lavaan: choose “R packages” under Calculated by.`,
    );
  // (with count indicators the model goes to the integration engine, where ordinal indicators are logit under ML: checkCounts)
  if (ordered.length && method.estimator !== 'WLSMV' && !countIndicators(model).length)
    err(
      `${ordered.join(', ')} ${ordered.length === 1 ? 'is' : 'are'} ordinal: choose the WLSMV estimator (thresholds and polychoric correlations), or treat ${ordered.length === 1 ? 'it' : 'them'} as continuous.`,
    );
  if (ordered.length && missingChoice === 'mean')
    err(
      'Mean replacement would put non-category values into ordinal indicators; choose casewise deletion.',
    );
  if ((model.likelihood || model.sampleCovRescale === false) && engine === 'builtin')
    err(
      'The Wishart likelihood and an unrescaled covariance matrix are lavaan options: choose “R packages” under Calculated by.',
    );
  if (
    (model.likelihood || model.sampleCovRescale === false) &&
    !['ML', 'MLM', 'MLMV', 'MLR'].includes(method.estimator ?? 'ML')
  )
    err(
      'The Wishart likelihood and an unrescaled covariance matrix apply to the maximum-likelihood estimators.',
    );
  if (model.likelihood && model.sampleCovRescale === false)
    err('Choose one convention: the Wishart likelihood already fits the matrix as given (N − 1).');
  if (model.sampleCovRescale === false && data && !data.moments)
    err('Fitting the covariance matrix as given applies to covariance-matrix input.');
  if (model.information === 'observed' && method.estimator === '2SLS')
    err(
      'MIIV-2SLS has its own standard errors: the observed-information option is for the maximum-likelihood estimators.',
    );
  if (
    missingChoice === 'fiml' &&
    method.estimator !== 'ML' &&
    method.estimator !== 'MLR' &&
    method.estimator !== 'RML'
  )
    err('FIML needs the ML or MLR estimator (MLR adds robust standard errors and test statistic).');
  return issues;
}

/** CB-SEM: pairwise deletion, the two-stage approach, auxiliary variables and multiple imputation. */
function checkCbsemMissingData(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, data, method, engine, missingChoice, ordered, assignedSet, lmsQml } = v;
  if (method.method !== 'cbsem') return issues;
  if (missingChoice === 'pairwise') {
    // lavaan: pairwise deletion of the sample statistics; standard errors and test as if the data were complete.
    if (method.estimator !== 'ML' && method.estimator !== 'ULS')
      err(
        'Pairwise deletion works with the ML or ULS estimator (lavaan has no robust standard errors with it); for robust results use the two-stage approach or FIML.',
      );
    else
      warn(
        'Pairwise deletion: the standard errors and the χ² test treat the data as complete, so they are too optimistic; the two-stage approach or FIML give correct ones.',
      );
  }
  if (missingChoice === 'twostage' || missingChoice === 'robusttwostage') {
    if (!['ML', 'MLR', 'GLS', 'ULS'].includes(method.estimator ?? 'ML'))
      err('The two-stage approach works with the ML, MLR, GLS or ULS estimator.');
  }
  if (
    missingChoice === 'pairwise' ||
    missingChoice === 'twostage' ||
    missingChoice === 'robusttwostage'
  ) {
    const what = missingChoice === 'pairwise' ? 'Pairwise deletion' : 'The two-stage approach';
    if (data?.moments) err(`${what} needs raw data, not a covariance matrix.`);
    if (ordered.length)
      err(
        `${what} is for continuous indicators; with ordinal indicators (WLSMV) lavaan already uses pairwise information.`,
      );
    if (model.multilevel) err(`${what} is not available for two-level models; use FIML.`);
    if (method.estimator === 'RML') err(`${what} cannot be combined with robust ML (rsem).`);
  }
  const aux = model.auxiliary ?? [];
  if (aux.length) {
    // Auxiliary variables (lavaan aux =): FIML's saturated correlates or the two-stage approach's first-stage EM.
    const fimlLike =
      missingChoice === 'fiml' ||
      missingChoice === 'twostage' ||
      missingChoice === 'robusttwostage';
    if (!fimlLike)
      warn(
        `The auxiliary variables (${aux.join(', ')}) are used with FIML or the two-stage approach to missing values; with ${missingChoice === 'mi' ? 'multiple imputation choose the imputation’s own auxiliary variables' : 'this treatment they are ignored'}.`,
      );
    else {
      if (data?.moments) err('Auxiliary variables need raw data, not a covariance matrix.');
      const gone = aux.filter((a) => data && !data.moments && !data.names.includes(a));
      if (gone.length) err(`Auxiliary variables not in the data: ${gone.join(', ')}.`);
      const inModel = aux.filter((a) => assignedSet.has(a));
      if (inModel.length)
        err(`Auxiliary variables must not be indicators of the model: ${inModel.join(', ')}.`);
      const roles = aux.filter(
        (a) =>
          a === model.multigroup?.column ||
          a === model.weights ||
          a === model.cluster ||
          a === model.multilevel?.column,
      );
      if (roles.length)
        err(
          `${roles.join(', ')} already ${roles.length === 1 ? 'has' : 'have'} a role in the model (groups, weights or clusters): not an auxiliary variable.`,
        );
      if (ordered.length)
        err(
          'Auxiliary variables are available for continuous indicators (lavaan); this model has ordinal ones.',
        );
      if (model.multilevel || model.cluster)
        err(
          'Auxiliary variables are not available with clusters (two-level models or sampling clusters).',
        );
      if (method.estimator === 'RML')
        err(
          'Robust ML (rsem) handles missing values itself: auxiliary variables are not available with it.',
        );
      if (lmsQml)
        err(
          'Auxiliary variables cannot be combined with LMS / QML latent interactions; use product indicators.',
        );
      if (engine === 'builtin')
        err('Auxiliary variables are a lavaan option: choose “R packages” under Calculated by.');
    }
  }
  if (missingChoice === 'mi') {
    // Multiple imputation (mice) pooled by lavaan.mi: one group of continuous indicators, ML or MLR.
    if (engine === 'builtin')
      err('Multiple imputation uses mice and lavaan.mi: choose “R packages” under Calculated by.');
    if (method.estimator !== 'ML' && method.estimator !== 'MLR')
      err('With multiple imputation choose the ML or MLR estimator.');
    if (data?.moments && data.cols.length === 0)
      err('Multiple imputation needs raw data; this dataset is a covariance matrix.');
    if (model.multilevel || model.weights || ordered.length || model.esem?.blocks.length)
      err(
        'Multiple imputation is available for continuous indicators: no clusters, sampling weights, ordinal indicators or ESEM blocks.',
      );
    if (lmsQml)
      err(
        'Multiple imputation cannot be combined with LMS / QML latent interactions; use product indicators.',
      );
    const missingAux = (method.miAuxiliary ?? []).filter(
      (a) => data && !data.moments && !data.names.includes(a),
    );
    if (missingAux.length)
      err(`Auxiliary variables of the imputation not in the data: ${missingAux.join(', ')}.`);
    if ((method.miMethod ?? 'mice') === 'amelia' && model.multigroup)
      err('Amelia imputes one group here; choose mice for a multiple-group model.');
    const inImputation = new Set([
      ...model.constructs.flatMap((c) => c.indicators),
      ...(method.miAuxiliary ?? []),
    ]);
    const strayNominal = (method.miNominal ?? []).filter((x) => !inImputation.has(x));
    if ((method.miMethod ?? 'mice') !== 'mice' && strayNominal.length)
      err(
        `Nominal variables of the imputation must be among its variables (the model's or the auxiliary ones): ${strayNominal.join(', ')}.`,
      );
  }
  return issues;
}

/** CB-SEM: ADF / WLS, robust ML (rsem), raw-data needs, and few-category indicators. */
function checkCbsemRobust(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, data, method, engine, missingChoice, ordered, lmsQml, assignedSet } = v;
  if (method.method !== 'cbsem') return issues;
  if (method.estimator === 'WLS') {
    // ADF (Browne 1984; EQS's AGLS): weights from the fourth-order moments, so raw data or a NACOV matrix.
    if (engine === 'builtin')
      err(
        'Distribution-free estimation (ADF / WLS) is done by lavaan: choose “R packages” under Calculated by.',
      );
    if (data?.moments && data.cols.length === 0 && !data.moments.nacov)
      err(
        'Distribution-free estimation (ADF / WLS) needs raw data, or a covariance matrix with its NACOV (asymptotic covariance) matrix.',
      );
    if (ordered.length)
      err(
        'With ordinal indicators choose WLSMV (robust weighted least squares on polychoric correlations).',
      );
  }
  if (method.estimator === 'RML') {
    // Robust ML (rsem): one group of continuous indicators, raw data, lavaan through R.
    if (engine === 'builtin')
      err('Robust ML is estimated by rsem with lavaan: choose “R packages” under Calculated by.');
    if (data?.moments && data.cols.length === 0)
      err(
        'Robust ML down-weights cases, so it needs raw data; this dataset is a covariance matrix.',
      );
    if (
      model.multigroup ||
      model.multilevel ||
      model.weights ||
      ordered.length ||
      model.esem?.blocks.length
    )
      err(
        'Robust ML (rsem) handles one group of continuous indicators: no groups, clusters, sampling weights, ordinal indicators or ESEM blocks.',
      );
    if (lmsQml)
      err(
        'Robust ML cannot be combined with LMS / QML latent interactions; use product indicators.',
      );
  }
  if ((ordered.length || missingChoice === 'fiml') && data?.moments)
    err('Ordinal indicators and FIML need raw data, not a covariance matrix.');
  if (data && !data.moments && !ordered.length) {
    const few = [...assignedSet].filter((name) => {
      const col = data.cols[data.names.indexOf(name)];
      if (!col) return false;
      const vals = new Set<number>();
      for (const v of col) {
        if (Number.isNaN(v)) continue;
        if (!Number.isInteger(v)) return false;
        vals.add(v);
        if (vals.size > 4) return false;
      }
      return vals.size >= 2;
    });
    if (few.length)
      warn(
        `${few.join(', ')} ${few.length === 1 ? 'has' : 'have'} four or fewer categories; consider treating ${few.length === 1 ? 'it' : 'them'} as ordinal (right-click an indicator) with WLSMV (Rhemtulla, Brosseau-Liard & Savalei, 2012).`,
      );
  }
  return issues;
}

/** PLS-SEM and conditional process analysis: missing data, categorical constructs, dominant and ordinal indicators. */
function checkOtherMissingData(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, data, method, engine, missingChoice, ordered, pkg, approach } = v;
  if (method.method === 'cbsem') return issues;
  if (LAVAAN_MISSING.includes(missingChoice) && method.method === 'pls')
    err(
      `${lavaanMissingName(missingChoice)} is a CB-SEM option; PLS-SEM uses mean replacement, casewise deletion or multiple imputation.`,
    );
  if (missingChoice === 'mi' && method.method === 'pls') {
    if (engine === 'builtin')
      err('Multiple imputation uses mice: choose “R packages” under Calculated by.');
    if (method.miMethod === 'amelia')
      err('Amelia imputation is available for CB-SEM; PLS-SEM imputes with mice.');
    if (method.miMethod === 'micenorm')
      err(
        'Bayesian normal-regression imputation is available for CB-SEM; PLS-SEM imputes with predictive mean matching.',
      );
    if (method.miMethod === 'joint')
      err(
        'Joint (H1) imputation is available for CB-SEM; PLS-SEM imputes with predictive mean matching.',
      );
  }
  // Categorical exogenous constructs (PLS): one column, 2 to 20 categories, no predictors.
  if (method.method === 'pls')
    for (const c of model.constructs.filter((k) => k.categorical)) {
      if (c.indicators.length !== 1)
        err(
          `The categorical variable "${c.name}" must be a single column (its categories become dummy variables).`,
          c.id,
        );
      else if (model.paths.some((q) => q.to === c.id))
        err(
          `"${c.name}" is categorical: it can only predict (an exogenous variable), not be predicted.`,
          c.id,
        );
      else if (data && !data.moments) {
        const col = data.cols[data.names.indexOf(c.indicators[0])];
        const k = col ? distinct(col) : 0;
        if (k < 2 || k > 20)
          err(`The categorical variable "${c.name}" needs 2 to 20 categories (it has ${k}).`, c.id);
      }
    }
  const dominants = model.constructs.filter((c) => c.dominant && c.indicators.includes(c.dominant));
  if (method.method === 'pls' && dominants.length && engine === 'r' && pkg === 'seminr')
    warn(
      `seminr has no dominant indicators: the signs of ${dominants.map((c) => c.name).join(', ')} are as estimated. Choose cSEM to fix them.`,
    );
  if (missingChoice === 'mi' && method.method === 'process')
    err(
      'Multiple imputation is available in PLS-SEM and CB-SEM; conditional process analysis uses casewise deletion.',
    );
  // Ordinal indicators in PLS: OrdPLS / OrdPLSc (Schuberth, Henseler & Dijkstra 2018), cSEM's estimator on polychoric correlations.
  // (a categorical construct's column travels as dummies, never ordinal)
  const ordPls =
    method.method === 'pls'
      ? ordered.filter(
          (i) => !model.constructs.some((c) => c.categorical && c.indicators.includes(i)),
        )
      : [];
  if (ordPls.length) {
    const list = `${ordPls.join(', ')} ${ordPls.length === 1 ? 'is' : 'are'} ordinal`;
    if (engine === 'builtin' || pkg !== 'cSEM')
      err(
        `${list}: ordinal PLS (OrdPLS/OrdPLSc, polychoric correlations) is estimated by cSEM. Choose R packages → cSEM, or treat ${ordPls.length === 1 ? 'it' : 'them'} as continuous (right-click).`,
      );
    const gaps =
      data &&
      !data.moments &&
      ordPls.some((i) => {
        const col = data.cols[data.names.indexOf(i)];
        return !!col && col.some((x) => Number.isNaN(x));
      });
    if (missingChoice === 'mean' && gaps)
      err(
        'Mean replacement would put non-category values into ordinal indicators that have missing values; choose casewise deletion.',
      );
    if (missingChoice === 'mi')
      err(
        'Ordinal PLS (OrdPLS/OrdPLSc) is available with casewise deletion; multiple imputation is for continuous indicators.',
      );
    if (approach !== 'PLS-PM')
      err(
        `${list}: ordinal indicators are estimated by OrdPLS; choose PLS-PM as the weighting approach.`,
      );
    if (model.moderations?.length)
      err(
        `${list}: interaction terms (products of construct scores) are not available with ordinal PLS.`,
      );
    if (model.constructs.some((c) => c.components?.length))
      err(`${list}: second-order constructs are not available with ordinal PLS.`);
    // (these terms run in the built-in engine, which has no ordinal PLS)
    if (
      model.copulas?.length ||
      model.threeWay?.length ||
      model.constructs.some((c) => c.predefinedWeights)
    )
      err(
        `${list}: Gaussian copulas, moderated moderations and pre-defined weights are estimated by the built-in engine, which has no ordinal PLS.`,
      );
  }
  return issues;
}

/** PLS-SEM weighting approaches other than PLS-PM: cSEM. */
function checkPlsApproach(v: Ctx): Issue[] {
  const { issues, err } = sink();
  const { method, engine, pkg, approach } = v;
  if (method.method === 'pls' && approach !== 'PLS-PM' && !(engine === 'r' && pkg === 'cSEM')) {
    err(
      `${approach === 'unit' ? 'Sum scores' : approach} ${approach === 'unit' ? 'are' : 'is'} estimated with cSEM: choose R packages → cSEM, or PLS path modeling.`,
    );
  }
  return issues;
}

/** Text columns used as indicators. */
function checkTextColumns(v: Ctx): Issue[] {
  const { issues, warn } = sink();
  const { data, assignedSet } = v;
  // Text columns coded 1, 2, ... (alphabetical): fine for groups and clusters, rarely as indicators.
  const textInds = data?.categories ? [...assignedSet].filter((i) => data.categories![i]) : [];
  if (textInds.length) {
    warn(
      `${textInds.join(', ')} ${textInds.length > 1 ? 'are text columns' : 'is a text column'}, used through ${textInds.length > 1 ? 'their' : 'its'} codes 1, 2, … in alphabetical order (${data!.categories![textInds[0]].slice(0, 3).join(', ')}${data!.categories![textInds[0]].length > 3 ? ', …' : ''}). Recode it as numbers if the categories have another order.`,
    );
  }
  return issues;
}

/** Column checks shared by CB-SEM and PLS-SEM sampling weights. */
function weightColumnIssues(v: Ctx, wcol: string, err: (m: string) => void) {
  const { model, data, assignedSet } = v;
  if (assignedSet.has(wcol) || model.multigroup?.column === wcol)
    err(`“${wcol}” cannot be both the sampling weights and an indicator or the grouping column.`);
  const k = data?.names.indexOf(wcol) ?? -1;
  if (data && !data.moments && k < 0)
    err(`The sampling-weights column “${wcol}” is not in the current dataset.`);
  else if (
    data &&
    k >= 0 &&
    data.cols[k] &&
    Array.from(data.cols[k]).some((x) => !Number.isFinite(x) || x < 0)
  )
    err(`The sampling weights (${wcol}) must be non-negative numbers without missing values.`);
  else if (data && k >= 0 && data.cols[k] && !Array.from(data.cols[k]).some((x) => x > 0))
    err(`The sampling weights (${wcol}) are all zero.`);
  if (data?.moments && data.cols.length === 0)
    err('Sampling weights need raw data; this dataset is a covariance matrix.');
}

/** Sampling (survey) weights: lavaan's sampling.weights (CB-SEM), weighted PLS (WPLS, Becker & Ismail 2016; built-in engine). */
function checkSamplingWeights(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, method, engine, ordered, missingChoice, approach, lmsQml } = v;
  const wcol = model.weights;
  if (wcol && method.method === 'pls') {
    // cSEM and seminr take no sampling weights: the run goes to the built-in engine (runner.ts).
    if (engine === 'r')
      warn(
        `Weighted PLS (sampling weights ${wcol}) is estimated by the built-in engine: neither cSEM nor seminr takes sampling weights.`,
      );
    if (model.copulas?.length) err('Gaussian copulas cannot be combined with sampling weights.');
    if (method.consistent && model.moderations.length)
      err(
        'Interaction terms with PLSc cannot be combined with sampling weights; switch consistent PLS off.',
      );
    if (approach !== 'PLS-PM')
      err('Weighted PLS needs PLS path modeling as the weighting approach.');
    if (missingChoice === 'mi')
      err('Weighted PLS uses mean replacement or casewise deletion, not multiple imputation.');
    if (model.constructs.some((c) => c.components?.length))
      err('Weighted PLS is not available with second-order constructs.');
    weightColumnIssues(v, wcol, err);
  } else if (wcol) {
    if (method.method !== 'cbsem')
      warn(
        `The sampling weights (${wcol}) are used in CB-SEM and PLS-SEM only; regression ignores them.`,
      );
    else {
      if (engine === 'builtin')
        err('Sampling weights are estimated by lavaan: choose “R packages” under Calculated by.');
      const est = method.estimator ?? 'ML';
      if (!['ML', 'MLR', 'MLM'].includes(est) && !(est === 'WLSMV' && ordered.length))
        err(
          'With sampling weights choose ML, MLR or MLM (or WLSMV for ordinal indicators): lavaan weights these estimators only.',
        );
      if (model.multilevel) err('Sampling weights cannot be combined with a two-level model here.');
      if (lmsQml)
        err(
          'Sampling weights cannot be combined with LMS / QML latent interactions; use product indicators.',
        );
      weightColumnIssues(v, wcol, err);
    }
  }
  return issues;
}

/** Sampling clusters (complex design): lavaan's cluster = in a single-level model, CB-SEM only. */
function checkSamplingClusters(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, data, method, engine, assignedSet, missingChoice, lmsQml, other } = v;
  const ccol = model.cluster;
  if (ccol) {
    if (method.method !== 'cbsem')
      warn(
        `The sampling clusters (${ccol}) give cluster-robust standard errors in CB-SEM only; ${other} ignores them.`,
      );
    else {
      if (engine === 'builtin')
        err(
          'Cluster-robust standard errors are computed by lavaan: choose “R packages” under Calculated by.',
        );
      const est = method.estimator ?? 'ML';
      if (['2SLS', 'RML'].includes(est))
        err(
          `Cluster-robust standard errors are not available with ${est === '2SLS' ? 'MIIV-2SLS' : 'robust ML (rsem)'}; choose ML or MLR.`,
        );
      if (model.multilevel)
        err(
          'Sampling clusters (cluster-robust standard errors) and a two-level model are alternatives: the two-level model already models the clustering.',
        );
      if (missingChoice === 'mi')
        err(
          'Cluster-robust standard errors cannot be combined with multiple imputation; use FIML.',
        );
      if (lmsQml)
        err(
          'Cluster-robust standard errors are not available with LMS / QML latent interactions; use product indicators.',
        );
      if (assignedSet.has(ccol) || model.multigroup?.column === ccol || model.weights === ccol)
        err(
          `“${ccol}” cannot be both the sampling clusters and an indicator, the grouping column or the sampling weights.`,
        );
      if (data?.moments)
        err('Sampling clusters need raw data; this dataset is a covariance matrix.');
      else if (data) {
        const k = data.names.indexOf(ccol);
        if (k < 0) err(`The cluster column “${ccol}” is not in the current dataset.`);
        else if (new Set(Array.from(data.cols[k]).filter((v) => Number.isFinite(v))).size < 2)
          err(`The cluster column “${ccol}” needs at least two clusters.`);
      }
    }
  }
  return issues;
}

/** Constructs marked categorical, which CB-SEM treats as continuous. */
function checkCategoricalInCbsem(v: Ctx): Issue[] {
  const { issues, warn } = sink();
  const { model, method } = v;
  const cats = model.constructs.filter((c) => c.categorical);
  if (cats.length && method.method === 'cbsem')
    warn(
      `${cats.map((c) => c.name).join(', ')} ${cats.length === 1 ? 'is' : 'are'} marked categorical, which PLS-SEM and CPA use; CB-SEM treats ${cats.length === 1 ? 'it' : 'them'} as continuous.`,
    );
  return issues;
}

type Multilevel = NonNullable<ModelState['multilevel']>;

/** Names in a between-level model as written that are neither data columns nor factors it defines. */
function unknownBetweenNames(ml: Multilevel, columns: string[]): string[] {
  if (ml.between !== 'model') return [];
  const st = ml.betweenModel ?? [];
  const factors = new Set(st.filter((x) => x.op === '=~').map((x) => x.lhs));
  return [...new Set(st.flatMap((x) => [x.lhs, ...x.rhs.map((t) => t.name)]))]
    .filter((x) => x !== '1' && !factors.has(x) && !columns.includes(x))
    .map(
      (x) =>
        `“${x}” in the between-level model is neither a column of the dataset nor a between-level factor.`,
    );
}

/** A CB-SEM-only missing-data treatment, named to start a sentence. */
function lavaanMissingName(choice: string): string {
  if (choice === 'fiml') return 'FIML';
  if (choice === 'pairwise') return 'Pairwise deletion';
  return 'The two-stage approach';
}

/** A composite's weighting, as messages name it. */
function weightingName(mode: string): string {
  if (mode === 'B') return 'Mode B';
  if (mode === 'unit') return 'sum scores';
  return 'Mode A';
}

/** Cluster-level covariates (between level `factors`) that are not further columns of the data. */
function betweenCovariateIssues(
  ml: Multilevel,
  columns: string[],
  assigned: Set<string>,
): string[] {
  if (ml.between !== 'factors') return [];
  return (ml.betweenCovariates ?? []).flatMap((w) => {
    if (!columns.includes(w)) return [`The cluster-level covariate “${w}” is not in the dataset.`];
    if (assigned.has(w) || w === ml.column)
      return [
        `“${w}” is in the model or defines the clusters: a cluster-level covariate is a further column.`,
      ];
    return [];
  });
}

/** Two-level models (CB-SEM). */
function checkMultilevel(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, data, method, engine, assignedSet, ordered } = v;
  const ml = model.multilevel;
  if (ml) {
    if (method.method === 'pls')
      warn(
        `The two-level model (clusters by ${ml.column}) is estimated in CB-SEM, and for PLS-SEM by the Multilevel PLS-SEM card on the Analyses tab (plssem, desktop R); the Model tab’s PLS-SEM ignores the clustering.`,
      );
    else if (method.method !== 'cbsem')
      warn(
        `The two-level model (clusters by ${ml.column}) is estimated in CB-SEM only; regression ignores the clustering.`,
      );
    else {
      if (engine === 'builtin')
        err('Two-level models are estimated by lavaan: choose “R packages” under Calculated by.');
      if (method.estimator !== 'ML' && method.estimator !== 'MLR')
        err('Two-level models use the ML or MLR estimator.');
      if (model.esem?.blocks.length || ordered.length || model.moderations.length) {
        err(
          'Two-level models cannot be combined with ESEM blocks, ordinal indicators or latent interactions (lavaan estimates two-level models by ML only).',
        );
      }
      if (model.multigroup?.column === ml.column)
        err(`“${ml.column}” cannot define both the groups and the clusters.`);
      if (!ml.column) err('Choose the cluster column under Clusters (two-level).');
      // The between level as written: every name a column of the dataset or a factor it defines.
      if (ml.between === 'model' && !ml.betweenModel?.length)
        err(
          'The between-level model has no statements; choose another between-level model under Clusters.',
        );
      if (data && !data.moments) unknownBetweenNames(ml, data.names).forEach((m) => err(m));
      if (ml.between === 'same' && labelUses(model).size > 0) {
        warn(
          'Labels apply at both levels: parameters with the same label are equal within and between clusters (cross-level invariance).',
        );
      }
      if (data?.moments) err('Two-level models need raw data with a cluster column.');
      else if (data) {
        const col = data.cols[data.names.indexOf(ml.column)];
        if (!col) err(`The cluster column “${ml.column}” is not in the dataset.`);
        else {
          if (assignedSet.has(ml.column))
            err(`“${ml.column}” is an indicator and cannot also define the clusters.`);
          betweenCovariateIssues(ml, data.names, assignedSet).forEach((m) => err(m));
          const k = distinct(col);
          if (k < 2) err(`The cluster column “${ml.column}” has fewer than two clusters.`);
          else if (k < 30)
            warn(
              `Only ${k} clusters: between-level estimates and standard errors are unreliable with fewer than about 30–50 clusters (Maas & Hox, 2005).`,
            );
        }
      }
    }
  }
  return issues;
}

/**
 * Why the Multilevel PLS-SEM card (plssem 0.2.0, MC-PLSc for two-level models) cannot estimate the model on the canvas
 * with its clusters and these random slopes (paths by construct names); [] when it can. What plssem does not support
 * for two-level models (Mode B, higher-order constructs), and what the card does not pass to it, is refused here.
 */
export function plsMultilevelIssues(
  model: ModelState,
  data: Dataset | null,
  settings: Pick<Settings, 'missing'>,
  slopes: { from: string; to: string }[] = [],
): string[] {
  const out: string[] = [];
  const ml = model.multilevel;
  if (!ml?.column)
    return [
      'Choose the cluster column under Clusters (two-level) on the Model tab: the diagram is the within-cluster model.',
    ];
  if (ml.between === 'saturated')
    out.push(
      'Multilevel PLS-SEM needs a model between clusters: choose Same model, Factors or As written under Clusters (a saturated between level is lavaan’s).',
    );
  if (!model.constructs.length) out.push('Draw the within-cluster model on the canvas first.');
  const name = new Map(model.constructs.map((c) => [c.id, c.name]));
  for (const c of model.constructs) {
    if (c.components?.length)
      out.push(`"${c.name}" is a higher-order construct: not available in multilevel PLS-SEM.`);
    else if (!c.indicators.length) out.push(`"${c.name}" has no indicators.`);
    else if (c.categorical && c.indicators.length === 1)
      out.push(
        `"${c.name}" is categorical (dummies forming a Mode B composite): plssem’s MC-PLSc has no Mode B; use a numeric variable.`,
      );
    else if (c.indicators.length > 1 && (c.mode !== 'A' || c.type === 'composite'))
      out.push(
        `"${c.name}" is a composite (${weightingName(c.mode)}): plssem’s MC-PLSc estimates common factors only (it has no Mode B yet); make it a factor with Mode A.`,
      );
    if (c.predefinedWeights)
      out.push(`"${c.name}" has pre-defined weights, which plssem does not take.`);
  }
  if (model.moderations.length || model.threeWay?.length || model.copulas?.length)
    out.push(
      'Multilevel PLS-SEM is estimated here without interaction terms or copulas: remove them from the paths.',
    );
  if (model.paths.some((p) => p.fixed !== undefined || p.label))
    out.push(
      'Multilevel PLS-SEM estimates every path: remove fixed values and labels from the paths.',
    );
  if (model.multigroup)
    out.push('Multilevel PLS-SEM has no groups: remove the grouping column (Groups).');
  if (model.weights) out.push('Multilevel PLS-SEM takes no sampling weights: clear them.');
  if (model.cluster)
    out.push(
      'Sampling clusters (cluster-robust standard errors) and a two-level model are alternatives: clear the sampling clusters.',
    );
  if (settings.missing !== 'mean' && settings.missing !== 'casewise')
    out.push(
      'Multilevel PLS-SEM handles missing values by casewise deletion or mean replacement (plssem’s listwise and mean): choose one under Missing values.',
    );
  if (ml.between === 'model')
    for (const st of ml.betweenModel ?? []) {
      if (st.op === '~1')
        out.push(
          'Multilevel PLS-SEM has no intercepts: remove the “~ 1” statements from the between-level model.',
        );
      else if (st.rhs.some((t) => t.fixed !== undefined || t.label))
        out.push(
          'Multilevel PLS-SEM estimates every between-level parameter: remove fixed values and labels from the between-level model.',
        );
    }
  const assigned = new Set(model.constructs.flatMap((c) => c.indicators));
  if (!data || data.moments) out.push('Multilevel PLS-SEM needs raw data with a cluster column.');
  else {
    const k = data.names.indexOf(ml.column);
    if (k < 0) out.push(`The cluster column “${ml.column}” is not in the dataset.`);
    else if (assigned.has(ml.column))
      out.push(`“${ml.column}” is an indicator and cannot also define the clusters.`);
    else if (new Set(Array.from(data.cols[k]).filter((v) => Number.isFinite(v))).size < 2)
      out.push(`The cluster column “${ml.column}” has fewer than two clusters.`);
    out.push(
      ...betweenCovariateIssues(ml, data.names, assigned),
      ...unknownBetweenNames(ml, data.names),
    );
  }
  if (ml.between === 'factors' && !model.constructs.some((c) => c.indicators.length > 1))
    out.push(
      'Between clusters the factors are measured by their indicators: the model needs a construct with several indicators.',
    );
  const paths = new Set(model.paths.map((p) => `${name.get(p.from)}\r${name.get(p.to)}`));
  for (const s of slopes)
    if (!paths.has(`${s.from}\r${s.to}`))
      out.push(`The random slope ${s.from} → ${s.to} is not a path of the model.`);
  if (slopes.length > 20) out.push('At most 20 random slopes.');
  return [...new Set(out)];
}

/** Multiple groups and values per group (CB-SEM). */
function checkMultigroup(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, data, method, engine, assignedSet, other } = v;
  const mg = model.multigroup;
  if (
    !mg &&
    [...(model.parameters ?? []), ...(model.correlations ?? [])].some((t) => t.byGroup?.length)
  )
    err(
      'Some parameters have values per group, but there are no groups: set a grouping column (Groups), or give one value.',
    );
  if (mg) {
    if (method.method !== 'cbsem')
      warn(
        `Multiple groups (${mg.column}) are analysed in CB-SEM only; ${other} pools the groups.`,
      );
    else {
      if (engine === 'builtin')
        err(
          'Multiple-group analysis is estimated by lavaan: choose “R packages” under Calculated by.',
        );
      if (method.estimator === '2SLS')
        err('Multiple-group analysis is not available with MIIV-2SLS.');
      if (mg.meanStructure === false && model.constant)
        err(
          'Groups without a mean structure cannot have means or intercepts: remove the constant, or estimate the mean structure.',
        );
      if (mg.meanStructure === false && (mg.invariance === 'scalar' || mg.invariance === 'strict'))
        err('Scalar and strict invariance hold intercepts equal: they need the mean structure.');
      if (data?.moments && !data.moments.groups)
        err(
          'Multiple-group analysis needs raw data with a grouping column, or a dataset of one covariance matrix per group.',
        );
      else if (data?.moments?.groups) {
        if (mg.column)
          err(
            'With one covariance matrix per group the groups are those matrices: no grouping column applies.',
          );
      } else if (data) {
        const col = data.cols[data.names.indexOf(mg.column)];
        if (!col) err(`The grouping column “${mg.column}” is not in the dataset.`);
        else {
          if (assignedSet.has(mg.column))
            err(`“${mg.column}” is an indicator and cannot also define the groups.`);
          const counts = new Map<number, number>();
          for (const v of col) if (!Number.isNaN(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
          if (counts.size < 2) err(`The grouping column “${mg.column}” has fewer than two groups.`);
          else if (counts.size > 20)
            err(
              `The grouping column “${mg.column}” has ${counts.size} distinct values; choose a column with a few groups (at most 20).`,
            );
          else {
            // Values per group (lavaan c(…)): one entry per group.
            const perGroup = [...(model.parameters ?? []), ...(model.correlations ?? [])].filter(
              (t) => t.byGroup?.length && t.byGroup.length !== counts.size,
            );
            if (perGroup.length)
              err(
                `Values per group need one entry for each of the ${counts.size} groups of “${mg.column}”; ${perGroup.length === 1 ? 'one parameter has' : `${perGroup.length} parameters have`} ${[...new Set(perGroup.map((t) => t.byGroup!.length))].join(' or ')}.`,
              );
            const small = [...counts].filter(([, k]) => k < 30).map(([v]) => v);
            if (small.length)
              warn(
                `Group${small.length === 1 ? '' : 's'} ${small.join(', ')} of “${mg.column}” ${small.length === 1 ? 'has' : 'have'} fewer than 30 cases; estimates may be unstable.`,
              );
          }
        }
      }
      const ids = new Set(model.constructs.map((c) => c.id));
      for (const f of mg.free)
        if (f.kind === 'loading' && !ids.has(f.construct))
          err('A loading freed across groups refers to a removed construct.');
      for (const f of mg.free)
        if (f.kind === 'regression' && !model.paths.some((q) => q.from === f.from && q.to === f.to))
          err('A coefficient freed across groups refers to a removed path.');
      for (const f of mg.free)
        if (f.kind === 'mean' && !(model.means ?? []).some((t) => t.target === f.construct))
          err('A mean freed across groups refers to a construct without a mean arrow.');
      if (mg.structural?.includes('means') && !model.constant)
        warn(
          'Means are held equal across groups, but there is no constant on the canvas: nothing to hold equal.',
        );
      if (mg.free.some((f) => f.kind === 'regression') && !mg.structural?.includes('regressions'))
        warn(
          'Coefficients are freed across groups, but the structural coefficients are not held equal (Groups): the freeing has no effect.',
        );
    }
  }
  return issues;
}

/** Latent interactions by LMS / QML (modsem). */
function checkLatentInteractions(v: Ctx): Issue[] {
  const { issues, err } = sink();
  const { model, data, method, engine, missingChoice, ordered, lmsQml } = v;
  if (method.method === 'cbsem' && lmsQml) {
    const what = method.interaction === 'lms' ? 'LMS' : 'QML';
    if (engine === 'builtin')
      err(
        `${what} latent interactions are estimated by modsem: choose “R packages” under Calculated by.`,
      );
    if (method.estimator !== 'ML')
      err(`${what} is a maximum-likelihood method: choose the ML estimator.`);
    if (LAVAAN_MISSING.includes(missingChoice))
      err(`${what} needs complete data here: choose casewise deletion or mean replacement.`);
    if (model.multigroup || model.esem?.blocks.length || ordered.length || data?.moments)
      err(
        `${what} needs raw data and a single-group model without ESEM blocks or ordinal indicators.`,
      );
  }
  return issues;
}

/** Exploratory SEM blocks (CB-SEM). */
function checkEsem(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, method, engine, other } = v;
  const blocks = model.esem?.blocks ?? [];
  if (blocks.length) {
    if (method.method !== 'cbsem')
      warn(
        `ESEM blocks are estimated in CB-SEM only; ${other} treats their constructs as ordinary ones.`,
      );
    else {
      if (engine === 'builtin')
        err(
          'Exploratory SEM (ESEM) is estimated by lavaan: choose “R packages” under Calculated by.',
        );
      if (method.estimator === '2SLS') err('ESEM blocks are not available with MIIV-2SLS.');
      const seen = new Set<string>();
      const byId = new Map(model.constructs.map((c) => [c.id, c]));
      for (const b of blocks) {
        if (b.constructs.length < 2) err('An ESEM block needs at least two factors.');
        for (const id of b.constructs) {
          const c = byId.get(id);
          if (!c) continue;
          if (seen.has(id)) err(`"${c.name}" is in two ESEM blocks.`, id);
          seen.add(id);
          if (c.covariate || c.components?.length)
            err(
              `"${c.name}" is a covariate or higher-order factor and cannot be in an ESEM block.`,
              id,
            );
          if (
            Object.keys(c.fixedLoadings ?? {}).length ||
            Object.keys(c.loadingLabels ?? {}).length
          )
            err(
              `"${c.name}" is in an ESEM block, whose loadings are rotated: remove its fixed loadings and loading labels.`,
              id,
            );
          if (inInteraction(model, id))
            err(
              `"${c.name}" is in an ESEM block and cannot take part in a latent interaction.`,
              id,
            );
        }
      }
      if (model.esem!.rotation === 'target' && blocks.length > 1)
        err('Target rotation is available for a single ESEM block.');
      if (
        BIFACTOR_ROTATIONS.includes(model.esem!.rotation) &&
        blocks.some((b) => b.constructs.length < 3)
      )
        err(
          'A bifactor rotation needs a general and at least two specific factors in every ESEM block.',
        );
      if (model.esem!.invariant) {
        if (blocks.length < 2) err('Invariant loadings need two or more ESEM blocks.');
        if (model.esem!.rotation !== 'geomin' || model.esem!.orthogonal)
          err('Invariant ESEM blocks are rotated jointly by oblique geomin.');
        if (new Set(blocks.map((b) => b.constructs.length)).size > 1)
          err('Invariant ESEM blocks need the same number of factors.');
        if (model.multigroup)
          err(
            'Invariant ESEM blocks are for one group; across groups, hold the loadings equal under Groups.',
          );
      }
    }
  }
  return issues;
}

/** Parameter labels, defined parameters, Wald tests, fixed values and moderated moderation. */
function checkConstraints(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, method, engine, other } = v;
  if (usesConstraints(model)) {
    if (method.method !== 'cbsem')
      warn(
        `Parameter labels, defined parameters and Wald tests are used by CB-SEM only; ${other} ignores them.`,
      );
    else {
      for (const e of constraintErrors(model)) err(e);
      if (engine === 'builtin')
        err(
          'Parameter labels (equality constraints), defined parameters and Wald tests are estimated by lavaan: choose “R packages” under Calculated by.',
        );
      if (method.estimator === '2SLS')
        err(
          'Parameter labels, defined parameters and Wald tests are not available with MIIV-2SLS.',
        );
    }
  }

  const nFixed =
    model.paths.filter((p) => p.fixed !== undefined).length +
    (model.correlations ?? []).filter((k) => k.fixed !== undefined).length +
    model.constructs.reduce((s, c) => s + Object.keys(c.fixedLoadings ?? {}).length, 0);
  if (nFixed && method.method !== 'cbsem')
    warn(
      `${nFixed} parameter${nFixed === 1 ? ' is' : 's are'} fixed at a value; only CB-SEM uses fixed values, ${other} estimates ${nFixed === 1 ? 'it' : 'them'} freely.`,
    );
  else if (nFixed && method.estimator === '2SLS')
    err(
      'Fixed parameter values are not available with MIIV-2SLS; choose a maximum-likelihood estimator or free them.',
    );
  if (model.threeWay?.length && method.method === 'cbsem') {
    err(
      'Moderated moderation (a moderator acting on a moderation) is available in PLS-SEM and conditional process analysis.',
    );
  }
  return issues;
}

/** Conditional process analysis: the PROCESS graph, latent scales, categorical X, dichotomous Y, model 74. */
function checkProcess(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, data, method } = v;
  if (method.method === 'process') {
    for (const e of processGraph(model).errors) err(e.message, e.constructId);
    const latent = model.constructs.filter((c) => c.latent && !c.covariate);
    for (const c of latent) {
      if (c.indicators.length < 2)
        err(
          `"${c.name}" is set as a latent variable but has ${c.indicators.length} item${c.indicators.length === 1 ? '' : 's'}; a latent variable needs at least two (three for a stable measurement model).`,
          c.id,
        );
      else if (c.indicators.length === 2)
        warn(
          `"${c.name}" is a latent variable with two items; it is identified only through its relations with other latent variables.`,
          c.id,
        );
    }
    const g = processGraph(model).graph;
    for (const c of model.constructs.filter((k) => k.categorical)) {
      if (!g || c.name !== g.x)
        err(`"${c.name}" is marked as categorical, which applies to X only.`, c.id);
      else if (c.indicators.length !== 1 || c.latent)
        err(`The categorical X "${c.name}" must be a single observed column.`, c.id);
      else if (data && !data.moments) {
        const col = data.cols[data.names.indexOf(c.indicators[0])];
        const k = col ? distinct(col) : 0;
        if (k < 2 || k > 10)
          err(`The categorical X "${c.name}" needs 2 to 10 groups (it has ${k}).`, c.id);
      }
    }
    // Dichotomous Y (logistic) and counterfactual (X by M) effects use the lm / glm bootstrap engine.
    const gy = g && model.constructs.find((c) => c.name === g.y);
    const ycol =
      gy && gy.indicators.length === 1 && data && !data.moments
        ? data.cols[data.names.indexOf(gy.indicators[0])]
        : undefined;
    const binaryY = !!ycol && distinct(ycol) === 2;
    const xmint = !!g && g.moderations.some((m) => m.by === g.x && m.path[1] === g.y);
    if (binaryY && (latent.length || (method.hc ?? 'none') !== 'none')) {
      err(
        'A dichotomous Y is analysed by logistic regression, which is not combined with latent variables or HC standard errors here.',
      );
    }
    if (xmint && (binaryY || latent.length || model.constructs.some((c) => c.categorical))) {
      err(
        'X moderating its own M → Y paths (counterfactual effects, model 74) needs a continuous Y, observed variables and a non-categorical X (as PROCESS).',
      );
    }
    if (latent.length && model.threeWay?.length) {
      err(
        'Moderated moderation (three-way interaction) is not available with latent variables (lavaan’s SAM syntax has no three-way products). Use mean scores, or remove the three-way term.',
        latent[0].id,
      );
    }
  }
  return issues;
}

/** Correlations (double-headed arrows) and fixed zeros. */
function checkCorrelations(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, method, other } = v;
  const corrs = model.correlations ?? [];
  if (corrs.length && method.method !== 'cbsem') {
    warn(
      `The model has ${corrs.length} correlation${corrs.length === 1 ? '' : 's'} (double-headed arrows); ${other} ignores them. They are estimated in CB-SEM.`,
    );
  } else if (corrs.length) {
    const endo = endogenousIds(model);
    const byId = new Map(model.constructs.map((c) => [c.id, c]));
    const ownerOf = new Map(
      model.constructs.flatMap((c) => c.indicators.map((i) => [i, c] as const)),
    );
    for (const k of corrs) {
      if (k.kind === 'construct') {
        const a = byId.get(k.a),
          b = byId.get(k.b);
        if (!a || !b) continue;
        const label = `Correlation ${a.name} ↔ ${b.name}`;
        if (k.zero) {
          if (a.covariate || b.covariate || endo.has(a.id) || endo.has(b.id))
            err(
              `${a.name} and ${b.name} are fixed as uncorrelated, which applies to two exogenous constructs only. Delete the fixed zero.`,
              (endo.has(a.id) || a.covariate ? a : b).id,
            );
          else if (method.method === 'cbsem' && method.estimator === '2SLS')
            warn(
              `MIIV-2SLS does not use the fixed zero between ${a.name} and ${b.name}; it estimates their covariance.`,
            );
          continue;
        }
        if (a.covariate || b.covariate)
          err(
            `${label}: covariates are observed and fixed (fixed.x); they cannot get extra covariances.`,
            (a.covariate ? a : b).id,
          );
        else if (endo.has(a.id) !== endo.has(b.id)) {
          err(
            `${label} joins an exogenous construct with an endogenous one. Correlate exogenous constructs with each other, or the disturbances of endogenous constructs.`,
            (endo.has(a.id) ? b : a).id,
          );
        } else if (
          endo.has(a.id) &&
          model.paths.some(
            (q) => (q.from === a.id && q.to === b.id) || (q.from === b.id && q.to === a.id),
          )
        ) {
          warn(
            `Disturbances of ${a.name} and ${b.name} covary while one predicts the other: the model is non-recursive and usually not identified unless both have instruments (predictors the other lacks).`,
            a.id,
          );
        }
      } else {
        const ca = ownerOf.get(k.a),
          cb = ownerOf.get(k.b);
        if (!ca || !cb) continue;
        if (
          ca.indicators.length === 1 ||
          cb.indicators.length === 1 ||
          ca.covariate ||
          cb.covariate
        ) {
          err(
            `Error correlation ${k.a} ↔ ${k.b}: single-indicator constructs have no measurement error to correlate.`,
            (ca.indicators.length === 1 || ca.covariate ? ca : cb).id,
          );
        }
      }
    }
  }
  return issues;
}

/** Cycles (reciprocal paths, feedback loops): a non-recursive model. */
function checkCycles(v: Ctx): Issue[] {
  const { issues, err, warn } = sink();
  const { model, method, cname } = v;
  // Cycles (reciprocal paths, feedback loops): a non-recursive model. CB-SEM estimates it (lavaan, the built-in
  // ML engine) when the equations are identified; PLS-SEM and conditional process analysis need a recursive model.
  const seen: Path[] = [];
  const loops: string[] = [];
  for (const p of model.paths) {
    if (createsCycle(seen, p.from, p.to)) loops.push(`${cname.get(p.from)} → ${cname.get(p.to)}`);
    seen.push(p);
  }
  if (loops.length) {
    if (method.method !== 'cbsem')
      err(
        `The structural model contains a cycle (${loops.join(', ')}). ${method.method === 'pls' ? 'PLS-SEM' : 'Conditional process analysis'} requires a recursive model; CB-SEM estimates non-recursive models.`,
      );
    else
      warn(
        `Non-recursive model (${loops.join(', ')} closes a loop). Each construct in a loop needs a predictor the other lacks (an instrument) or the loop is not identified; lavaan reports the identification problem if so.`,
      );
  }
  return issues;
}

/** The 10-times rule. */
/** CB-SEM identification: second-order factors, df < 0, clusters, WLSMV without ordinal indicators (model/identification.ts). */
function checkIdentification(v: Ctx): Issue[] {
  return identificationIssues(v.model, v.data, v.method);
}

function checkSampleSize(v: Ctx): Issue[] {
  const { issues, warn } = sink();
  const { model, data, method } = v;
  if (data && model.constructs.length > 0 && method.method !== 'process') {
    const n = data.moments ? data.moments.n : (data.cols[0]?.length ?? 0);
    const maxArrows = Math.max(
      ...model.constructs.map((c) =>
        Math.max(
          c.mode === 'B' ? c.indicators.length : 0,
          model.paths.filter((p) => p.to === c.id).length,
        ),
      ),
    );
    if (maxArrows > 0 && n < 10 * maxArrows)
      warn(`Sample size (${n}) is below the 10-times rule minimum (${10 * maxArrows}).`);
  }
  return issues;
}
/**
 * Count indicators: lavaan has no count outcomes, so CB-SEM's own run is blocked and the issue opens the Integration ML
 * card on the diagram (model/countModel.ts), or says why the diagram cannot be estimated that way. Other methods
 * treat them as continuous.
 */
function checkCounts(v: Ctx): Issue[] {
  const { issues, warn } = sink();
  const { model, data, method } = v;
  const counts = countIndicators(model);
  if (!counts.length) return issues;
  const list = `${counts.join(', ')} ${counts.length === 1 ? 'is a count' : 'are counts'}`;
  if (method.method !== 'cbsem') {
    warn(
      `${list}: count indicators are a CB-SEM declaration; ${method.method === 'pls' ? 'PLS-SEM' : 'this method'} treats ${counts.length === 1 ? 'it' : 'them'} as continuous.`,
    );
    return issues;
  }
  const r = countModelSyntax(
    model,
    {
      method: method.method,
      estimator: method.estimator ?? 'ML',
      missing: method.missing ?? 'mean',
    },
    data?.names ?? null,
    { moments: !!data?.moments && data.cols.length === 0 },
  );
  issues.push(
    'error' in r
      ? {
          level: 'error',
          message: `${list}: models with count indicators are estimated by numerical integration, not lavaan, and this one cannot be: ${r.error}`,
        }
      : {
          level: 'error',
          message: `${list}: lavaan has no count indicators, so the model is estimated by maximum likelihood with numerical integration on the Analyses tab (Integration ML, the diagram), not by Calculate.`,
          action: 'count-integration',
        },
  );
  return issues;
}
const RULES = [
  checkCounts,
  checkPrerequisites,
  checkConstructs,
  checkIndicatorPaths,
  checkPlsOptions,
  checkModerations,
  checkExogenousCorrelations,
  checkEngineCombinations,
  checkMeanStructure,
  checkDegenerateColumns,
  checkCbsemEstimator,
  checkCbsemMissingData,
  checkCbsemRobust,
  checkOtherMissingData,
  checkPlsApproach,
  checkTextColumns,
  checkSamplingWeights,
  checkSamplingClusters,
  checkCategoricalInCbsem,
  checkMultilevel,
  checkMultigroup,
  checkLatentInteractions,
  checkEsem,
  checkConstraints,
  checkProcess,
  checkCorrelations,
  checkCycles,
  checkIdentification,
  checkSampleSize,
];

/** Errors (block calculation) and warnings for a model, its data and the chosen method, in display order. */
export function validateModel(
  model: ModelState,
  data: Dataset | null,
  method: ValidateSettings = DEFAULT_SETTINGS,
): Issue[] {
  const v = context(model, data, method);
  return RULES.flatMap((rule) => rule(v));
}
