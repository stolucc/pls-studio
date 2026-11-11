// Conditional process analysis (PROCESS models) through manymome in webR.
// The plan (equations, indirect paths, indices) comes from src/process; the
// R bridge R/cpa.R fits and probes it.

import type { JohnsonNeyman } from '../engine/jn';
import type { Dataset, MissingTreatment } from '../engine/types';
import { codeValue, expandPlan, type Dummies } from '../process/categorical';
import { planFor } from '../process/plan';
import type { ProcessGraph } from '../process/templates';
import { rCall, rScript, rStrings } from './bridge';
import { rList } from './rjson';
import type { REngineInfo } from './lavaan';

/** A variable of the model: one observed column, or the mean score of a scale's items. */
export interface CpaVariable {
  name: string;
  indicators: string[];
  /** Model as a latent variable (SAM) instead of the mean score. */ latent?: boolean;
}

export interface CpaInput {
  graph: ProcessGraph;
  variables: CpaVariable[];
  covariates: string[];
  /** PROCESS model number, when the graph is one (for titles only). */
  model?: number;
  /** Moderators in role order (W first), so indices are labelled as PROCESS does. */
  order?: string[];
  missing: MissingTreatment;
  probe: 'percentiles' | 'meansd';
  /** Y has two values: logistic regression for Y (log-odds metric), as PROCESS. */
  binaryY?: boolean;
  /** X moderates its own M → Y paths (model 74): counterfactual effects of moving X from xref to xcf. */
  counterfactual?: { xref: number; xcf: number };
  /** A multicategorical X: its codes (relative effects per code). */
  categorical?: Dummies;
  /** Heteroskedasticity-consistent standard errors for the regressions (not used with latent variables). */
  hc?: 'none' | 'HC0' | 'HC1' | 'HC2' | 'HC3' | 'HC4';
  boot: { samples: number; seed: number };
  confidence: number;
}

export function cpaRequest(data: Dataset, input: CpaInput) {
  const cat = input.categorical;
  const base = planFor(input.graph, input.covariates, input.order);
  const plan = cat ? expandPlan(base, input.graph.x, cat.names) : base;
  // The codes of a categorical X travel as extra data columns, each its own variable.
  const variables = cat
    ? [
        ...input.variables.filter((v) => v.name !== cat.x),
        ...cat.names.map((n) => ({ name: n, indicators: [n] })),
      ]
    : input.variables;
  const used = new Set(variables.flatMap((v) => v.indicators));
  const keep = data.names.map((n, i) => [n, i] as const).filter(([n]) => used.has(n));
  const extraCols = cat ? cat.names.map((n, j) => ({ name: n, col: cat.codes[j] })) : [];
  return {
    kind: 'cpa',
    model: input.model ?? null,
    missing: input.missing,
    probe: input.probe,
    hc: input.hc ?? 'none',
    ...(input.binaryY ? { binaryY: true } : {}),
    ...(input.counterfactual
      ? {
          counterfactual: input.counterfactual,
          mediators: input.graph.mediators,
          covariates: input.covariates,
        }
      : {}),
    confidence: input.confidence,
    boot: input.boot,
    data: {
      names: [...keep.map(([n]) => n), ...extraCols.map((e) => e.name)],
      cols: [
        ...keep.map(([, i]) => Array.from(data.cols[i], (v) => (Number.isNaN(v) ? null : v))),
        ...extraCols.map((e) => Array.from(e.col, (v) => (Number.isNaN(v) ? null : v))),
      ],
    },
    variables: variables.map(({ name, indicators }) => ({ name, indicators })),
    latent: input.variables.filter((v) => v.latent && v.indicators.length > 1).map((v) => v.name),
    x: input.graph.x,
    y: input.graph.y,
    equations: plan.equations.map((e) => ({
      outcome: e.outcome,
      terms: e.terms.map((vars) => ({ vars })),
    })),
    moderators: plan.moderators,
    direct: plan.direct,
    ...('directs' in plan && plan.directs ? { directs: plan.directs } : {}),
    indirect: plan.indirect,
    jn: plan.jn,
    interactions: plan.interactions.map((i) => ({
      outcome: i.outcome,
      focal: i.focal,
      terms: i.terms.map((vars) => ({ vars })),
    })),
  };
}

export interface CpaEffect {
  est: number;
  se: number;
  lo: number;
  hi: number;
}
export interface CpaTest extends CpaEffect {
  t: number;
  p: number;
}
export type At = Record<string, number>;

export interface CpaResult {
  n: number;
  equations: {
    /** mse, F and its p are OLS quantities (null for latent-variable models). */
    outcome: string;
    n: number;
    r2: number;
    mse: number | null;
    f: number | null;
    df1: number | null;
    df2: number | null;
    p: number | null;
    /** Logistic regression (dichotomous Y): deviance (−2LL), model χ², pseudo-R² values. */
    logistic?: boolean;
    deviance?: number;
    chisq?: number;
    mcfadden?: number;
    coxsnell?: number;
    nagelkerke?: number;
    /** term: [] for the constant, [v] for a variable, [a, b(, c)] for a product. */
    coefficients: ({ term: string[] } & CpaTest)[];
    /** Tests of the highest-order interactions (one row per product, plus a joint row for two or more). */
    interactions: {
      focal: string;
      terms: string[][];
      r2change: number;
      f: number;
      df1: number;
      df2: number;
      p: number;
    }[];
  }[];
  moderators: { name: string; values: number[] }[];
  /** Y dichotomous: its equation is a logistic regression (deviance, pseudo-R², χ² instead of OLS statistics). */
  binaryY?: boolean;
  /** Model 74: counterfactual direct and indirect effects. */
  counterfactual?: {
    xref: number;
    xcf: number;
    effects: ({ name: string; label: string } & CpaEffect)[];
  } | null;
  direct: { moderators: string[]; rows: ({ at: At } & CpaTest)[] } | null;
  /** Multicategorical X: relative direct effects, one per code. */
  directs: { x: string; moderators: string[]; rows: ({ at: At } & CpaTest)[] }[];
  /** Multicategorical X: the codes used. */
  coding?: { x: string; coding: string; levels: number[]; names: string[]; table: number[][] };
  indirect: { path: string[]; moderators: string[]; rows: ({ at: At } & CpaEffect)[] }[];
  total: CpaEffect | null;
  indices: ({
    kind: 'mm' | 'partial' | 'mmm' | 'cmm';
    path: string[];
    moderator?: string;
    at?: At;
  } & CpaEffect)[];
  jn: {
    from: string;
    to: string;
    moderator: string;
    range: [number, number];
    mean: number;
    sd: number;
    /** A latent moderator: range is the mean ± 3 SD, and there are no observed cases to count. */
    latent?: boolean;
    /** Conditional effect b + bint·w, with variances [var(b), cov(b, bint), var(bint)] and the critical t. */
    b: number;
    bint: number;
    v: [number, number, number];
    crit: number;
    /** Boundaries of significance within the observed range, with the % of cases below and above. */
    bounds: { value: number; below: number | null; above: number | null }[];
  }[];
  boot: { samples: number };
  /** Bootstrap (regression) or Monte Carlo (latent variables, lavaan::sam) intervals for indirect effects. */
  inference: 'bootstrap' | 'montecarlo';
  /** Standard errors of the regressions: OLS ('none') or a heteroskedasticity-consistent type. */
  hc: 'none' | 'HC0' | 'HC1' | 'HC2' | 'HC3' | 'HC4';
  /** Variables modelled as latent. */
  latent: string[];
  warnings: string[];
  engine: REngineInfo;
}

/** R's JSON writes 1-element vectors as scalars and empty lists as []: restore the shapes. */
export function parseCpaOutput(raw: Record<string, any>): CpaResult {
  const at = (v: unknown): At => (v && !Array.isArray(v) ? (v as At) : {});
  return {
    ...(raw as CpaResult),
    equations: rList<any>(raw.equations).map((e) => ({
      ...e,
      coefficients: rList<any>(e.coefficients).map((c) => ({ ...c, term: rList<string>(c.term) })),
      interactions: rList<any>(e.interactions).map((t) => ({
        ...t,
        terms: rList<unknown>(t.terms).map((x) => rList<string>(x)),
      })),
    })),
    moderators: rList<any>(raw.moderators).map((m) => ({
      name: m.name,
      values: rList<number>(m.values),
    })),
    direct: raw.direct
      ? {
          moderators: rList<string>(raw.direct.moderators),
          rows: rList<any>(raw.direct.rows).map((r) => ({ ...r, at: at(r.at) })),
        }
      : null,
    directs: rList<any>(raw.directs).map((d) => ({
      x: d.x,
      moderators: rList<string>(d.moderators),
      rows: rList<any>(d.rows).map((r) => ({ ...r, at: at(r.at) })),
    })),
    indirect: rList<any>(raw.indirect).map((p) => ({
      path: rList<string>(p.path),
      moderators: rList<string>(p.moderators),
      rows: rList<any>(p.rows).map((r) => ({ ...r, at: at(r.at) })),
    })),
    indices: rList<any>(raw.indices).map((i) => ({
      ...i,
      path: rList<string>(i.path),
      at: i.at ? at(i.at) : undefined,
    })),
    jn: rList<any>(raw.jn).map((j) => ({
      ...j,
      range: rList<number>(j.range),
      v: rList<number>(j.v),
      bounds: rList<any>(j.bounds),
    })),
    warnings: rStrings(raw.warnings),
    counterfactual: raw.counterfactual
      ? { ...raw.counterfactual, effects: rList<any>(raw.counterfactual.effects) }
      : null,
    inference: raw.inference === 'montecarlo' ? 'montecarlo' : 'bootstrap',
    hc: (['HC0', 'HC1', 'HC2', 'HC3', 'HC4'] as const).find((h) => h === raw.hc) ?? 'none',
    latent: rList<string>(raw.latent),
  };
}

export async function estimateCpaR(data: Dataset, input: CpaInput): Promise<CpaResult> {
  const pkg =
    input.binaryY || input.counterfactual
      ? 'processGlm'
      : input.variables.some((v) => v.latent)
        ? 'manymomeSam'
        : 'manymome';
  const r = parseCpaOutput(
    await rCall<Record<string, any>>('ps_cpa', cpaRequest(data, input), pkg),
  );
  const cat = input.categorical;
  if (cat)
    r.coding = {
      x: cat.x,
      coding: cat.coding,
      levels: cat.levels,
      names: cat.names,
      table: cat.levels.map((_, g) =>
        cat.names.map((_, j) => codeValue(cat.coding, cat.levels.length, g, j)),
      ),
    };
  return r;
}

export function cpaScriptR(data: Dataset, input: CpaInput): Promise<string> {
  return rScript(
    'ps_cpa',
    cpaRequest(data, input),
    input.binaryY || input.counterfactual
      ? 'processGlm'
      : input.variables.some((v) => v.latent)
        ? 'manymomeSam'
        : 'manymome',
  );
}

/** A Johnson–Neyman curve of a process result, in the moderator's own units (for JohnsonNeymanPlot). */
export function processJn(j: CpaResult['jn'][number]): JohnsonNeyman {
  const [v11, v13, v33] = j.v;
  const effect = (m: number) => j.b + j.bint * m;
  const se = (m: number) => Math.sqrt(Math.max(0, v11 + 2 * m * v13 + m * m * v33));
  // (b + bint·m)² = crit²·se(m)²: a quadratic in m.
  const q = j.crit * j.crit;
  const A = j.bint * j.bint - q * v33,
    B = 2 * (j.b * j.bint - q * v13),
    C = j.b * j.b - q * v11;
  const disc = B * B - 4 * A * C;
  const boundaries =
    disc < 0 || A === 0
      ? []
      : [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)].sort((a, b) => a - b);
  return {
    sdM: j.sd,
    crit: j.crit,
    bx: j.b,
    bint: j.bint,
    quadratic: false,
    effect,
    se,
    boundaries,
    significantAt: (m) => Math.abs(effect(m)) > j.crit * se(m),
  };
}
