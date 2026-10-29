// Exploratory factor analysis / principal component analysis: the design kept
// with the project (Settings.efa), and turning a solution into constructs.

export type EfaMethod = 'pca' | 'minres' | 'ml' | 'pa';
export type EfaRotation = 'none' | 'varimax' | 'quartimax' | 'promax' | 'oblimin' | 'geominQ';
export const EFA_METHODS: { id: EfaMethod; label: string }[] = [
  { id: 'minres', label: 'Minimum residual' }, { id: 'ml', label: 'Maximum likelihood' },
  { id: 'pa', label: 'Principal axis' }, { id: 'pca', label: 'Principal components (PCA)' },
];
export const EFA_ROTATIONS: { id: EfaRotation; label: string; oblique: boolean }[] = [
  { id: 'oblimin', label: 'Oblimin', oblique: true }, { id: 'promax', label: 'Promax', oblique: true }, { id: 'geominQ', label: 'Geomin (oblique)', oblique: true },
  { id: 'varimax', label: 'Varimax', oblique: false }, { id: 'quartimax', label: 'Quartimax', oblique: false }, { id: 'none', label: 'None', oblique: false },
];

export interface EfaDesign {
  vars: string[];
  method: EfaMethod;
  nfactors: number;
  rotation: EfaRotation;
  missing: 'pairwise' | 'listwise';
  /** Parallel-analysis samples (0: none). */
  parallel: number;
  /** Loadings below this (absolute) are blanked in the table and left out when building a model. */
  threshold: number;
}

export const DEFAULT_EFA: EfaDesign = { vars: [], method: 'minres', nfactors: 1, rotation: 'oblimin', missing: 'pairwise', parallel: 100, threshold: 0.3 };

/** A design from an (untrusted) project file. */
export function parseEfaDesign(v: unknown): EfaDesign | undefined {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  const int = (x: unknown, lo: number, hi: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, Math.round(x))) : d);
  return {
    vars: (Array.isArray(r.vars) ? r.vars : []).filter((x): x is string => typeof x === 'string').slice(0, 2000).map((x) => x.slice(0, 200)),
    method: EFA_METHODS.find((m) => m.id === r.method)?.id ?? DEFAULT_EFA.method,
    nfactors: int(r.nfactors, 1, 100, DEFAULT_EFA.nfactors),
    rotation: EFA_ROTATIONS.find((m) => m.id === r.rotation)?.id ?? DEFAULT_EFA.rotation,
    missing: r.missing === 'listwise' ? 'listwise' : 'pairwise',
    parallel: int(r.parallel, 0, 2000, DEFAULT_EFA.parallel),
    threshold: typeof r.threshold === 'number' && r.threshold >= 0 && r.threshold < 1 ? r.threshold : DEFAULT_EFA.threshold,
  };
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
