// Power analysis for standard tests (R/pwr.R, the pwr package): t-tests, one-way ANOVA, proportions, a
// correlation, a chi-square test and multiple regression; a priori N, achieved power or sensitivity.

import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';
import { rList } from './rjson';

/** The tests pwr covers: one-sample, two-sample and paired t, one-way ANOVA, one and two proportions, r, χ², f². */
export type PwrTest = 't1' | 't2' | 'paired' | 'anova' | 'p1' | 'p2' | 'r' | 'chisq' | 'f2';
/** What is solved for: the N (a priori), the power (achieved) or the effect size (sensitivity). */
export type PwrSolve = 'n' | 'power' | 'effect';
export type PwrAlternative = 'two.sided' | 'less' | 'greater';

/** The request: the known quantities of the test (the solved one is left out). */
export interface PwrInput {
  test: PwrTest;
  solve: PwrSolve;
  alpha: number;
  alternative?: PwrAlternative;
  /** The effect size (d, f, h, r, w or f²); proportions may give it as two proportions instead. */
  effect?: number;
  effectFrom?: 'es' | 'props';
  prop1?: number;
  prop2?: number;
  /** N: per group for two samples, ANOVA and two proportions; pairs for paired; the total otherwise. */
  n?: number;
  power?: number;
  /** ANOVA: the number of groups; χ²: the degrees of freedom; f²: the predictors tested (numerator df). */
  k?: number;
  df?: number;
  u?: number;
}

export interface PwrResult {
  test: PwrTest;
  solve: PwrSolve;
  alternative: PwrAlternative;
  alpha: number;
  power: number;
  effect: number;
  /** The N as pwr gives it (fractional when solved) and rounded up. */
  n: number;
  nNeeded: number;
  k?: number;
  df?: number;
  u?: number;
  v?: number;
  method: string;
  note?: string;
  curve: { n: number[]; power: number[] };
  warnings: string[];
  engine: REngineInfo & { desktop?: string };
}

/** The request the bridge sends (only the fields the test uses). */
export function pwrRequest(i: PwrInput) {
  return { pwr: i };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The reply as the card reads it (R's nulls dropped, lists normalised). */
export function pwrResult(r: Record<string, any>): PwrResult {
  const out: PwrResult = {
    test: r.test,
    solve: r.solve,
    alternative: r.alternative,
    alpha: Number(r.alpha),
    power: Number(r.power),
    effect: Number(r.effect),
    n: Number(r.n),
    nNeeded: Number(r.nNeeded),
    method: String(r.method ?? ''),
    curve: {
      n: rList<unknown>(r.curve?.n).map(Number),
      power: rList<unknown>(r.curve?.power).map(Number),
    },
    warnings: rStrings(r.warnings),
    engine: r.engine,
  };
  for (const key of ['k', 'df', 'u', 'v'] as const) {
    const v = num(r[key]);
    if (v !== undefined) out[key] = v;
  }
  if (typeof r.note === 'string' && r.note) out.note = r.note;
  return out;
}

/** Run the power analysis in R (pwr). */
export async function pwrR(i: PwrInput): Promise<PwrResult> {
  return pwrResult(await rCall<Record<string, any>>('ps_pwr', pwrRequest(i), 'pwr'));
}

/** The self-contained R script of the analysis. */
export const pwrScriptR = (i: PwrInput) => rScript('ps_pwr', pwrRequest(i), 'pwr');
