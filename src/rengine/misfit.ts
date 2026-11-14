// The "Diagnose misfit" panel's numbers (R/misfit.R): the largest residual correlations with their
// z-statistics (lavaan::lavResiduals) and the modification indices ranked by the size of the standardised
// expected parameter change (lavaan::modindices, sepc.all), each judged by the decision rule of Saris,
// Satorra & van der Veld (2009) as semTools::epcEquivFit applies it (its default sizes of interest).

import { pnorm } from '../engine/stats';

/** One fixed parameter's modification index (in the app's names). */
export interface MisfitMi {
  lhs: string;
  op: '=~' | '~' | '~~';
  rhs: string;
  mi: number;
  epc: number;
  /** Standardised expected parameter change (lavaan sepc.all). */
  sepc: number;
  group?: string;
}

/** One pair of observed variables: residual correlation (observed − implied) and its z-statistic. */
export interface MisfitPair {
  a: string;
  b: string;
  r: number;
  z: number | null;
}

export interface MisfitResult {
  /** At most 150 rows, the largest |SEPC| first. */
  mi: MisfitMi[];
  /** How many fixed parameters lavaan computed an index for (before keeping the largest). */
  miCount: number;
  /** One block per group (`group` set with several groups); the largest |z| first. */
  residuals: { group?: string; pairs: MisfitPair[] }[];
  /** The R code that computed these, to run after the model's own script. */
  code: string[];
  /** Why lavaan could not compute them. */
  error?: string;
}

const OPS = ['=~', '~', '~~'] as const;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));
const list = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  return v && typeof v === 'object' ? [v] : [];
};

/** The bridge's misfit result, checked field by field (rows with missing numbers dropped). */
export function parseMisfit(raw: unknown): MisfitResult | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const code = list(r.code).map(text);
  if (typeof r.error === 'string') {
    return { mi: [], miCount: 0, residuals: [], code, error: r.error };
  }
  const mi: MisfitMi[] = [];
  for (const x of list(r.mi) as Record<string, unknown>[]) {
    const op = OPS.find((o) => o === x.op);
    if (!op || !finite(x.mi) || !finite(x.epc) || !finite(x.sepc)) continue;
    mi.push({
      lhs: text(x.lhs),
      op,
      rhs: text(x.rhs),
      mi: x.mi,
      epc: x.epc,
      sepc: x.sepc,
      ...(typeof x.group === 'string' ? { group: x.group } : {}),
    });
  }
  const residuals = (list(r.residuals) as Record<string, unknown>[]).map((b) => ({
    ...(typeof b.group === 'string' ? { group: b.group } : {}),
    pairs: (list(b.pairs) as Record<string, unknown>[])
      .filter((p) => finite(p.r))
      .map((p) => ({
        a: text(p.a),
        b: text(p.b),
        r: p.r as number,
        z: finite(p.z) ? p.z : null,
      })),
  }));
  return { mi, miCount: finite(r.miCount) ? r.miCount : mi.length, residuals, code };
}

// ---------- the decision rule (Saris, Satorra & van der Veld 2009) ----------

/** χ²(1) critical value at α = .05, and its square root (the two-sided normal critical value). */
export const MI_CRITICAL = 3.841458820694124;
const Z_CRITICAL = 1.959963984540054;
/** Power counted as high (semTools::epcEquivFit's default). */
export const HIGH_POWER = 0.8;

/**
 * The smallest standardised misspecification worth detecting (Saris et al. 2009; semTools' defaults): a
 * loading of .4; a correlation (latent or residual) or a standardised path of .1.
 */
export function sizeOfInterest(op: MisfitMi['op']): number {
  return op === '=~' ? 0.4 : 0.1;
}

/**
 * Power of the MI test (α = .05) to detect a misspecification of size `delta`: the MI is a non-central χ²(1)
 * whose non-centrality for that size is MI × (δ / SEPC)² (Saris, Satorra & Sörbom 1987).
 */
export function miPower(mi: number, sepc: number, delta: number): number {
  if (!(mi >= 0) || !Number.isFinite(sepc) || sepc === 0) return NaN;
  const root = Math.sqrt(mi) * Math.abs(delta / sepc);
  // P(χ²₁(λ) > c²) = P(|Z + √λ| > c)
  return pnorm(root - Z_CRITICAL) + pnorm(-Z_CRITICAL - root);
}

/** semTools' codes: M misspecified, EPC:M misspecified by the size of the EPC, EPC:NM, NM not, I inconclusive. */
export type SarisDecision = 'M' | 'EPC:M' | 'EPC:NM' | 'NM' | 'I';

/**
 * The decision for one fixed parameter: a significant MI with low power is a misspecification (even a small
 * one would hardly be significant); with high power, its SEPC decides; a non-significant MI with high power is
 * no misspecification; with low power the test cannot tell.
 */
export function sarisDecision(mi: number, sepc: number, delta: number): SarisDecision | null {
  const power = miPower(mi, sepc, delta);
  if (Number.isNaN(power)) return null;
  const significant = mi > MI_CRITICAL;
  const high = power > HIGH_POWER;
  if (significant && high) return Math.abs(sepc) > Math.abs(delta) ? 'EPC:M' : 'EPC:NM';
  if (significant) return 'M';
  if (high) return 'NM';
  return 'I';
}

/** A decision in plain words, and how it is shown (a CSS class). */
export const DECISION_LABEL: Record<SarisDecision, { text: string; cls: string }> = {
  M: { text: 'Likely misspecified', cls: 'bad' },
  'EPC:M': { text: 'Likely misspecified (large change)', cls: 'bad' },
  'EPC:NM': { text: 'Significant but small: no change needed', cls: 'good' },
  NM: { text: 'No misspecification', cls: 'good' },
  I: { text: 'Inconclusive: too little power to tell', cls: 'warn' },
};

export interface JudgedMi extends MisfitMi {
  delta: number;
  power: number;
  decision: SarisDecision | null;
}

/** Every row judged, the largest |SEPC| first (a stable sort: ties keep lavaan's order). */
export function judgeMis(rows: readonly MisfitMi[]): JudgedMi[] {
  return rows
    .map((m) => {
      const delta = sizeOfInterest(m.op);
      return {
        ...m,
        delta,
        power: miPower(m.mi, m.sepc, delta),
        decision: sarisDecision(m.mi, m.sepc, delta),
      };
    })
    .sort((x, y) => Math.abs(y.sepc) - Math.abs(x.sepc));
}

// ---------- poor fit ----------

/** The fit indices the guideline cutoffs (Hu & Bentler 1999) flag, given the indices to report. */
export function poorFitIndices(f: {
  cfi: number;
  rmsea: number;
  srmr: number;
}): ('CFI' | 'RMSEA' | 'SRMR')[] {
  const out: ('CFI' | 'RMSEA' | 'SRMR')[] = [];
  if (Number.isFinite(f.cfi) && f.cfi < 0.95) out.push('CFI');
  if (Number.isFinite(f.rmsea) && f.rmsea > 0.06) out.push('RMSEA');
  if (Number.isFinite(f.srmr) && f.srmr > 0.08) out.push('SRMR');
  return out;
}

/** The result with its groups renamed (codes of a text column to the category names). */
export function misfitWithGroupNames(
  r: MisfitResult,
  name: (code: string) => string,
): MisfitResult {
  return {
    ...r,
    mi: r.mi.map((m) => (m.group ? { ...m, group: name(m.group) } : m)),
    residuals: r.residuals.map((b) => (b.group ? { ...b, group: name(b.group) } : b)),
  };
}
