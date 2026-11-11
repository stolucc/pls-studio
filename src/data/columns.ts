// Per-column information beyond the values, as SPSS's Variable View: the
// measurement level (nominal, ordinal, scale) and value labels (number →
// label) of numeric columns. Text columns carry their categories in the
// dataset itself (Dataset.categories); they can have a level, not labels.

import type { Dataset } from '../engine/types';
import type { DataInfo } from '../model/project';
import { isObj } from '../parse';

export type MeasurementLevel = 'nominal' | 'ordinal' | 'scale';
export const MEASUREMENT_LEVELS: readonly MeasurementLevel[] = ['nominal', 'ordinal', 'scale'];

export interface ValueLabel {
  value: number;
  label: string;
}

/** A column's measurement level and value labels (DataInfo.variables). */
export interface VariableInfo {
  name: string;
  level?: MeasurementLevel;
  labels?: ValueLabel[];
}

export const MAX_LABELS = 500;
export const MAX_LABEL = 200;

/** The stored information of a column, if any. */
export function variableInfo(info: DataInfo | null | undefined, name: string) {
  return info?.variables?.find((v) => v.name === name);
}

/** A column's value labels (empty for none). */
export function valueLabels(info: DataInfo | null | undefined, name: string): ValueLabel[] {
  return variableInfo(info, name)?.labels ?? [];
}

/** The label of a value of a column, or null when it has none. */
export function labelOf(info: DataInfo | null | undefined, name: string, value: number) {
  return valueLabels(info, name).find((l) => l.value === value)?.label ?? null;
}

/**
 * The level a column's values suggest: text and two-valued columns nominal, whole numbers with
 * at most 10 distinct values ordinal (Likert-type items), anything else scale.
 */
export function suggestedLevel(data: Dataset, name: string): MeasurementLevel {
  if (data.categories?.[name]) return 'nominal';
  const col = data.cols[data.names.indexOf(name)];
  if (!col) return 'scale';
  const distinct = new Set<number>();
  for (const v of col) {
    if (Number.isNaN(v)) continue;
    if (!Number.isInteger(v)) return 'scale';
    distinct.add(v);
    if (distinct.size > 10) return 'scale';
  }
  if (distinct.size <= 2) return 'nominal';
  return 'ordinal';
}

/** A column's level: the one set (in the Data tab or the imported file), else the suggested one. */
export function levelOf(data: Dataset, info: DataInfo | null | undefined, name: string) {
  return variableInfo(info, name)?.level ?? suggestedLevel(data, name);
}

/** The info with a column's level or labels changed (undefined removes it). */
export function setVariableInfo(
  info: DataInfo,
  name: string,
  patch: { level?: MeasurementLevel | null; labels?: ValueLabel[] | null },
): DataInfo {
  const old = variableInfo(info, name) ?? { name };
  const next: VariableInfo = { name };
  const level = patch.level === undefined ? old.level : patch.level;
  const labels = patch.labels === undefined ? old.labels : patch.labels;
  if (level) next.level = level;
  if (labels?.length) next.labels = [...labels].sort((a, b) => a.value - b.value);
  const others = (info.variables ?? []).filter((v) => v.name !== name);
  const variables = next.level || next.labels ? [...others, next] : others;
  const { variables: _v, ...rest } = info;
  return variables.length ? { ...rest, variables } : rest;
}

/** The info without columns that are gone (after a column was removed). */
export function pruneVariables(info: DataInfo, names: string[]): DataInfo {
  if (!info.variables) return info;
  const variables = info.variables.filter((v) => names.includes(v.name));
  const { variables: _v, ...rest } = info;
  return variables.length ? { ...rest, variables } : rest;
}

/** Value labels as text, one per line: "1 = Strongly disagree". */
export function labelsToText(labels: ValueLabel[]): string {
  return labels.map((l) => `${l.value} = ${l.label}`).join('\n');
}

/** Parse value labels typed one per line ("1 = Low" or "1: Low"); throws with a readable message. */
export function parseLabelsText(text: string): ValueLabel[] {
  const out: ValueLabel[] = [];
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length > MAX_LABELS) throw new Error(`At most ${MAX_LABELS} value labels.`);
  for (const line of lines) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[=:]\s*(.+?)\s*$/.exec(line);
    if (!m) throw new Error(`“${line.trim()}”: write a value, = and its label, e.g. 1 = Low.`);
    const value = Number(m[1]);
    if (out.some((l) => l.value === value)) throw new Error(`${value} has two labels.`);
    if (m[2].length > MAX_LABEL)
      throw new Error(`The label of ${value} is too long (at most ${MAX_LABEL} characters).`);
    out.push({ value, label: m[2] });
  }
  return out.sort((a, b) => a.value - b.value);
}

/** Value labels from untrusted input: finite distinct values, plain-text labels. */
function parseLabels(raw: unknown): ValueLabel[] {
  if (!Array.isArray(raw)) return [];
  const out: ValueLabel[] = [];
  for (const l of raw.slice(0, MAX_LABELS)) {
    if (!isObj(l) || typeof l.value !== 'number' || !Number.isFinite(l.value)) continue;
    if (typeof l.label !== 'string' || out.some((x) => x.value === l.value)) continue;
    const label = l.label.slice(0, MAX_LABEL).trim();
    if (label) out.push({ value: l.value, label });
  }
  return out.sort((a, b) => a.value - b.value);
}

/**
 * Column information from a project file (or a data file read by R): columns that exist, once
 * each; a known level; labels only for numeric (not text) columns.
 */
export function parseVariables(raw: unknown, data: Dataset): VariableInfo[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: VariableInfo[] = [];
  // (a bounded number of entries: one per column, with room for junk that is skipped)
  for (const v of raw.slice(0, 2 * data.names.length + 10)) {
    if (!isObj(v) || typeof v.name !== 'string' || !data.names.includes(v.name)) continue;
    if (out.some((x) => x.name === v.name)) continue;
    const item: VariableInfo = { name: v.name };
    if (MEASUREMENT_LEVELS.includes(v.level as MeasurementLevel))
      item.level = v.level as MeasurementLevel;
    const labels = data.categories?.[v.name] ? [] : parseLabels(v.labels);
    if (labels.length) item.labels = labels;
    if (item.level || item.labels) out.push(item);
  }
  return out.length ? out : undefined;
}

/**
 * The dataset with the given numeric columns that have value labels turned into categories
 * (codes 1..k in the order of the values, each named by its label, or by the value when it has
 * none), so that analyses showing categories (contingency tables, group names) show the labels.
 * Other columns are unchanged.
 */
export function withLabelledCategories(
  data: Dataset,
  info: DataInfo | null | undefined,
  names: string[],
): Dataset {
  let out = data;
  for (const name of new Set(names.filter(Boolean))) {
    const labels = valueLabels(info, name);
    const j = data.names.indexOf(name);
    if (!labels.length || j < 0 || data.categories?.[name]) continue;
    const values = [...new Set(Array.from(data.cols[j]).filter((v) => !Number.isNaN(v)))].sort(
      (a, b) => a - b,
    );
    const code = new Map(values.map((v, k) => [v, k + 1]));
    const names = values.map((v) => labels.find((l) => l.value === v)?.label ?? String(v));
    const cols = [...out.cols];
    cols[j] = data.cols[j].map((v) => (Number.isNaN(v) ? NaN : code.get(v)!));
    out = { ...out, cols, categories: { ...(out.categories ?? {}), [name]: names } };
  }
  return out;
}
