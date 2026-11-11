// Exploratory factor analysis / principal component analysis: the design kept
// with the project (Settings.efa), and turning a solution into constructs.

import { clampStrict } from '../parse';

export type EfaMethod = 'pca' | 'minres' | 'ml' | 'pa' | 'lavaan';
export type EfaRotation = 'none' | 'varimax' | 'quartimax' | 'promax' | 'oblimin' | 'geominQ' | 'bigeomin' | 'biquartimin';
export const EFA_METHODS: { id: EfaMethod; label: string }[] = [
  { id: 'minres', label: 'Minimum residual' }, { id: 'ml', label: 'Maximum likelihood' },
  { id: 'pa', label: 'Principal axis' }, { id: 'pca', label: 'Principal components (PCA)' },
  { id: 'lavaan', label: 'Maximum likelihood with standard errors (lavaan)' },
];
/** `lavaan`: only with the lavaan extraction (bifactor rotations: a general factor, the first, and specific factors). */
export const EFA_ROTATIONS: { id: EfaRotation; label: string; oblique: boolean; lavaan?: true }[] = [
  { id: 'oblimin', label: 'Oblimin', oblique: true }, { id: 'promax', label: 'Promax', oblique: true }, { id: 'geominQ', label: 'Geomin (oblique)', oblique: true },
  { id: 'varimax', label: 'Varimax', oblique: false }, { id: 'quartimax', label: 'Quartimax', oblique: false }, { id: 'none', label: 'None', oblique: false },
  { id: 'bigeomin', label: 'Bi-geomin (bifactor)', oblique: true, lavaan: true }, { id: 'biquartimin', label: 'Bi-quartimin (bifactor)', oblique: true, lavaan: true },
];

/** How many factors / components: given (nfactors), or as many as a retention criterion keeps. */
export type EfaCriterion = 'parallel' | 'kaiser' | 'map' | 'fixed';
export const EFA_CRITERIA: { id: EfaCriterion; label: string }[] = [
  { id: 'parallel', label: 'Parallel analysis' }, { id: 'kaiser', label: 'Eigenvalues > 1 (Kaiser)' },
  { id: 'map', label: 'Velicer’s MAP' }, { id: 'fixed', label: 'Fixed number' },
];

export interface EfaDesign {
  vars: string[];
  method: EfaMethod;
  criterion: EfaCriterion;
  /** Used when criterion is 'fixed'. */
  nfactors: number;
  rotation: EfaRotation;
  missing: 'pairwise' | 'listwise';
  /** Parallel-analysis samples (0: none). */
  parallel: number;
  /** Loadings below this (absolute) are blanked in the table and left out when building a model. */
  threshold: number;
  /**
   * The correlations analysed: Pearson, or polychoric for ordinal (Likert) items (psych's mixedCor: tetrachoric for
   * binary items, polyserial with a continuous variable). Absent in designs saved before the option: Pearson.
   */
  correlation: 'pearson' | 'polychoric';
  /** lavaan extraction: geomin's ε (absent: lavaan's 0.001; Mplus uses 0.0001 with two factors, 0.001 with three, 0.01 with four or more). */
  epsilon?: number;
  /** lavaan extraction, maximum likelihood: standard errors from the observed information (Mplus's default); absent: the expected. */
  information?: 'observed';
  /** lavaan extraction, WLSMV (polychoric): 'lavaan': lavaan 0.7's standard errors (observed information in the sandwich); absent: Mplus's (classic WLSMV, the default). */
  wlsmvSe?: 'lavaan';
  /** lavaan extraction, WLSMV (polychoric): the test statistic as Mplus's (lavaan mimic = "Mplus"). */
  mimic?: 'Mplus';
  /** lavaan extraction: the fit is compared for every number of factors from this one (absent: 1) to the solution's (Mplus: TYPE = EFA 1 4). */
  from?: number;
  /**
   * A second solution of the same data and number of factors, compared with this one by Tucker's congruence
   * coefficients (psych::factor.congruence): a psych extraction and rotation. Absent: no comparison.
   */
  compare?: EfaComparison;
  /**
   * Second-order factor analysis by the Schmid–Leiman transformation, with ω hierarchical and total
   * (psych::omega): for a psych factor extraction, an oblique rotation and three or more factors.
   */
  schmid?: true;
}

/** Whether the design can have the Schmid–Leiman solution: null, or why not (the number of factors aside). */
export function schmidUnavailable(d: Pick<EfaDesign, 'method' | 'rotation'>): string | null {
  if (d.method === 'pca' || d.method === 'lavaan') {
    return 'The Schmid–Leiman solution needs a psych factor extraction (minimum residual, maximum likelihood or principal axis).';
  }
  if (!['oblimin', 'promax', 'geominQ'].includes(d.rotation)) {
    return 'The Schmid–Leiman solution needs an oblique rotation (oblimin, promax or geomin).';
  }
  return null;
}

/** The second solution of a congruence comparison: a psych extraction (not lavaan's) and a non-bifactor rotation. */
export interface EfaComparison {
  method: Exclude<EfaMethod, 'lavaan'>;
  rotation: Exclude<EfaRotation, 'bigeomin' | 'biquartimin'>;
}

/** Parallel analysis on polychoric correlations recomputes them for every sample: at most this many by default. */
export const POLYCHORIC_PARALLEL = 20;

export const DEFAULT_EFA: EfaDesign = { vars: [], method: 'minres', criterion: 'parallel', nfactors: 1, rotation: 'oblimin', missing: 'pairwise', parallel: 100, threshold: 0.3, correlation: 'pearson' };

/** A design from an (untrusted) project file. */
export function parseEfaDesign(v: unknown): EfaDesign | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  return {
    vars: (Array.isArray(r.vars) ? r.vars : []).filter((x): x is string => typeof x === 'string').slice(0, 2000).map((x) => x.slice(0, 200)),
    method: EFA_METHODS.find((m) => m.id === r.method)?.id ?? DEFAULT_EFA.method,
    // Designs saved before the criterion existed gave the number.
    criterion: EFA_CRITERIA.find((m) => m.id === r.criterion)?.id ?? 'fixed',
    nfactors: clampStrict(r.nfactors, 1, 100, DEFAULT_EFA.nfactors, true),
    rotation: EFA_ROTATIONS.find((m) => m.id === r.rotation)?.id ?? DEFAULT_EFA.rotation,
    missing: r.missing === 'listwise' ? 'listwise' : 'pairwise',
    parallel: clampStrict(r.parallel, 0, 2000, DEFAULT_EFA.parallel, true),
    threshold: typeof r.threshold === 'number' && r.threshold >= 0 && r.threshold < 1 ? r.threshold : DEFAULT_EFA.threshold,
    correlation: r.correlation === 'polychoric' ? 'polychoric' : 'pearson',
    ...(typeof r.epsilon === 'number' && r.epsilon > 0 && r.epsilon <= 1 ? { epsilon: r.epsilon } : {}),
    ...(r.information === 'observed' ? { information: 'observed' as const } : {}),
    ...(r.wlsmvSe === 'lavaan' ? { wlsmvSe: 'lavaan' as const } : {}),
    ...(r.mimic === 'Mplus' ? { mimic: 'Mplus' as const } : {}),
    ...(typeof r.from === 'number' && Number.isFinite(r.from) && r.from >= 1 ? { from: Math.min(100, Math.round(r.from)) } : {}),
    ...parseComparison(r.compare),
    ...(r.schmid === true ? { schmid: true as const } : {}),
  };
}

/** The comparison of an (untrusted) design: kept only when both its extraction and rotation are known. */
function parseComparison(v: unknown): { compare?: EfaComparison } {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {};
  const r = v as Record<string, unknown>;
  const method = EFA_METHODS.find((m) => m.id === r.method && m.id !== 'lavaan')?.id;
  const rotation = EFA_ROTATIONS.find((m) => m.id === r.rotation && !m.lavaan)?.id;
  if (!method || method === 'lavaan' || !rotation || rotation === 'bigeomin' || rotation === 'biquartimin') {
    return {};
  }
  return { compare: { method, rotation } };
}

/**
 * Lorenzo-Seva & ten Berge's (2006) reading of Tucker's congruence coefficient (its absolute value: a factor's sign
 * is arbitrary): .95 or more, the factors can be considered equal; .85 to .94, fair similarity; below .85, not similar.
 */
export function congruenceLabel(phi: number): 'equal' | 'fair similarity' | 'not similar' {
  const a = Math.abs(phi);
  if (a >= 0.95) return 'equal';
  if (a >= 0.85) return 'fair similarity';
  return 'not similar';
}

export interface CongruenceMatch {
  /** Row: the solution's factor. */
  factor: number;
  /** Column: the second solution's factor most congruent with it (largest absolute coefficient). */
  match: number;
  coefficient: number;
  /** Another of the solution's factors matches the same factor better or as well. */
  shared: boolean;
}

/** For each of the solution's factors, the most congruent factor of the second solution (factor order and sign are arbitrary). */
export function congruenceMatches(coefficients: number[][]): CongruenceMatch[] {
  const matches = coefficients.map((row, factor) => {
    let match = 0;
    for (let j = 1; j < row.length; j++) {
      if (Math.abs(row[j]) > Math.abs(row[match])) match = j;
    }
    return { factor, match, coefficient: row[match], shared: false };
  });
  for (const m of matches) {
    m.shared = matches.some((o) => o !== m && o.match === m.match);
  }
  return matches;
}

/**
 * Constructs from a solution: each variable goes to the factor it loads most
 * on, if that loading reaches the threshold (others are left out); factors
 * without variables are dropped. Oblique solutions also get the correlations
 * between the factors (drawn: they are estimated in a CFA).
 */
export function constructsFromSolution(r: { variables: string[]; factors: string[]; loadings: number[][]; oblique: boolean }, threshold: number): {
  constructs: { name: string; indicators: string[] }[]; correlated: boolean; left: string[];
} {
  const groups = r.factors.map((name) => ({ name, indicators: [] as string[] }));
  const left: string[] = [];
  r.variables.forEach((v, i) => {
    const row = r.loadings[i];
    let best = -1;
    for (let j = 0; j < row.length; j++) if (best < 0 || Math.abs(row[j]) > Math.abs(row[best])) best = j;
    if (best >= 0 && Math.abs(row[best]) >= threshold) groups[best].indicators.push(v); else left.push(v);
  });
  return { constructs: groups.filter((g) => g.indicators.length > 0), correlated: r.oblique, left };
}

/**
 * Row order of a loadings table (as psych's fa.sort): variables grouped by the
 * factor they load most on, within a factor by the size of that loading.
 */
export function loadingOrder(loadings: number[][]): number[] {
  const primary = loadings.map((row) => row.reduce((b, v, j) => (Math.abs(v) > Math.abs(row[b]) ? j : b), 0));
  return loadings.map((_, i) => i).sort((a, b) => primary[a] - primary[b] || Math.abs(loadings[b][primary[b]]) - Math.abs(loadings[a][primary[a]]));
}

/** Kaiser's (1974) labels for the measure of sampling adequacy. */
export function kmoLabel(v: number): string {
  return v >= 0.9 ? 'marvelous' : v >= 0.8 ? 'meritorious' : v >= 0.7 ? 'middling' : v >= 0.6 ? 'mediocre' : v >= 0.5 ? 'miserable' : 'unacceptable';
}

/**
 * A name for a factor built from a solution: the items' shared name prefix
 * without trailing digits or separators ("A1"…"A5" → "A", "trust_1"… → "trust"),
 * else the solution's label ("MR2"); made unique among `taken`.
 */
export function factorName(indicators: string[], fallback: string, taken: string[]): string {
  let prefix = indicators[0] ?? '';
  for (const v of indicators) while (prefix && !v.startsWith(prefix)) prefix = prefix.slice(0, -1);
  prefix = prefix.replace(/[\d\s._-]+$/, '');
  const base = prefix || fallback;
  let name = base;
  for (let i = 2; taken.includes(name); i++) name = `${base} ${i}`;
  return name;
}

/**
 * Toggle one variable of a list; with `range`, every variable between the
 * last one clicked (`anchor`) and this one takes this one's new state (as
 * shift-click in file lists). Keeps the list's order.
 */
export function toggleVariables(all: string[], chosen: string[], clicked: string, anchor: string | null, range: boolean): string[] {
  const on = !chosen.includes(clicked);
  const i = all.indexOf(clicked), a = anchor === null ? -1 : all.indexOf(anchor);
  const span = range && a >= 0 ? all.slice(Math.min(a, i), Math.max(a, i) + 1) : [clicked];
  const set = new Set(chosen);
  for (const v of span) if (on) set.add(v); else set.delete(v);
  return all.filter((v) => set.has(v));
}

export interface CrossLoading {
  variable: number;
  primary: number; primaryLoading: number;
  /** The strongest other factor (null with one factor). */
  secondary: number | null; secondaryLoading: number | null;
  gap: number | null;
  /** cross-loads: a second loading reaches the threshold; weak: the primary loading is below `weak`; close: primary and second differ by less than `gap`. */
  flags: ('cross-loads' | 'weak' | 'close')[];
}

/**
 * Each variable's primary and strongest secondary loading, and the usual
 * warnings (e.g. Howard 2016): a cross-loading at or above the threshold, a
 * primary loading below .40, or less than .20 between the two.
 */
export function crossLoadings(loadings: number[][], threshold: number, weak = 0.4, gap = 0.2): CrossLoading[] {
  return loadings.map((row, variable) => {
    const order = row.map((_, j) => j).sort((a, b) => Math.abs(row[b]) - Math.abs(row[a]));
    const p = order[0], s = order.length > 1 ? order[1] : null;
    const pl = row[p], sl = s === null ? null : row[s];
    const g = sl === null ? null : Math.abs(pl) - Math.abs(sl);
    const flags: CrossLoading['flags'] = [];
    if (sl !== null && Math.abs(sl) >= threshold) flags.push('cross-loads');
    if (Math.abs(pl) < weak) flags.push('weak');
    if (g !== null && g < gap) flags.push('close');
    return { variable, primary: p, primaryLoading: pl, secondary: s, secondaryLoading: sl, gap: g, flags };
  });
}

/** The conventional rotation of each analysis: varimax for PCA, oblimin for factor analysis. */
const conventionalRotation = (pca: boolean): EfaRotation => (pca ? 'varimax' : 'oblimin');

/**
 * Switch between factor analysis and PCA. Factor analysis comes back with
 * `extraction` (the method used before); a rotation still at the other
 * analysis's convention follows to this one's, a rotation the user chose stays.
 */
export function switchAnalysis(d: EfaDesign, pca: boolean, extraction: Exclude<EfaMethod, 'pca'> = 'minres'): EfaDesign {
  if (pca === (d.method === 'pca')) return d;
  // (a bifactor rotation is lavaan's only: PCA takes its conventional one)
  const keep = d.rotation !== conventionalRotation(!pca) && !(pca && EFA_ROTATIONS.find((x) => x.id === d.rotation)?.lavaan);
  return { ...d, method: pca ? 'pca' : extraction, rotation: keep ? d.rotation : conventionalRotation(pca) };
}
