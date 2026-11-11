// Estimated marginal means (R/emm.R, emmeans): the options the ANOVA, repeated-measures
// ANOVA and multilevel regression cards send, and the results they get back.

import { rList, rNum } from './rjson';

/** p-value adjustments of post hoc comparisons (emmeans' names). */
export const EMM_ADJUST = ['tukey', 'bonferroni', 'holm', 'scheffe', 'none'] as const;
export type EmmAdjust = (typeof EMM_ADJUST)[number];
/** Planned contrasts of one factor's levels. */
export const EMM_CONTRASTS = ['deviation', 'simple', 'helmert', 'polynomial', 'custom'] as const;
export type EmmContrastType = (typeof EMM_CONTRASTS)[number];
/** Degrees of freedom of a mixed model's marginal means (emmeans' lmer.df). */
export const EMM_DF = ['kenward-roger', 'satterthwaite', 'asymptotic'] as const;
export type EmmDf = (typeof EMM_DF)[number];

/** One planned contrast: a factor, its type, the reference level (simple), the weights (custom; one row per contrast). */
export interface EmmContrast {
  factor: string;
  type: EmmContrastType;
  reference: 'first' | 'last';
  weights: number[][];
}

/** What the marginal means section computes; terms are lists of factor names. */
export interface EmmOptions {
  terms: string[][];
  posthoc: string[][];
  adjust: EmmAdjust[];
  /** Games–Howell comparisons of each one-factor post hoc term (between-subjects factors only). */
  gamesHowell: boolean;
  /** Simple effects: `factor` tested at each level of `by`. */
  simple: { factor: string; by: string } | null;
  contrasts: EmmContrast[];
  /** Profile plot: `x` on the axis, a line per level of `lines` ('' for one line). */
  plot: { x: string; lines: string } | null;
  /** Mixed models only. */
  df: EmmDf;
}

export interface EmmMeanRow {
  levels: string[];
  emmean: number;
  se: number;
  df: number | null;
  lower: number;
  upper: number;
}
export interface EmmContrastRow {
  contrast: string;
  estimate: number;
  se: number;
  df: number | null;
  t: number;
  p?: number;
  lower: number;
  upper: number;
}
export interface EmmResult {
  confidence: number;
  df: EmmDf | null;
  means: { term: string[]; rows: EmmMeanRow[] }[];
  posthoc: {
    term: string[];
    adjust: EmmAdjust[];
    rows: (EmmContrastRow & { pAdjusted: Partial<Record<EmmAdjust, number>> })[];
  }[];
  gamesHowell: { factor: string; rows: EmmContrastRow[] }[];
  simple: {
    factor: string;
    by: string;
    rows: { level: string; df1: number; df2: number | null; f: number; p: number }[];
  } | null;
  contrasts: { factor: string; type: EmmContrastType; rows: EmmContrastRow[] }[];
  plot: {
    x: string;
    lines: string;
    rows: { x: string; line: string; emmean: number; lower: number; upper: number }[];
  } | null;
  version: string;
}

/** The request's `emm`: only what the R side reads (weights only for custom contrasts). */
export function emmRequest(o: EmmOptions, mixed = false): Record<string, unknown> {
  return {
    terms: o.terms,
    posthoc: o.posthoc,
    adjust: o.adjust,
    gamesHowell: o.gamesHowell,
    ...(o.simple ? { simple: o.simple } : {}),
    contrasts: o.contrasts.map((k) => {
      const base = { factor: k.factor, type: k.type, reference: k.reference };
      return k.type === 'custom' ? { ...base, weights: k.weights } : base;
    }),
    ...(o.plot ? { plot: o.plot } : {}),
    ...(mixed ? { df: o.df } : {}),
  };
}

/** The result's `emm` from R's JSON (null when none was asked for). */
export function parseEmm(v: unknown): EmmResult | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, any>;
  const contrastRows = (x: unknown) =>
    rList<any>(x).map((row) => ({ ...row, df: rNum(row.df) }) as EmmContrastRow);
  return {
    confidence: r.confidence,
    df: r.df ?? null,
    means: rList<any>(r.means).map((m) => ({
      term: rList<string>(m.term),
      rows: rList<any>(m.rows).map((row) => ({
        ...row,
        levels: rList<string>(row.levels),
        df: rNum(row.df),
      })),
    })),
    posthoc: rList<any>(r.posthoc).map((ph) => ({
      term: rList<string>(ph.term),
      adjust: rList<EmmAdjust>(ph.adjust),
      rows: rList<any>(ph.rows).map((row) => ({
        ...row,
        df: rNum(row.df),
        pAdjusted: row.pAdjusted ?? {},
      })),
    })),
    gamesHowell: rList<any>(r.gamesHowell).map((g) => ({
      factor: String(g.factor),
      rows: contrastRows(g.rows),
    })),
    simple: r.simple
      ? {
          factor: String(r.simple.factor),
          by: String(r.simple.by),
          rows: rList<any>(r.simple.rows).map((row) => ({ ...row, df2: rNum(row.df2) })),
        }
      : null,
    contrasts: rList<any>(r.contrasts).map((k) => ({
      factor: String(k.factor),
      type: k.type,
      rows: contrastRows(k.rows),
    })),
    plot: r.plot
      ? {
          x: String(r.plot.x),
          lines: String(r.plot.lines ?? ''),
          rows: rList<any>(r.plot.rows),
        }
      : null,
    version: String(r.version ?? ''),
  };
}
