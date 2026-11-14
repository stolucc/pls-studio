// Reverse-coding the chosen items, from the model editor's variable list, the Data tab or the
// negative-loading note in the results: one confirm dialog that asks for the answer scale (the observed range by default), then
// data/recode.ts's reverseCode over every case.

import { transformData } from '../data/pipeline';
import { observedRange, reverseCode } from '../data/recode';
import { useStore } from '../store';
import { textDialog } from './Overlays';

/** "1, 5" or "1-5" or "1 5" as the lowest and highest value of a scale, or null. */
export function parseScale(text: string): [number, number] | null {
  const parts = text
    .split(/[\s,;–-]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length !== 2) return null;
  if (!parts.every(Number.isFinite)) return null;
  if (parts[0] >= parts[1]) return null;
  return [parts[0], parts[1]];
}

/** Numeric columns of the dataset, which are the ones that can be reverse-coded. */
export function reversibleColumns(): string[] {
  const data = useStore.getState().data;
  if (!data || data.cols.length === 0) return [];
  return data.names.filter((n) => !data.categories?.[n]);
}

/**
 * Reverse-code `names` on a scale the user confirms (it defaults to the observed range, or to
 * the scale they are reversed on already). When every item is reversed already, the dialog
 * offers to undo it. `afterward` is added to the success message (e.g. that the model needs
 * estimating again). Resolves true when the data changed.
 */
export async function reverseCodeColumns(names: string[], afterward = ''): Promise<boolean> {
  const { data, dataInfo: info } = useStore.getState();
  if (!data || !info || names.length === 0) return false;
  const reversed = new Map((info.reversed ?? []).map((r) => [r.name, r]));
  const done = names.filter((n) => reversed.has(n));
  // Every chosen item already reversed: the dialog offers to undo it, on its scale when they share one.
  const undo = done.length === names.length;
  const scales = new Set(done.map((n) => `${reversed.get(n)!.min},${reversed.get(n)!.max}`));
  const known = undo && scales.size === 1 ? reversed.get(done[0]) : undefined;
  const range = known ? [known.min, known.max] : observedRange(data, names);
  const what = names.length === 1 ? names[0] : `${names.length} items`;
  const itemList = names.length > 1 ? ` Items: ${names.join(', ')}.` : '';
  const text = await textDialog({
    title: undo ? `Undo the reverse-coding of ${what}?` : `Reverse-code ${what}?`,
    body:
      'Each value x becomes lowest + highest − x on the answer scale (on 1–5: 1 ↔ 5, 2 ↔ 4), ' +
      `for negatively worded items. Doing it again on the same scale undoes it.${itemList}`,
    confirmLabel: undo ? 'Undo' : 'Reverse-code',
    text: {
      label: 'Answer scale: lowest, highest',
      initial: range ? `${range[0]}, ${range[1]}` : '1, 5',
      check: (t) =>
        parseScale(t) ? null : 'Enter the lowest and highest value of the scale, e.g. 1, 5.',
    },
  });
  if (text === null) return false;
  const [min, max] = parseScale(text)!;
  const store = useStore.getState();
  if (!store.data || !store.dataInfo) return false;
  try {
    // (on the base dataset: the cases the filter leaves out are reverse-coded too)
    let undone: string[] = [];
    const r = transformData(store.data, store.dataInfo, (d, i) => {
      const rc = reverseCode(d, i, names, min, max);
      undone = rc.undone;
      return rc;
    });
    store.setData(r.data, r.info);
    const changed = names.filter((n) => !undone.includes(n));
    const parts: string[] = [];
    if (changed.length) parts.push(`Reverse-coded ${changed.join(', ')} (${min}–${max}).`);
    if (undone.length) parts.push(`Back to the original coding: ${undone.join(', ')}.`);
    if (afterward) parts.push(afterward);
    store.toast('success', parts.join(' '));
    return true;
  } catch (e) {
    store.toast('error', (e as Error).message);
    return false;
  }
}
