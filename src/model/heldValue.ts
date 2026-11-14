// How a held or labelled parameter is typed in the canvas dialogs: empty (free), a number (held at
// that value, lavaan 1*x, Mplus x@1), a name (a label, lavaan a*x, Mplus x (a)) or, with groups, one
// entry per group separated by commas (lavaan c(1, NA, a)): a number, NA (free in that group) or a label.

import type { Dataset, GroupValue } from '../engine/types';
import { NAME_RE } from './expr';
import type { ModelState } from './project';

export type HeldValue = { fixed: number } | { label: string } | { byGroup: GroupValue[] } | null;

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
// (the label rule of the R bridge, ps_label: a letter, then letters, digits or _; no dots)
const LABEL = NAME_RE;
const LABEL_RULE =
  'a label starts with a letter and has letters, digits and _ only (at most 31 characters)';

function entry(raw: string): GroupValue | undefined {
  const v = raw.trim();
  if (v === 'NA' || v === '*') return null;
  if (NUMBER.test(v)) return Number(v);
  if (LABEL.test(v)) return v;
  return undefined;
}

/** The value typed in the dialog, or an error message. `reserved`: names a label may not take (variables, constructs). */
export function parseHeldValue(
  text: string,
  opts: { groups: boolean; reserved?: Set<string> },
): HeldValue | { error: string } {
  const t = text.trim();
  if (!t) return null;
  const parts = t.replace(/^c\((.*)\)$/, '$1').split(',');
  if (parts.length > 1) {
    if (!opts.groups)
      return { error: 'One value per group needs groups (Groups in the Model inspector).' };
    const out: GroupValue[] = [];
    for (const p of parts) {
      const v = entry(p);
      if (v === undefined)
        return { error: `“${p.trim()}” is not a number, NA or a label (${LABEL_RULE}).` };
      if (typeof v === 'string' && opts.reserved?.has(v))
        return { error: `“${v}” is a variable or construct name; a label must differ.` };
      out.push(v);
    }
    return { byGroup: out };
  }
  const v = entry(t);
  if (v === undefined)
    return {
      error: `Type a number (held at it), a label (equal labels are equal; ${LABEL_RULE}), or leave it empty (estimated freely).`,
    };
  if (v === null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || Math.abs(v) > 1e6) return { error: 'The value is out of range.' };
    return { fixed: v };
  }
  if (opts.reserved?.has(v))
    return { error: `“${v}” is a variable or construct name; a label must differ.` };
  return { label: v };
}

/** The dialog's text for a parameter's current state (the inverse of parseHeldValue). */
export function heldText(
  p: { fixed?: number; label?: string; byGroup?: GroupValue[] } | undefined,
): string {
  if (!p) return '';
  if (p.byGroup?.length) return p.byGroup.map((v) => (v === null ? 'NA' : String(v))).join(', ');
  if (p.fixed !== undefined) return String(p.fixed);
  return p.label ?? '';
}

/** The grouping column's codes in the order they first appear in the rows (lavaan's group order); null without it. */
function appearanceCodes(data: Dataset, column: string): number[] | null {
  const col = data.cols[data.names.indexOf(column)];
  if (!col) return null;
  return [...new Set(Array.from(col).filter(Number.isFinite))];
}

/**
 * The groups in the order the values per group go to them: a stacked dataset's groups as given; otherwise the
 * grouping column's codes in ascending order (R/lavaan.R lavaan_order; never the order the rows happen to be in),
 * or, for values still in lavaan's order (`appearance`: ModelState.groupValueOrder), the order the groups first
 * appear in the data. Shown as their categories for a text column.
 */
export function groupOrder(
  data: Dataset | null | undefined,
  column: string,
  appearance = false,
): string[] {
  if (!data) return [];
  if (data.moments?.groups?.length) return data.moments.groups.map((g) => g.label);
  const seen = appearanceCodes(data, column);
  if (!seen) return [];
  const codes = appearance ? seen : [...seen].sort((a, b) => a - b);
  const categories = data.categories?.[column];
  return codes.map((c) => categories?.[c - 1] ?? String(c));
}

/** Whether a model has values per group (or a marker intercept per group). */
export function hasGroupValues(m: ModelState): boolean {
  return (
    (m.parameters ?? []).some((t) => t.byGroup?.length) ||
    (m.correlations ?? []).some((k) => k.byGroup?.length) ||
    (m.means ?? []).some((t) => t.byGroup?.length || Array.isArray(t.bias))
  );
}

/**
 * Values per group given in lavaan's order (groupValueOrder 'appearance': lavaan syntax, projects before format 3)
 * put in the order of the group codes, with the data they refer to; the marker is then dropped. A stacked dataset's
 * groups have one order (as given): only the marker goes. Without the data or the grouping column (not known yet)
 * the model stays as it is: the marker keeps the values' meaning (R reads them in lavaan's order).
 */
export function codeOrderValues(m: ModelState, data: Dataset | null | undefined): ModelState {
  if (m.groupValueOrder !== 'appearance' || !m.multigroup || !data) return m;
  const { groupValueOrder: _marker, ...rest } = m;
  if (data.moments?.groups?.length) return rest;
  const seen = appearanceCodes(data, m.multigroup.column);
  if (!seen) return m;
  const sorted = [...seen].sort((a, b) => a - b);
  // (value k of a code-ordered list is the one lavaan's order has at the position of the k-th smallest code)
  const at = sorted.map((c) => seen.indexOf(c));
  const reorder = <T>(v: T[]): T[] => (v.length === at.length ? at.map((i) => v[i]) : v);
  return {
    ...rest,
    ...(m.parameters
      ? {
          parameters: m.parameters.map((t) =>
            t.byGroup?.length ? { ...t, byGroup: reorder(t.byGroup) } : t,
          ),
        }
      : {}),
    ...(m.correlations
      ? {
          correlations: m.correlations.map((k) =>
            k.byGroup?.length ? { ...k, byGroup: reorder(k.byGroup) } : k,
          ),
        }
      : {}),
    ...(m.means
      ? {
          means: m.means.map((t) => ({
            ...t,
            ...(t.byGroup?.length ? { byGroup: reorder(t.byGroup) } : {}),
            ...(Array.isArray(t.bias) ? { bias: reorder(t.bias) } : {}),
          })),
        }
      : {}),
  };
}
