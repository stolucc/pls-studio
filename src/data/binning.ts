// Recoding a numeric column into a new computed column (SPSS's Visual Binning
// and RECODE INTO DIFFERENT VARIABLES): bins of equal width or equal counts or
// at the user's cut points, or old values (and ranges) to new ones. Each recode
// is written as a formula of the computed-column language (data/compute.ts),
// so the new column stays transparent and is recomputed like any other; the
// bins get value labels.

import { quantileSorted } from '../engine/stats';
import type { Dataset } from '../engine/types';
import type { DataInfo } from '../model/project';
import { computeColumn, MAX_FORMULA } from './compute';
import { setVariableInfo, type MeasurementLevel, type ValueLabel } from './columns';
import { transformData } from './pipeline';

/** A column name as the formula language reads it (in backticks when it is not a plain name). */
export function formulaName(name: string): string {
  const plain = /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name);
  const reserved = ['and', 'or', 'not', 'NA'].includes(name);
  return plain && !reserved ? name : `\`${name}\``;
}

/** A number written short but exact enough (6 significant digits), as the formula and labels show it. */
export function cutText(x: number): string {
  return String(Number(x.toPrecision(6)));
}

/** The observed values (missing left out), sorted. */
function observed(values: ArrayLike<number>): number[] {
  return Array.from(values)
    .filter((v) => !Number.isNaN(v))
    .sort((a, b) => a - b);
}

/** k − 1 cut points dividing the observed range into k bins of equal width. */
export function equalWidthCuts(values: ArrayLike<number>, k: number): number[] {
  const x = observed(values);
  if (x.length < 2 || x[0] === x[x.length - 1]) throw new Error('The column has one value only.');
  const width = (x[x.length - 1] - x[0]) / k;
  return Array.from({ length: k - 1 }, (_, i) => Number((x[0] + (i + 1) * width).toPrecision(6)));
}

/**
 * Cut points at the quantiles i/k (R's type 7) for bins of (about) equal counts; ties can merge
 * bins, so there may be fewer.
 */
export function equalCountCuts(values: ArrayLike<number>, k: number): number[] {
  const x = observed(values);
  if (x.length < 2 || x[0] === x[x.length - 1]) throw new Error('The column has one value only.');
  const cuts = Array.from({ length: k - 1 }, (_, i) =>
    Number(quantileSorted(x, (i + 1) / k).toPrecision(6)),
  );
  // A cut at the minimum would leave the first bin empty.
  return [...new Set(cuts)].filter((c) => c > x[0]);
}

/** Cut points typed by the user ("10, 20, 30"): finite, distinct, put in order. */
export function parseCuts(text: string): number[] {
  const parts = text.split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) throw new Error('Enter at least one cut point.');
  if (parts.length > 50) throw new Error('At most 50 cut points.');
  const cuts = parts.map(Number);
  const bad = parts.find((_, i) => !Number.isFinite(cuts[i]));
  if (bad !== undefined) throw new Error(`“${bad}” is not a number.`);
  return [...new Set(cuts)].sort((a, b) => a - b);
}

/**
 * The formula of bins at these cut points: bin 1 below the first cut, bin i + 1 from cut i up to
 * (not including) the next; `1 + (x >= c1) + (x >= c2) + …` (missing stays missing).
 */
export function binFormula(column: string, cuts: number[]): string {
  const name = formulaName(column);
  const terms = cuts.map((c) => `(${name} >= ${cutText(c)})`);
  return ['1', ...terms].join(' + ');
}

/** The value labels of the bins: "< 10", "10 to < 20", "≥ 30". */
export function binLabels(cuts: number[]): ValueLabel[] {
  const t = cuts.map(cutText);
  if (!t.length) return [];
  const labels: ValueLabel[] = [{ value: 1, label: `< ${t[0]}` }];
  for (let i = 1; i < t.length; i++)
    labels.push({ value: i + 1, label: `${t[i - 1]} to < ${t[i]}` });
  labels.push({ value: t.length + 1, label: `≥ ${t[t.length - 1]}` });
  return labels;
}

/** One rule of a value recode: a value or a range (open ends ±Infinity) and the new value. */
export interface RecodeRule {
  from: { value: number } | { lo: number; hi: number };
  to: number;
  label?: string;
}

/** What values no rule covers become: kept as they are, missing, or a value. */
export type RecodeElse = 'copy' | 'missing' | { value: number };

const NUMBER = '-?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';

function bound(text: string, open: number): number {
  if (/^(lowest|lo)$/i.test(text)) return open === -Infinity ? open : NaN;
  if (/^(highest|hi)$/i.test(text)) return open === Infinity ? open : NaN;
  return Number(text);
}

/**
 * Recode rules typed one per line: `1 = 5`, `1, 2 = 1 low` (anything after the new value is its
 * label), `3 to 5 = 2`, `lowest to 2 = 1`, `6 to highest = 3`, and one `else = copy | missing |
 * a value`. Throws with a readable message.
 */
export function parseRecode(text: string): { rules: RecodeRule[]; otherwise: RecodeElse } {
  const rules: RecodeRule[] = [];
  let otherwise: RecodeElse = 'copy';
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length > 100) throw new Error('At most 100 rules.');
  const range = new RegExp(`^(${NUMBER}|lowest|lo)\\s+(?:to|thru)\\s+(${NUMBER}|highest|hi)$`, 'i');
  for (const line of lines) {
    const m = /^\s*(.+?)\s*=\s*(.+?)\s*$/.exec(line);
    if (!m) throw new Error(`“${line.trim()}”: write old = new, e.g. 1, 2 = 1.`);
    const [, left, right] = m;
    if (/^else$/i.test(left)) {
      if (/^copy$/i.test(right)) otherwise = 'copy';
      else if (/^(missing|NA)$/i.test(right)) otherwise = 'missing';
      else if (Number.isFinite(Number(right))) otherwise = { value: Number(right) };
      else throw new Error(`else = ${right}: write copy, missing or a number.`);
      continue;
    }
    const target = new RegExp(`^(${NUMBER})(?:\\s+(.+))?$`).exec(right);
    if (!target) throw new Error(`“${line.trim()}”: the new value must be a number.`);
    const to = Number(target[1]);
    const label = target[2]?.slice(0, 200);
    for (const part of left.split(',').map((p) => p.trim())) {
      const r = range.exec(part);
      if (r) {
        const lo = bound(r[1], -Infinity);
        const hi = bound(r[2], Infinity);
        if (Number.isNaN(lo) || Number.isNaN(hi) || lo > hi)
          throw new Error(`“${part}”: a range goes from a lower to a higher value.`);
        rules.push({ from: { lo, hi }, to, ...(label ? { label } : {}) });
      } else if (new RegExp(`^${NUMBER}$`).test(part)) {
        rules.push({ from: { value: Number(part) }, to, ...(label ? { label } : {}) });
      } else throw new Error(`“${part}”: write a value, values separated by commas, or a range.`);
    }
  }
  if (!rules.length) throw new Error('Enter at least one rule, e.g. 1, 2 = 1.');
  return { rules, otherwise };
}

/** The condition of a rule in the formula language. */
function ruleCondition(name: string, from: RecodeRule['from']): string {
  if ('value' in from) return `${name} == ${cutText(from.value)}`;
  const parts: string[] = [];
  if (from.lo !== -Infinity) parts.push(`${name} >= ${cutText(from.lo)}`);
  if (from.hi !== Infinity) parts.push(`${name} <= ${cutText(from.hi)}`);
  // lowest to highest: every observed value (missing for a missing one, so it stays missing)
  return parts.length ? parts.join(' & ') : `abs(${name}) >= 0`;
}

/**
 * The formula of a value recode: nested ifelse, the first matching rule deciding (as SPSS's
 * RECODE); missing values stay missing. Throws when it would be too long for one formula.
 */
export function recodeFormula(column: string, rules: RecodeRule[], otherwise: RecodeElse): string {
  const name = formulaName(column);
  let tail: string;
  if (otherwise === 'copy') tail = name;
  else if (otherwise === 'missing') tail = 'NA';
  else tail = cutText(otherwise.value);
  let formula = tail;
  for (const rule of [...rules].reverse())
    formula = `ifelse(${ruleCondition(name, rule.from)}, ${cutText(rule.to)}, ${formula})`;
  if (formula.length > MAX_FORMULA)
    throw new Error(
      `The recode is too long for one formula (${formula.length} of ${MAX_FORMULA} characters): use fewer rules or ranges.`,
    );
  return formula;
}

/** The value labels a recode's rules give (the first label of each new value). */
export function recodeLabels(rules: RecodeRule[]): ValueLabel[] {
  const out: ValueLabel[] = [];
  for (const r of rules)
    if (r.label && !out.some((l) => l.value === r.to)) out.push({ value: r.to, label: r.label });
  return out.sort((a, b) => a.value - b.value);
}

/**
 * Add the recoded column: computed from its formula over every case (the filter applies
 * afterwards), with its value labels and measurement level.
 */
export function addRecodedColumn(
  data: Dataset,
  info: DataInfo,
  spec: { name: string; expr: string; labels: ValueLabel[]; level: MeasurementLevel },
): { data: Dataset; info: DataInfo } {
  const r = transformData(data, info, (d, i) => computeColumn(d, i, spec.name, spec.expr));
  const labels = spec.labels.length ? spec.labels : null;
  return { data: r.data, info: setVariableInfo(r.info, spec.name, { level: spec.level, labels }) };
}
