// Piecewise SEM (R/psem.R ps_psem) of the observed-variable path model on the canvas: each endogenous variable's
// equation fitted on its own (lm / glm, or lmer / glmer with a random intercept), Shipley's tests of directed
// separation and Fisher's C, AIC and AICc, standardised coefficients (piecewiseSEM).

import type { Dataset } from '../engine/types';
import type { ModelState } from '../model/project';
import { rCall, rScript, rStrings } from './bridge';
import { rColumns, rList, rNum } from './rjson';
import type { REngineInfo } from './lavaan';

export type PsemFamily = 'gaussian' | 'binomial' | 'poisson';

export const PSEM_FAMILIES: readonly (readonly [PsemFamily, string])[] = [
  ['gaussian', 'Normal (lm)'],
  ['binomial', 'Binary (logit)'],
  ['poisson', 'Count (Poisson, log)'],
];

/**
 * How non-normal outcomes' coefficients are standardised: latent-theoretic (Grace et al. 2018's LT) or
 * observation-empirical (OE; Menard).
 */
export type PsemStandardize = 'latent.linear' | 'Menard.OE';

/**
 * The path model as equations of data columns: one per endogenous variable; variables in no path; correlated
 * errors between endogenous variables.
 */
export interface PsemStructure {
  equations: { y: string; x: string[] }[];
  isolated: string[];
  correlations: [string, string][];
}

/** Whether the variables and paths contain a directed cycle (Kahn's algorithm). */
function hasCycle(variables: Set<string>, predictors: Map<string, string[]>): boolean {
  const remaining = new Map<string, number>();
  for (const [y, xs] of predictors) remaining.set(y, xs.length);
  const queue = [...variables].filter((v) => !predictors.has(v));
  let done = 0;
  while (queue.length) {
    const x = queue.shift()!;
    done++;
    for (const [y, xs] of predictors) {
      if (!xs.includes(x)) continue;
      const left = remaining.get(y)! - 1;
      remaining.set(y, left);
      if (left === 0) queue.push(y);
    }
  }
  return done < variables.size;
}

/**
 * The diagram's path model as piecewiseSEM's equations, or why it is not one (observed variables only, acyclic,
 * no interactions).
 */
export function psemStructure(model: ModelState | undefined): PsemStructure | string {
  if (!model || !model.constructs.length)
    return 'Draw a path model of observed variables on the canvas first.';
  const multi = model.constructs.find((k) => k.indicators.length !== 1 || k.components?.length);
  if (multi) {
    return (
      `Piecewise SEM fits observed variables: “${multi.name}” is not a single observed variable ` +
      '(give each variable on the canvas one indicator).'
    );
  }
  if (model.moderations.length || model.threeWay?.length || model.copulas?.length) {
    return 'Piecewise SEM fits the paths as drawn: remove the interactions and copula terms from the canvas.';
  }
  if (!model.paths.length) return 'Draw paths between the observed variables first.';

  const columnOf = new Map(model.constructs.map((k) => [k.id, k.indicators[0]]));
  const outcomes: string[] = [];
  const predictors = new Map<string, string[]>();
  const inPaths = new Set<string>();
  for (const p of model.paths) {
    const y = columnOf.get(p.to)!;
    const x = columnOf.get(p.from)!;
    inPaths.add(x);
    inPaths.add(y);
    if (!predictors.has(y)) {
      predictors.set(y, []);
      outcomes.push(y);
    }
    const xs = predictors.get(y)!;
    if (!xs.includes(x)) xs.push(x);
  }
  if (hasCycle(inPaths, predictors))
    return 'Piecewise SEM needs an acyclic path model: remove the feedback loop.';

  // Correlated errors: between two endogenous variables (exogenous variables' covariances are free anyway).
  const correlations: [string, string][] = [];
  for (const c of model.correlations ?? []) {
    if (c.zero) continue;
    const a = c.kind === 'construct' ? columnOf.get(c.a) : c.a;
    const b = c.kind === 'construct' ? columnOf.get(c.b) : c.b;
    if (!a || !b || a === b || !predictors.has(a) || !predictors.has(b)) continue;
    const seen = correlations.some(([p, q]) => (p === a && q === b) || (p === b && q === a));
    if (!seen) correlations.push([a, b]);
  }

  const isolated: string[] = [];
  for (const k of model.constructs) {
    const v = k.indicators[0];
    if (!inPaths.has(v) && !isolated.includes(v)) isolated.push(v);
  }
  return { equations: outcomes.map((y) => ({ y, x: predictors.get(y)! })), isolated, correlations };
}

/** Every data column the structure uses. */
export function psemColumns(s: PsemStructure): string[] {
  const all = [
    ...s.equations.flatMap((e) => [e.y, ...e.x]),
    ...s.isolated,
    ...s.correlations.flat(),
  ];
  return [...new Set(all)];
}

export interface PsemInput {
  families: Record<string, PsemFamily>;
  group?: string;
  standardize: PsemStandardize;
}

export interface PsemCoef {
  response: string;
  predictor: string;
  /** A correlated error (its estimate is the correlation of the two residuals). */
  correlation: boolean;
  est: number | null;
  se: number | null;
  df: number | null;
  stat: number | null;
  p: number | null;
  std: number | null;
}

export interface PsemClaim {
  y: string;
  x: string;
  given: string[];
  df: number | null;
  stat: number | null;
  p: number | null;
}

export interface PsemR2 {
  response: string;
  family: string;
  link: string;
  method: string;
  r2: number | null;
  marginal: number | null;
  conditional: number | null;
}

export interface PsemResult {
  n: number;
  /** The basis set: y ⫫ x given the claim's conditioning variables, and its test. */
  claims: PsemClaim[];
  fisherC: number;
  df: number;
  p: number | null;
  aic: number;
  aicc: number;
  k: number;
  coefs: PsemCoef[];
  r2: PsemR2[];
  standardizeType: PsemStandardize;
  group?: string;
  warnings: string[];
  engine: REngineInfo & { lme4?: string };
}

export function psemRequest(data: Dataset, s: PsemStructure, o: PsemInput) {
  const cols = psemColumns(s);
  const equations = s.equations.map((e) => ({
    y: e.y,
    x: e.x,
    family: o.families[e.y] ?? 'gaussian',
  }));
  return {
    equations,
    isolated: s.isolated,
    correlations: s.correlations,
    standardizeType: o.standardize,
    ...(o.group ? { group: o.group } : {}),
    data: rColumns(data, o.group ? [...cols, o.group] : cols),
  };
}

export async function psemR(data: Dataset, s: PsemStructure, o: PsemInput): Promise<PsemResult> {
  const raw = await rCall<Record<string, any>>('ps_psem', psemRequest(data, s, o), 'piecewiseSEM');
  const claims = rList<any>(raw.claims).map(
    (c): PsemClaim => ({
      y: c.y,
      x: c.x,
      given: rStrings(c.given),
      df: rNum(c.df),
      stat: rNum(c.stat),
      p: rNum(c.p),
    }),
  );
  const coefs = rList<any>(raw.coefs).map(
    (c): PsemCoef => ({
      response: c.response,
      predictor: c.predictor,
      correlation: c.correlation === true,
      est: rNum(c.est),
      se: rNum(c.se),
      df: rNum(c.df),
      stat: rNum(c.stat),
      p: rNum(c.p),
      std: rNum(c.std),
    }),
  );
  const r2 = rList<any>(raw.r2).map(
    (r): PsemR2 => ({
      response: r.response,
      family: r.family,
      link: r.link,
      method: r.method,
      r2: rNum(r.r2),
      marginal: rNum(r.marginal),
      conditional: rNum(r.conditional),
    }),
  );
  return {
    n: raw.n,
    claims,
    fisherC: raw.fisherC,
    df: raw.df,
    p: rNum(raw.p),
    aic: raw.aic,
    aicc: raw.aicc,
    k: raw.k,
    coefs,
    r2,
    standardizeType: raw.standardizeType,
    group: raw.group ?? undefined,
    warnings: rStrings(raw.warnings),
    engine: raw.engine,
  };
}

export function psemScriptR(data: Dataset, s: PsemStructure, o: PsemInput): Promise<string> {
  return rScript('ps_psem', psemRequest(data, s, o), 'piecewiseSEM');
}
