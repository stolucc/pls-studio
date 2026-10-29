// Conditional process analysis (PROCESS models) through manymome in webR.
// The plan (equations, indirect paths, indices) comes from src/process; the
// R bridge R/cpa.R fits and probes it.

import type { JohnsonNeyman } from '../engine/jn';
import type { Dataset, MissingTreatment } from '../engine/types';
import { codeValue, expandPlan, type Dummies } from '../process/categorical';
import { planFor } from '../process/plan';
import type { ProcessGraph } from '../process/templates';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

/** A variable of the model: one observed column, or the mean score of a scale's items. */
export interface CpaVariable { name: string; indicators: string[]; /** Model as a latent variable (SAM) instead of the mean score. */ latent?: boolean }

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
  const variables = cat ? [...input.variables.filter((v) => v.name !== cat.x), ...cat.names.map((n) => ({ name: n, indicators: [n] }))] : input.variables;
  const used = new Set(variables.flatMap((v) => v.indicators));
  const keep = data.names.map((n, i) => [n, i] as const).filter(([n]) => used.has(n));
  const extraCols = cat ? cat.names.map((n, j) => ({ name: n, col: cat.codes[j] })) : [];
  return {
    kind: 'cpa',
    model: input.model ?? null,
    missing: input.missing,
    probe: input.probe,
    hc: input.hc ?? 'none',
    confidence: input.confidence,
    boot: input.boot,
    data: {
      names: [...keep.map(([n]) => n), ...extraCols.map((e) => e.name)],
      cols: [...keep.map(([, i]) => Array.from(data.cols[i], (v) => (Number.isNaN(v) ? null : v))), ...extraCols.map((e) => Array.from(e.col, (v) => (Number.isNaN(v) ? null : v)))],
    },
    variables: variables.map(({ name, indicators }) => ({ name, indicators })),
    latent: input.variables.filter((v) => v.latent && v.indicators.length > 1).map((v) => v.name),
    x: input.graph.x,
    y: input.graph.y,
    equations: plan.equations.map((e) => ({ outcome: e.outcome, terms: e.terms.map((vars) => ({ vars })) })),
    moderators: plan.moderators,
    direct: plan.direct,
    ...('directs' in plan && plan.directs ? { directs: plan.directs } : {}),
    indirect: plan.indirect,
    jn: plan.jn,
    interactions: plan.interactions.map((i) => ({ outcome: i.outcome, focal: i.focal, terms: i.terms.map((vars) => ({ vars })) })),
  };
}

export interface CpaEffect { est: number; se: number; lo: number; hi: number }
export interface CpaTest extends CpaEffect { t: number; p: number }
export type At = Record<string, number>;

export interface CpaResult {
  n: number;
  equations: {
    /** mse, F and its p are OLS quantities (null for latent-variable models). */
    outcome: string; n: number; r2: number; mse: number | null; f: number | null; df1: number | null; df2: number | null; p: number | null;
    /** term: [] for the constant, [v] for a variable, [a, b(, c)] for a product. */
    coefficients: ({ term: string[] } & CpaTest)[];
    /** Tests of the highest-order interactions (one row per product, plus a joint row for two or more). */
    interactions: { focal: string; terms: string[][]; r2change: number; f: number; df1: number; df2: number; p: number }[];
  }[];
  moderators: { name: string; values: number[] }[];
  direct: { moderators: string[]; rows: ({ at: At } & CpaTest)[] } | null;
  /** Multicategorical X: relative direct effects, one per code. */
  directs: { x: string; moderators: string[]; rows: ({ at: At } & CpaTest)[] }[];
  /** Multicategorical X: the codes used. */
  coding?: { x: string; coding: string; levels: number[]; names: string[]; table: number[][] };
  indirect: { path: string[]; moderators: string[]; rows: ({ at: At } & CpaEffect)[] }[];
  total: CpaEffect | null;
  indices: ({ kind: 'mm' | 'partial' | 'mmm' | 'cmm'; path: string[]; moderator?: string; at?: At } & CpaEffect)[];
  jn: {
    from: string; to: string; moderator: string; range: [number, number]; mean: number; sd: number;
    /** A latent moderator: range is the mean ± 3 SD, and there are no observed cases to count. */
    latent?: boolean;
    /** Conditional effect b + bint·w, with variances [var(b), cov(b, bint), var(bint)] and the critical t. */
    b: number; bint: number; v: [number, number, number]; crit: number;
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

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];

/** R's JSON writes 1-element vectors as scalars and empty lists as []: restore the shapes. */
export function parseCpaOutput(raw: Record<string, any>): CpaResult {
  const at = (v: unknown): At => (v && !Array.isArray(v) ? (v as At) : {});
  return {
    ...(raw as CpaResult),
    equations: arr<any>(raw.equations).map((e) => ({
      ...e,
      coefficients: arr<any>(e.coefficients).map((c) => ({ ...c, term: arr<string>(c.term) })),
      interactions: arr<any>(e.interactions).map((t) => ({ ...t, terms: arr<unknown>(t.terms).map((x) => arr<string>(x)) })),
    })),
    moderators: arr<any>(raw.moderators).map((m) => ({ name: m.name, values: arr<number>(m.values) })),
    direct: raw.direct ? { moderators: arr<string>(raw.direct.moderators), rows: arr<any>(raw.direct.rows).map((r) => ({ ...r, at: at(r.at) })) } : null,
    directs: arr<any>(raw.directs).map((d) => ({ x: d.x, moderators: arr<string>(d.moderators), rows: arr<any>(d.rows).map((r) => ({ ...r, at: at(r.at) })) })),
    indirect: arr<any>(raw.indirect).map((p) => ({ path: arr<string>(p.path), moderators: arr<string>(p.moderators), rows: arr<any>(p.rows).map((r) => ({ ...r, at: at(r.at) })) })),
    indices: arr<any>(raw.indices).map((i) => ({ ...i, path: arr<string>(i.path), at: i.at ? at(i.at) : undefined })),
    jn: arr<any>(raw.jn).map((j) => ({ ...j, range: arr<number>(j.range), v: arr<number>(j.v), bounds: arr<any>(j.bounds) })),
    warnings: rStrings(raw.warnings),
    inference: raw.inference === 'montecarlo' ? 'montecarlo' : 'bootstrap',
    hc: (['HC0', 'HC1', 'HC2', 'HC3', 'HC4'] as const).find((h) => h === raw.hc) ?? 'none',
    latent: arr<string>(raw.latent),
  };
}

export async function estimateCpaR(data: Dataset, input: CpaInput): Promise<CpaResult> {
  const r = parseCpaOutput(await rCall<Record<string, any>>('ps_cpa', cpaRequest(data, input), input.variables.some((v) => v.latent) ? 'manymomeSam' : 'manymome'));
  const cat = input.categorical;
  if (cat) r.coding = { x: cat.x, coding: cat.coding, levels: cat.levels, names: cat.names, table: cat.levels.map((_, g) => cat.names.map((_, j) => codeValue(cat.coding, cat.levels.length, g, j))) };
  return r;
}

export function cpaScriptR(data: Dataset, input: CpaInput): Promise<string> {
  return rScript('ps_cpa', cpaRequest(data, input), input.variables.some((v) => v.latent) ? 'manymomeSam' : 'manymome');
}

/** A Johnson–Neyman curve of a process result, in the moderator's own units (for JohnsonNeymanPlot). */
export function processJn(j: CpaResult['jn'][number]): JohnsonNeyman {
  const [v11, v13, v33] = j.v;
  const effect = (m: number) => j.b + j.bint * m;
  const se = (m: number) => Math.sqrt(Math.max(0, v11 + 2 * m * v13 + m * m * v33));
  // (b + bint·m)² = crit²·se(m)²: a quadratic in m.
  const q = j.crit * j.crit;
  const A = j.bint * j.bint - q * v33, B = 2 * (j.b * j.bint - q * v13), C = j.b * j.b - q * v11;
  const disc = B * B - 4 * A * C;
  const boundaries = disc < 0 || A === 0 ? [] : [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)].sort((a, b) => a - b);
  return { sdM: j.sd, crit: j.crit, bx: j.b, bint: j.bint, quadratic: false, effect, se, boundaries, significantAt: (m) => Math.abs(effect(m)) > j.crit * se(m) };
}
