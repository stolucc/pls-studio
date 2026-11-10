// Score-based tests of measurement invariance along a covariate (R/scoretest.R): the CB-SEM model on the canvas
// fitted with lavaan, its casewise scores ordered by the covariate as an empirical fluctuation process
// (strucchange::gefp), and the test the functional gives (Merkle & Zeileis 2013; Merkle, Fan & Zeileis 2014).

import { rCall, rScript, rStrings } from './bridge';
import { rList } from './reply';
import { cbCallRequest, type CbCall } from './cbExtras';
import type { REngineInfo } from './lavaan';

export type ScoreScale = 'continuous' | 'ordinal' | 'categorical';
/** The tests for each kind of covariate (strucchange's names: maxBB, meanL2BB, supLM; ordwmax, ordL2BB; catL2BB). */
export const SCORE_TESTS: Record<ScoreScale, readonly ScoreFn[]> = { continuous: ['DM', 'CvM', 'maxLM'], ordinal: ['WDMo', 'maxLMo'], categorical: ['LMuo'] };
export const SCORE_FNS = ['DM', 'CvM', 'maxLM', 'WDMo', 'maxLMo', 'LMuo'] as const;
export type ScoreFn = (typeof SCORE_FNS)[number];
/** The parameter sets that can be tested ('all': every free parameter). */
export const SCORE_SETS = ['loadings', 'intercepts', 'residuals', 'rescov', 'lvvar', 'lvcov', 'means', 'regressions', 'all'] as const;
export type ScoreSet = (typeof SCORE_SETS)[number];

export interface ScoreArgs { covariate: string; scale: ScoreScale; fn: ScoreFn; sets: ScoreSet[]; seed: number; nrep: number }

export interface ScoreTestResult {
  fn: ScoreFn; scale: ScoreScale; covariate: string; n: number; nGroups: number;
  statistic: number; p: number;
  /** The parameters tested, labelled with the user's names, and their kind (ScoreSet). */
  params: string[]; kinds: string[];
  /** Each tested parameter's maximum absolute fluctuation (its own double-max statistic; DM's critical value applies). */
  componentMax: number[];
  /** The 5% critical value of the statistic. */
  critical: number;
  /** Where the aggregated process peaks: the covariate value (continuous) or the category (ordinal); null for LMuo. */
  peak: number | string | null;
  /** The categories of an ordinal or categorical covariate (its values, in order). */
  levels: string[];
  /** The aggregated process as strucchange plots it, with its 5% boundary (one value, or one per point). */
  series: { x: number[]; y: number[]; boundary: number | number[]; labels: string[] | null };
  nrep: number | null; seed: number | null;
  warnings: string[];
  engine: REngineInfo & { lavaan?: string };
}

const num = (v: unknown) => (typeof v === 'number' ? v : NaN);

/** The request: the model as the Model tab fits it, and the covariate's values for every row of the data. */
export function scoreRequest(c: CbCall, a: ScoreArgs) {
  const at = c.data.names.indexOf(a.covariate);
  const values = at < 0 ? [] : Array.from(c.data.cols[at], (v) => (Number.isNaN(v) ? null : v));
  return cbCallRequest(c, { scoretest: { covariate: a.covariate, values, scale: a.scale, fn: a.fn, sets: a.sets, seed: a.seed, nrep: a.nrep } });
}

export function parseScoreOutput(r: Record<string, any>): ScoreTestResult {
  const s = r.series && typeof r.series === 'object' ? r.series as Record<string, unknown> : {};
  const b = s.boundary;
  return {
    fn: r.fn, scale: r.scale, covariate: String(r.covariate ?? ''), n: num(r.n), nGroups: num(r.nGroups ?? 1),
    statistic: num(r.statistic), p: num(r.p), params: rList<unknown>(r.params).map(String), kinds: rList<unknown>(r.kinds).map(String),
    componentMax: rList<unknown>(r.componentMax).map(num), critical: num(r.critical),
    peak: typeof r.peak === 'number' || typeof r.peak === 'string' ? r.peak : null, levels: rList<unknown>(r.levels).map(String),
    series: { x: rList<unknown>(s.x).map(num), y: rList<unknown>(s.y).map(num), boundary: Array.isArray(b) ? b.map(num) : num(b), labels: s.labels == null ? null : rList<unknown>(s.labels).map(String) },
    nrep: typeof r.nrep === 'number' ? r.nrep : null, seed: typeof r.seed === 'number' ? r.seed : null,
    warnings: rStrings(r.warnings), engine: r.engine,
  };
}

export async function scoreTestR(c: CbCall, a: ScoreArgs): Promise<ScoreTestResult> {
  return parseScoreOutput(await rCall<Record<string, any>>('ps_scoretest', scoreRequest(c, a), 'strucchange'));
}
export const scoreTestScriptR = (c: CbCall, a: ScoreArgs) => rScript('ps_scoretest', scoreRequest(c, a), 'strucchange');
