// The reverse-coding dialog: the Data tab's "Reverse-code…" button and the negative-loading note
// in the results both open it. The user confirms the answer scale (prefilled from the observed
// range, or from the scale the items were reversed on); the items are then reverse-coded on the
// base dataset (data/recode.ts reverseCode through data/pipeline.ts transformData).

import { observedRange, reverseCode } from '../data/recode';
import { transformData } from '../data/pipeline';
import { useStore } from '../store';
import { textDialog } from './Overlays';

/** The two numbers of an answer scale typed as "lowest, highest", or null. */
export function parseScale(text: string): [number, number] | null {
  const m = text
    .split(/[\s,;–-]+/)
    .filter(Boolean)
    .map(Number);
  if (m.length !== 2 || !m.every(Number.isFinite) || m[0] >= m[1]) return null;
  return [m[0], m[1]];
}

/**
 * Ask for the answer scale and reverse-code the items (or undo it, when every item is already
 * reversed). `afterward` is added to the success message (e.g. that the model needs estimating
 * again). Resolves the names whose coding changed; an empty list when cancelled or refused.
 */
export async function reverseCodeItems(names: string[], afterward = ''): Promise<string[]> {
  const { data, dataInfo: info } = useStore.getState();
  if (!data || !info || !names.length) return [];
  const reversed = new Map((info.reversed ?? []).map((r) => [r.name, r]));
  const done = names.filter((n) => reversed.has(n));
  const scales = new Set(done.map((n) => `${reversed.get(n)!.min},${reversed.get(n)!.max}`));
  const known =
    done.length === names.length && scales.size === 1 ? reversed.get(done[0]) : undefined;
  const range = known ? [known.min, known.max] : observedRange(data, names);
  // Every chosen item already reversed: the dialog offers to undo it.
  const undo = done.length === names.length;
  const what = names.length === 1 ? names[0] : `${names.length} items`;
  const itemList = names.length > 1 ? ` Items: ${names.join(', ')}.` : '';
  const text = await textDialog({
    title: undo ? `Undo the reverse-coding of ${what}?` : `Reverse-code ${what}?`,
    body:
      'Each value x becomes lowest + highest − x on the answer scale (on 1–5: 1 ↔ 5, 2 ↔ 4), for negatively worded items. ' +
      `Doing it again on the same scale undoes it.${itemList}`,
    confirmLabel: undo ? 'Undo' : 'Reverse-code',
    text: {
      label: 'Answer scale: lowest, highest',
      initial: range ? `${range[0]}, ${range[1]}` : '1, 5',
      check: (t) =>
        parseScale(t) ? null : 'Enter the lowest and highest value of the scale, e.g. 1, 5.',
    },
  });
  if (text === null) return [];
  const [min, max] = parseScale(text)!;
  const store = useStore.getState();
  try {
    // (on the base dataset: the cases the filter leaves out are reverse-coded too)
    let undone: string[] = [];
    const r = transformData(data, info, (d, i) => {
      const rc = reverseCode(d, i, names, min, max);
      undone = rc.undone;
      return rc;
    });
    store.setData(r.data, r.info);
    const changed = names.filter((n) => !undone.includes(n));
    const message = [
      changed.length ? `Reverse-coded ${changed.join(', ')} (${min}–${max}).` : '',
      undone.length ? `Back to the original coding: ${undone.join(', ')}.` : '',
      afterward,
    ]
      .filter(Boolean)
      .join(' ');
    store.toast('success', message);
    return names;
  } catch (e) {
    store.toast('error', (e as Error).message);
    return [];
  }
}
