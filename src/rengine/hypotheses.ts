// Informative hypotheses on the labelled parameters of the CB-SEM model on the canvas (R/hypotheses.R): GORICA
// values and weights (restriktor::goric) and approximate adjusted fractional Bayes factors (bain::bain).

import { rCall, rScript, rStrings, type RPackage } from './bridge';
import { rList, rNum } from './rjson';
import { cbCallRequest, type CbCall } from './cbExtras';
import type { REngineInfo } from './lavaan';
import { constraintText, parseHypotheses } from '../model/hypothesis';

export type HypMethod = 'gorica' | 'bain' | 'both';
export type HypComparison = 'complement' | 'unconstrained' | 'none';
export interface HypRequest { text: string; method: HypMethod; comparison: HypComparison; standardized: boolean; fraction: number; seed: number }

export interface GoricaResult { models: string[]; loglik: number[]; penalty: number[]; gorica: number[]; weights: number[]; ratio: (number | null)[][]; comparison: HypComparison }
export interface BainResult { rows: string[]; fit: (number | null)[]; com: (number | null)[]; bfu: (number | null)[]; bfc: (number | null)[]; pmpa: (number | null)[]; pmpb: (number | null)[]; pmpc: (number | null)[]; matrix: (number | null)[][]; fraction: number }
export interface HypResult {
  /** Each hypothesis as sent to R (its constraints joined by &). */
  hypotheses: string[];
  /** The labelled parameters the hypotheses name: estimates (standardised when asked) and standard errors. */
  estimates: { label: string; what: string; est: number | null; se: number | null }[];
  standardized: boolean; n: number; gorica: GoricaResult | null; bain: BainResult | null; warnings: string[]; engine: REngineInfo;
}

/** The package set a method needs (bridge.ts R_PACKAGES). */
export const hypPackage = (m: HypMethod): RPackage => (m === 'gorica' ? 'restriktor' : m === 'bain' ? 'bain' : 'informative');

/** The request's hypotheses: each its constraints, printed from the parsed text (throws on invalid text). */
const hypField = (o: HypRequest) => ({
  hypotheses: parseHypotheses(o.text).map((h) => ({ constraints: h.constraints.map(constraintText) })),
  method: o.method, comparison: o.comparison, standardized: o.standardized, fraction: o.fraction, seed: o.seed,
});

const nums = (v: unknown) => rList<unknown>(v).map(rNum);
export function parseHyp(r: Record<string, any>): HypResult {
  const e = r.estimates ?? {};
  const labels = rList<string>(e.label), what = rList<string>(e.what), est = nums(e.est), se = nums(e.se);
  const g = r.gorica, b = r.bain;
  return {
    hypotheses: rList<string>(r.hypotheses), estimates: labels.map((label, i) => ({ label, what: what[i] ?? label, est: est[i] ?? null, se: se[i] ?? null })),
    standardized: r.standardized === true, n: rNum(r.n) ?? 0,
    gorica: g ? { models: rList<string>(g.models), loglik: nums(g.loglik).map((x) => x ?? NaN), penalty: nums(g.penalty).map((x) => x ?? NaN), gorica: nums(g.gorica).map((x) => x ?? NaN), weights: nums(g.weights).map((x) => x ?? NaN), ratio: rList<unknown>(g.ratio).map(nums), comparison: g.comparison } : null,
    bain: b ? { rows: rList<string>(b.rows), fit: nums(b.fit), com: nums(b.com), bfu: nums(b.bfu), bfc: nums(b.bfc), pmpa: nums(b.pmpa), pmpb: nums(b.pmpb), pmpc: nums(b.pmpc), matrix: rList<unknown>(b.matrix).map(nums), fraction: rNum(b.fraction) ?? 1 } : null,
    warnings: rStrings(r.warnings), engine: r.engine,
  };
}

export async function hypothesesR(c: CbCall, o: HypRequest): Promise<HypResult> {
  return parseHyp(await rCall<Record<string, any>>('ps_cb_hypotheses', cbCallRequest(c, { hyp: hypField(o) }), hypPackage(o.method)));
}
export const hypothesesScriptR = (c: CbCall, o: HypRequest) => rScript('ps_cb_hypotheses', cbCallRequest(c, { hyp: hypField(o) }), hypPackage(o.method));
