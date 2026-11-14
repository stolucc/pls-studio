// What the measurement-quality helpers add to the methods text and the reviewer checklist:
// the deleted-items log ("Items deleted: …") and the HTMT threshold of pairs the author marked
// as conceptually similar.

import type { PlsResult } from '../engine/types';
import type { ModelState } from '../model/project';
import { htmtThreshold } from './htmt';
import { isSimilarPair, type DeletedItem } from './state';

const f2 = (x: number) => x.toFixed(2);

/** "comp_2 (COMP; loading 0.58; AVE 0.45 → 0.53, ρC 0.68 → 0.72)". */
export function deletedItemText(d: DeletedItem): string {
  const parts = [d.construct, `loading ${f2(d.loading)}`];
  if (d.after) {
    parts.push(
      `AVE ${f2(d.before.ave)} → ${f2(d.after.ave)}, ρC ${f2(d.before.rhoC)} → ${f2(d.after.rhoC)}`,
    );
  }
  return `${d.indicator} (${parts.join('; ')})`;
}

/** "Items deleted: a (…), b (…)." or null when none was deleted. */
export function itemsDeletedLine(model: ModelState): string | null {
  const items = model.measurement?.deletedItems ?? [];
  if (!items.length) return null;
  return `Items deleted: ${items.map(deletedItemText).join('; ')}.`;
}

/**
 * The methods-text sentences on deleted items, or null when none was deleted. `cite` writes a
 * citation marker of the methods draft (reporting/methods.ts).
 */
export function deletedItemsMethods(
  model: ModelState,
  cite: (...keys: string[]) => string,
): string | null {
  const line = itemsDeletedLine(model);
  if (!line) return null;
  return (
    'Indicators with loadings below 0.40 were candidates for deletion; indicators loading between 0.40 and 0.70 ' +
    'were deleted only where their removal raised the AVE or the composite reliability above its threshold, ' +
    `and content validity was not harmed ${cite('hair2017', 'hair2021')}. ${line}`
  );
}

/** A reviewer-checklist item for the deleted items (same shape as reporting/checklist.ts's). */
export interface DeletedItemsCheck {
  id: 'deleteditems';
  section: 'Measurement model';
  label: string;
  status: 'author';
  evidence: string;
  sources: string[];
  link: { kind: 'tab'; label: string };
}

/**
 * The checklist item: which items were deleted and why, for the author to report and justify
 * (content validity is the author's argument). Null when none was deleted.
 */
export function deletedItemsCheck(model: ModelState): DeletedItemsCheck | null {
  const items = model.measurement?.deletedItems ?? [];
  const line = itemsDeletedLine(model);
  if (!line) return null;
  const notes = items.filter((d) => d.note).map((d) => `${d.indicator}: ${d.note}`);
  const noteText = notes.length ? ` Notes: ${notes.join('; ')}.` : '';
  return {
    id: 'deleteditems',
    section: 'Measurement model',
    label: 'Deleted indicators reported with their reasons and content validity',
    status: 'author',
    evidence: `${line}${noteText} Report each with its reason, and argue that content validity holds.`,
    sources: ['hair2017', 'hair2021'],
    link: { kind: 'tab', label: 'Loadings & weights' },
  };
}

/**
 * The HTMT threshold of a pair of the results (by index): 0.90 when the author marked the two
 * constructs as conceptually similar, 0.85 otherwise (Henseler et al. 2015).
 */
export function htmtCutOf(model: ModelState, pls: PlsResult): (i: number, j: number) => number {
  const idOf = new Map(model.constructs.map((k) => [k.name, k.id]));
  return (i, j) => {
    const a = idOf.get(pls.constructs[i]);
    const b = idOf.get(pls.constructs[j]);
    const similar = !!a && !!b && isSimilarPair(model.measurement, a, b);
    return htmtThreshold(similar);
  };
}
