// Basic statistical tests (R/tests.R, base R stats): t-tests, ANOVA and ANCOVA,
// repeated-measures ANOVA, MANOVA, correlations, contingency tables, binomial
// and multinomial tests.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

export type Alternative = 'two.sided' | 'greater' | 'less';
export interface HTest { stat: number; df?: number | number[] | null; p: number; ciLow?: number | null; ciHigh?: number | null; estimate?: number | null }
export interface Desc { n: number; mean: number; sd?: number | null; se?: number | null; median: number }

export interface TTestInput { type: 'one' | 'paired' | 'independent'; vars: string[]; pairs: [string, string][]; group: string; testValue: number; student: boolean; welch: boolean; rank: boolean; alternative: Alternative; confidence: number }
export interface TTestRow {
  label: string; variables: string[];
  student: HTest | null; welch: HTest | null; rank: HTest | null;
  d: number; dWelch?: number | null; rankBiserial?: number | null;
  levene: { stat: number; df1: number; df2: number; p: number } | null;
  shapiro: (HTest | null)[]; descriptives: Desc[];
}
export interface TTestResult { type: TTestInput['type']; alternative: Alternative; testValue: number; confidence: number; groups: string[] | null; rows: TTestRow[]; warnings: string[]; engine: REngineInfo }

export interface AnovaInput { dependent: string; factors: string[]; covariates: string[]; ssType: 'I' | 'III'; interactions: boolean; confidence: number }
export interface AnovaRow { term: string; ss: number; df: number; ms: number; f: number; p: number; eta2: number; partialEta2: number; omega2: number }
export interface AnovaResult {
  dependent: string; factors: string[]; covariates: string[]; ssType: 'I' | 'III'; formula: string;
  table: AnovaRow[]; residual: { ss: number; df: number; ms: number }; n: number;
  levene: { stat: number; df1: number; df2: number; p: number }; shapiro: HTest | null;
  welch: HTest | null; kruskal: HTest | null; tukey: { comparison: string; diff: number; ciLow: number; ciHigh: number; p: number }[] | null;
  /** One factor: pairwise Wilcoxon rank-sum tests after Kruskal-Wallis, p adjusted by Holm (absent in results from before they were added). */
  pairwiseRank?: { comparison: string; pHolm: number }[] | null;
  cells: (Desc & { cell: string })[]; warnings: string[]; engine: REngineInfo;
}

export interface RmAnovaInput { levels: string[]; factorName: string; between: string }
export interface RmRow { term: string; ss: number; df: number; ms: number; f?: number | null; p?: number | null; partialEta2?: number | null }
export interface RmAnovaResult {
  factorName: string; levels: string[]; between: string; n: number;
  within: RmRow[]; betweenTable: RmRow[];
  sphericity: { w: number; p: number; gg: number; hf: number };
  corrected: { term: string; p: number; pGG: number; pHF: number }[];
  friedman: HTest | null; cells: (Desc & { cell: string })[]; warnings: string[]; engine: REngineInfo;
  /** Every pair of levels by a paired t-test, p adjusted by Holm (absent in results from before they were added). */
  posthoc?: { comparison: string; diff: number; t: number; df: number; p: number; pHolm: number }[];
}

export interface ManovaInput { dependents: string[]; factors: string[]; interactions: boolean }
export interface ManovaResult { dependents: string[]; factors: string[]; n: number; tests: { test: string; rows: { term: string; df: number; value: number; f: number; df1: number; df2: number; p: number }[] }[]; warnings: string[]; engine: REngineInfo }

export interface CorrelationInput { vars: string[]; method: 'pearson' | 'spearman' | 'kendall'; alternative: Alternative; deletion: 'pairwise' | 'listwise'; confidence: number }
export interface CorrelationPair { a: string; b: string; r: number; p: number; n: number; stat: number; ciLow?: number | null; ciHigh?: number | null }
export interface CorrelationResult { method: CorrelationInput['method']; alternative: Alternative; confidence: number; deletion: CorrelationInput['deletion']; vars: string[]; pairs: CorrelationPair[]; warnings: string[]; engine: REngineInfo }

export interface ContingencyInput { rows: string; columns: string; counts: string; confidence: number }
export interface ContingencyResult {
  rows: string; columns: string; rowLevels: string[]; colLevels: string[]; counts: number[][]; expected: number[][]; n: number;
  chisq: HTest; yates: HTest | null; likelihoodRatio: { stat: number; df: number; p: number }; fisher: HTest | null; cramerV: number;
  phi: number | null; oddsRatio: { est: number; ciLow: number; ciHigh: number } | null; confidence: number; warnings: string[]; engine: REngineInfo;
}

export interface FreqTestInput { type: 'binomial' | 'multinomial'; variable: string; testValue: number; proportions: number[]; alternative: Alternative; confidence: number }
export interface FreqTestResult {
  type: FreqTestInput['type']; variable: string; levels: string[]; counts: number[]; n: number; alternative: Alternative; confidence: number;
  binomial: (HTest & { proportion: number })[] | null; testValue: number | null;
  multinomial: (HTest & { expected: number[] }) | null; warnings: string[]; engine: REngineInfo;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const obj = <T>(v: unknown): T | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as T : null);

/** The request: the named columns only (missing values as null) and the category names of text columns. */
function testRequest(data: Dataset, kind: string, columns: string[], fields: object) {
  if (data.moments && data.cols.length === 0) throw new Error('This test needs raw data; the dataset is a covariance matrix.');
  const names = [...new Set(columns.filter(Boolean))];
  for (const n of names) if (!data.names.includes(n)) throw new Error(`“${n}” is not a column of the dataset.`);
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => names.includes(n));
  const categories = Object.fromEntries(names.filter((c) => data.categories?.[c]).map((c) => [c, data.categories![c]]));
  return { kind, ...fields, categories, data: { names: keep.map(([n]) => n), cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) } };
}

const ttestCols = (i: TTestInput) => (i.type === 'paired' ? i.pairs.flat() : [...i.vars, i.type === 'independent' ? i.group : '']);
export const ttestRequest = (d: Dataset, i: TTestInput) => testRequest(d, 'ttest', ttestCols(i), i);
export async function ttestR(d: Dataset, i: TTestInput): Promise<TTestResult> {
  const r = await rCall<Record<string, any>>('ps_ttest', ttestRequest(d, i), 'stats');
  return { ...r, groups: r.groups ? arr<string>(r.groups) : null,
    rows: arr<any>(r.rows).map((x) => ({ ...x, variables: arr<string>(x.variables), student: obj<HTest>(x.student), welch: obj<HTest>(x.welch), rank: obj<HTest>(x.rank),
      levene: obj(x.levene), shapiro: arr<unknown>(x.shapiro).map((s) => obj<HTest>(s)), descriptives: arr<Desc>(x.descriptives) })),
    warnings: rStrings(r.warnings) } as TTestResult;
}
export const ttestScriptR = (d: Dataset, i: TTestInput) => rScript('ps_ttest', ttestRequest(d, i), 'stats');

export const anovaRequest = (d: Dataset, i: AnovaInput) => testRequest(d, 'anova', [i.dependent, ...i.factors, ...i.covariates], i);
export async function anovaR(d: Dataset, i: AnovaInput): Promise<AnovaResult> {
  const r = await rCall<Record<string, any>>('ps_anova', anovaRequest(d, i), 'stats');
  return { ...r, factors: arr<string>(r.factors), covariates: arr<string>(r.covariates), table: arr<AnovaRow>(r.table), shapiro: obj<HTest>(r.shapiro),
    welch: obj<HTest>(r.welch), kruskal: obj<HTest>(r.kruskal), tukey: r.tukey ? arr(r.tukey) : null, pairwiseRank: r.pairwiseRank ? arr(r.pairwiseRank) : null, cells: arr(r.cells), warnings: rStrings(r.warnings) } as AnovaResult;
}
export const anovaScriptR = (d: Dataset, i: AnovaInput) => rScript('ps_anova', anovaRequest(d, i), 'stats');

export const rmAnovaRequest = (d: Dataset, i: RmAnovaInput) => testRequest(d, 'rmanova', [...i.levels, i.between], i);
export async function rmAnovaR(d: Dataset, i: RmAnovaInput): Promise<RmAnovaResult> {
  const r = await rCall<Record<string, any>>('ps_rmanova', rmAnovaRequest(d, i), 'stats');
  return { ...r, levels: arr<string>(r.levels), within: arr<RmRow>(r.within), betweenTable: arr<RmRow>(r.betweenTable), corrected: arr(r.corrected),
    friedman: obj<HTest>(r.friedman), cells: arr(r.cells), posthoc: arr(r.posthoc), warnings: rStrings(r.warnings) } as RmAnovaResult;
}
export const rmAnovaScriptR = (d: Dataset, i: RmAnovaInput) => rScript('ps_rmanova', rmAnovaRequest(d, i), 'stats');

export const manovaRequest = (d: Dataset, i: ManovaInput) => testRequest(d, 'manova', [...i.dependents, ...i.factors], i);
export async function manovaR(d: Dataset, i: ManovaInput): Promise<ManovaResult> {
  const r = await rCall<Record<string, any>>('ps_manova', manovaRequest(d, i), 'stats');
  return { ...r, dependents: arr<string>(r.dependents), factors: arr<string>(r.factors), tests: arr<any>(r.tests).map((t) => ({ test: String(t.test), rows: arr(t.rows) })), warnings: rStrings(r.warnings) } as ManovaResult;
}
export const manovaScriptR = (d: Dataset, i: ManovaInput) => rScript('ps_manova', manovaRequest(d, i), 'stats');

export const correlationRequest = (d: Dataset, i: CorrelationInput) => testRequest(d, 'correlation', i.vars, i);
export async function correlationR(d: Dataset, i: CorrelationInput): Promise<CorrelationResult> {
  const r = await rCall<Record<string, any>>('ps_correlation', correlationRequest(d, i), 'stats');
  return { ...r, vars: arr<string>(r.vars), pairs: arr<CorrelationPair>(r.pairs), warnings: rStrings(r.warnings) } as CorrelationResult;
}
export const correlationScriptR = (d: Dataset, i: CorrelationInput) => rScript('ps_correlation', correlationRequest(d, i), 'stats');

export const contingencyRequest = (d: Dataset, i: ContingencyInput) => testRequest(d, 'contingency', [i.rows, i.columns, i.counts], i);
export async function contingencyR(d: Dataset, i: ContingencyInput): Promise<ContingencyResult> {
  const r = await rCall<Record<string, any>>('ps_contingency', contingencyRequest(d, i), 'stats');
  const mat = (m: unknown) => arr<unknown>(m).map((row) => arr<number>(row));
  return { ...r, rowLevels: arr<string>(r.rowLevels), colLevels: arr<string>(r.colLevels), counts: mat(r.counts), expected: mat(r.expected),
    yates: obj<HTest>(r.yates), fisher: obj<HTest>(r.fisher), phi: r.phi ?? null, oddsRatio: obj(r.oddsRatio), warnings: rStrings(r.warnings) } as ContingencyResult;
}
export const contingencyScriptR = (d: Dataset, i: ContingencyInput) => rScript('ps_contingency', contingencyRequest(d, i), 'stats');

export const freqTestRequest = (d: Dataset, i: FreqTestInput) => testRequest(d, 'freqtest', [i.variable], i);
export async function freqTestR(d: Dataset, i: FreqTestInput): Promise<FreqTestResult> {
  const r = await rCall<Record<string, any>>('ps_freqtest', freqTestRequest(d, i), 'stats');
  const mult = obj<Record<string, unknown>>(r.multinomial);
  return { ...r, levels: arr<string>(r.levels), counts: arr<number>(r.counts), binomial: r.binomial ? arr(r.binomial) : null, testValue: r.testValue ?? null,
    multinomial: mult ? { ...mult, expected: arr<number>(mult.expected) } : null, warnings: rStrings(r.warnings) } as FreqTestResult;
}
export const freqTestScriptR = (d: Dataset, i: FreqTestInput) => rScript('ps_freqtest', freqTestRequest(d, i), 'stats');

export interface ReliabilityInput { type: 'scale' | 'icc' | 'kappa' | 'blandaltman'; vars: string[]; confidence: number }
export interface ReliabilityResult {
  type: ReliabilityInput['type']; vars: string[]; n: number; confidence: number;
  alpha?: number; stdAlpha?: number; averageR?: number; omegaTotal?: number; glb?: number; mean?: number; sd?: number;
  items?: { item: string; alphaIfDropped: number; itemRest: number; mean: number; sd: number }[];
  icc?: { type: string; icc: number; f: number; df1: number; df2: number; p: number; ciLow: number; ciHigh: number }[];
  kappa?: { est: number; ciLow: number; ciHigh: number }; weighted?: { est: number; ciLow: number; ciHigh: number }; categories?: number;
  bias?: number; lower?: number; upper?: number; biasCiLow?: number; biasCiHigh?: number; points?: { mean: number[]; diff: number[] };
  warnings: string[]; engine: REngineInfo;
}
export const reliabilityRequest = (d: Dataset, i: ReliabilityInput) => testRequest(d, 'reliability', i.vars, i);
export async function reliabilityR(d: Dataset, i: ReliabilityInput): Promise<ReliabilityResult> {
  const r = await rCall<Record<string, any>>('ps_reliability', reliabilityRequest(d, i), i.type === 'blandaltman' ? 'stats' : 'psych');
  const pts = obj<{ mean: unknown; diff: unknown }>(r.points);
  return { ...r, vars: arr<string>(r.vars), ...(r.items ? { items: arr(r.items) } : {}), ...(r.icc ? { icc: arr(r.icc) } : {}),
    ...(pts ? { points: { mean: arr<number>(pts.mean), diff: arr<number>(pts.diff) } } : {}), warnings: rStrings(r.warnings) } as ReliabilityResult;
}
export const reliabilityScriptR = (d: Dataset, i: ReliabilityInput) => rScript('ps_reliability', reliabilityRequest(d, i), i.type === 'blandaltman' ? 'stats' : 'psych');

// ---- Bayesian tests (R/bayes.R): JASP's default priors

export interface Posterior { median: number; low: number; high: number }
export interface BTTestInput { type: TTestInput['type']; vars: string[]; pairs: [string, string][]; group: string; testValue: number; alternative: Alternative; priorWidth: number; seed: number; iterations: number; confidence: number }
export interface BTTestResult {
  type: BTTestInput['type']; alternative: Alternative; testValue: number; priorWidth: number; confidence: number; seed: number; iterations: number; groups: string[] | null;
  rows: { label: string; bf10: number; error: number; delta: Posterior }[]; warnings: string[]; engine: REngineInfo;
}
export interface BCorrelationInput { vars: string[]; alternative: Alternative; priorWidth: number; seed: number; iterations: number; confidence: number }
export interface BCorrelationResult {
  alternative: Alternative; priorWidth: number; confidence: number; seed: number; iterations: number; vars: string[];
  pairs: { a: string; b: string; r: number; n: number; bf10: number; error: number; rho: Posterior }[]; warnings: string[]; engine: REngineInfo;
}
export interface BBinomialInput { variable: string; testValue: number; alternative: Alternative; priorA: number; priorB: number; confidence: number }
export interface BBinomialResult {
  variable: string; levels: string[]; counts: number[]; n: number; alternative: Alternative; testValue: number; priorA: number; priorB: number; confidence: number;
  rows: { bf10: number; median: number; low: number; high: number }[]; warnings: string[]; engine: REngineInfo;
}

export const bttestRequest = (d: Dataset, i: BTTestInput) => testRequest(d, 'bttest', i.type === 'paired' ? i.pairs.flat() : [...i.vars, i.type === 'independent' ? i.group : ''], i);
export async function bttestR(d: Dataset, i: BTTestInput): Promise<BTTestResult> {
  const r = await rCall<Record<string, any>>('ps_bttest', bttestRequest(d, i), 'BayesFactor');
  return { ...r, groups: r.groups ? arr<string>(r.groups) : null, rows: arr(r.rows), warnings: rStrings(r.warnings) } as BTTestResult;
}
export const bttestScriptR = (d: Dataset, i: BTTestInput) => rScript('ps_bttest', bttestRequest(d, i), 'BayesFactor');

export const bcorrelationRequest = (d: Dataset, i: BCorrelationInput) => testRequest(d, 'bcorrelation', i.vars, i);
export async function bcorrelationR(d: Dataset, i: BCorrelationInput): Promise<BCorrelationResult> {
  const r = await rCall<Record<string, any>>('ps_bcorrelation', bcorrelationRequest(d, i), 'BayesFactor');
  return { ...r, vars: arr<string>(r.vars), pairs: arr(r.pairs), warnings: rStrings(r.warnings) } as BCorrelationResult;
}
export const bcorrelationScriptR = (d: Dataset, i: BCorrelationInput) => rScript('ps_bcorrelation', bcorrelationRequest(d, i), 'BayesFactor');

export const bbinomialRequest = (d: Dataset, i: BBinomialInput) => testRequest(d, 'bbinomial', [i.variable], i);
export async function bbinomialR(d: Dataset, i: BBinomialInput): Promise<BBinomialResult> {
  const r = await rCall<Record<string, any>>('ps_bbinomial', bbinomialRequest(d, i), 'stats');
  return { ...r, levels: arr<string>(r.levels), counts: arr<number>(r.counts), rows: arr(r.rows), warnings: rStrings(r.warnings) } as BBinomialResult;
}
export const bbinomialScriptR = (d: Dataset, i: BBinomialInput) => rScript('ps_bbinomial', bbinomialRequest(d, i), 'stats');
