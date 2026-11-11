// How a held or labelled parameter is typed in the canvas dialogs: empty (free), a number (held at
// that value, lavaan 1*x, Mplus x@1), a name (a label, lavaan a*x, Mplus x (a)) or, with groups, one
// entry per group separated by commas (lavaan c(1, NA, a)): a number, NA (free in that group) or a label.

import type { GroupValue } from '../engine/types';

export type HeldValue = { fixed: number } | { label: string } | { byGroup: GroupValue[] } | null;

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const LABEL = /^[A-Za-z][A-Za-z0-9_.]{0,30}$/;

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
      if (v === undefined) return { error: `“${p.trim()}” is not a number, NA or a label.` };
      if (typeof v === 'string' && opts.reserved?.has(v))
        return { error: `“${v}” is a variable or construct name; a label must differ.` };
      out.push(v);
    }
    return { byGroup: out };
  }
  const v = entry(t);
  if (v === undefined)
    return {
      error:
        'Type a number (held at it), a label (equal labels are equal), or leave it empty (estimated freely).',
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
