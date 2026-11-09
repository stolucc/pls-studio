// Fuzzy-set QCA (R/qca.R): the QCA package's calibrate(), pof(), truthTable() and minimize(),
// requests built from the card's options and the JSON result typed for the view.

import type { Dataset } from '../engine/types';
import { rCall, rScript, rStrings } from './bridge';
import type { REngineInfo } from './lavaan';

/** How a column becomes a set: as it is (already fuzzy or crisp), or Ragin's direct method with three anchors. */
export type QcaCalibration = { method: 'none' } | { method: 'direct'; e: number; c: number; i: number };
/** A directional expectation for the intermediate solution: present, absent, or no expectation. */
export type QcaExpectation = '1' | '0' | '-';
export type QcaSortBy = 'OUT, incl' | 'OUT, incl, n' | 'incl, n' | 'incl' | 'OUT' | 'n';
export const QCA_SORT_BY: QcaSortBy[] = ['OUT, incl', 'OUT, incl, n', 'incl, n', 'incl', 'OUT', 'n'];

export interface QcaSpec {
  outcome: string; conditions: string[]; negate: boolean;
  calibration: Record<string, QcaCalibration>;
  nCut: number; inclCut: number; priCut: number; sortBy: QcaSortBy;
  dirExp: QcaExpectation[];
  /** A text column whose values name the cases (shown in the truth table and the solutions). */
  labels?: string;
}

export interface QcaCalibrationSummary { variable: string; method: 'none' | 'direct'; e?: number; c?: number; i?: number; min: number; max: number; above: number; crisp: boolean }
export interface QcaNecessity { condition: string; inclN: number; RoN: number; covN: number }
export interface QcaTruthRow { id: string; values: number[]; out: '1' | '0' | 'C' | '?'; n: number; incl: number | null; pri: number | null; cases: string }
export interface QcaTerm { term: string; inclS: number; PRI: number; covS: number; covU: number | null; cases: string }
export interface QcaModel { label: string; terms: QcaTerm[]; inclS: number; PRI: number; covS: number; /** Membership in the solution (fuzzy OR of its terms), per case. */ membership: number[] }
export type QcaSolutionKind = 'complex' | 'parsimonious' | 'intermediate';
export interface QcaSolution { kind: QcaSolutionKind; models: QcaModel[]; essential: string[]; /** Simplifying assumptions (parsimonious) or easy counterfactuals (intermediate) used: truth table rows. */ counterfactuals: number }
export interface QcaResult {
  outcome: string; negated: boolean; conditions: string[]; n: number; labels: string[] | null;
  calibration: QcaCalibrationSummary[]; necessity: QcaNecessity[];
  truthTable: { rows: QcaTruthRow[]; remainders: number; nCut: number; inclCut: number; priCut: number; sortBy: string; counts: { out1: number; out0: number; contradictions: number } };
  expectations: QcaExpectation[];
  solutions: Record<QcaSolutionKind, QcaSolution | null>;
  /** The (calibrated, possibly negated) outcome per case, for the XY plot. */
  outcomeValues: number[];
  warnings: string[]; engine: REngineInfo;
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v : v == null ? [] : [v]) as T[];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const n0 = (v: unknown) => num(v) ?? NaN;

/** The outcome as QCA writes it: ~Y when negated. */
export const qcaOutcomeLabel = (outcome: string, negated: boolean) => `${negated ? '~' : ''}${outcome}`;
/** A model as QCA prints it: "DEV*~IND + URB*STB -> SURV". */
export const qcaFormula = (m: QcaModel, outcome: string, negated: boolean) => `${m.terms.map((t) => t.term).join(' + ')} -> ${qcaOutcomeLabel(outcome, negated)}`;

/** The case labels of a text column (its categories by code), or null when the column is not categorical. */
export function caseLabels(data: Dataset, column: string): string[] | null {
  const k = data.names.indexOf(column);
  const cats = data.categories?.[column];
  if (k < 0 || !cats) return null;
  return Array.from(data.cols[k], (v, r) => (Number.isFinite(v) && cats[v - 1] !== undefined ? cats[v - 1] : `${r + 1}`));
}

export function qcaRequest(data: Dataset, s: QcaSpec) {
  if (data.moments && data.cols.length === 0) throw new Error('QCA needs raw data; this dataset is a covariance matrix.');
  const used = [...s.conditions, s.outcome];
  const keep = data.names.map((n, k) => [n, k] as const).filter(([n]) => used.includes(n));
  const labels = s.labels ? caseLabels(data, s.labels) : null;
  return {
    outcome: s.outcome, conditions: s.conditions, negate: s.negate,
    calibration: Object.fromEntries(used.map((n) => [n, s.calibration[n] ?? { method: 'none' }])),
    nCut: s.nCut, inclCut: s.inclCut, priCut: s.priCut, sortBy: s.sortBy, dirExp: s.dirExp,
    ...(labels ? { labels } : {}),
    data: { names: keep.map(([n]) => n), cols: keep.map(([, k]) => Array.from(data.cols[k], (v) => (Number.isNaN(v) ? null : v))) },
  };
}

function solution(raw: unknown): QcaSolution | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  return {
    kind: s.kind as QcaSolutionKind, essential: rStrings(s.essential), counterfactuals: num(s.counterfactuals) ?? 0,
    models: arr<Record<string, unknown>>(s.models).map((m, i) => ({
      label: typeof m.label === 'string' ? m.label : `M${i + 1}`, inclS: n0(m.inclS), PRI: n0(m.PRI), covS: n0(m.covS), membership: arr<unknown>(m.membership).map(n0),
      terms: arr<Record<string, unknown>>(m.terms).map((t) => ({ term: String(t.term), inclS: n0(t.inclS), PRI: n0(t.PRI), covS: n0(t.covS), covU: num(t.covU), cases: typeof t.cases === 'string' ? t.cases : '' })),
    })),
  };
}

export function parseQcaOutput(raw: Record<string, any>): QcaResult {
  const tt = raw.truthTable ?? {};
  return {
    outcome: raw.outcome, negated: !!raw.negated, conditions: rStrings(raw.conditions), n: num(raw.n) ?? 0, labels: raw.labels == null ? null : rStrings(raw.labels),
    calibration: arr<any>(raw.calibration).map((k) => ({ variable: k.variable, method: k.method === 'direct' ? 'direct' : 'none', e: num(k.e) ?? undefined, c: num(k.c) ?? undefined, i: num(k.i) ?? undefined, min: n0(k.min), max: n0(k.max), above: num(k.above) ?? 0, crisp: !!k.crisp })),
    necessity: arr<any>(raw.necessity).map((k) => ({ condition: k.condition, inclN: n0(k.inclN), RoN: n0(k.RoN), covN: n0(k.covN) })),
    truthTable: {
      rows: arr<any>(tt.rows).map((r) => ({ id: String(r.id), values: arr<unknown>(r.values).map(n0), out: r.out, n: num(r.n) ?? 0, incl: num(r.incl), pri: num(r.pri), cases: typeof r.cases === 'string' ? r.cases : '' })),
      remainders: num(tt.remainders) ?? 0, nCut: n0(tt.nCut), inclCut: n0(tt.inclCut), priCut: n0(tt.priCut), sortBy: String(tt.sortBy ?? ''),
      counts: { out1: num(tt.counts?.out1) ?? 0, out0: num(tt.counts?.out0) ?? 0, contradictions: num(tt.counts?.contradictions) ?? 0 },
    },
    expectations: rStrings(raw.expectations) as QcaExpectation[],
    solutions: { complex: solution(raw.solutions?.complex), parsimonious: solution(raw.solutions?.parsimonious), intermediate: solution(raw.solutions?.intermediate) },
    outcomeValues: arr<unknown>(raw.outcomeValues).map(n0),
    warnings: rStrings(raw.warnings), engine: raw.engine,
  };
}

export async function qcaR(data: Dataset, s: QcaSpec): Promise<QcaResult> {
  return parseQcaOutput(await rCall<Record<string, any>>('ps_qca', qcaRequest(data, s), 'QCA'));
}
export const qcaScriptR = (data: Dataset, s: QcaSpec) => rScript('ps_qca', qcaRequest(data, s), 'QCA');
