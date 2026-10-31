// Calculate and Bootstrap from the top bar act on what is in front of the
// person: on the Model tab, the model; on the Analyses tab, the selected card
// (an analysis card is run; a model-run card is opened on the Model tab and
// calculated again; with anything else selected, the model is calculated).

import { run } from '../runner';
import { useStore } from '../store';
import { analysisType } from './registry';
import { openRun } from './runs';
import { runCard, useAnalyses } from './store';
import type { Card } from './types';

export type CalculateTarget =
  | { kind: 'model' }
  | { kind: 'card'; id: string; title: string }
  | { kind: 'run'; id: string; title: string };

const titleOf = (c: Card & { kind: 'analysis' }) => c.title || (() => { const t = analysisType(c.type); return t ? t.cardTitle?.(c.options) ?? t.title : c.type; })();

/** What Calculate would act on now (the arguments let a component pass the values it subscribes to). */
export function calculateTarget(workspace = useStore.getState().workspace, cards = useAnalyses.getState().cards, selected = useAnalyses.getState().selected): CalculateTarget {
  if (workspace !== 'analyses') return { kind: 'model' };
  const card = cards.find((c) => c.id === selected);
  if (!card || card.kind !== 'analysis') return { kind: 'model' };
  const t = analysisType(card.type);
  if (!t) return { kind: 'model' };
  if (t.id === 'run') return { kind: 'run', id: card.id, title: titleOf(card) };
  if (t.frozen) return { kind: 'model' };
  return { kind: 'card', id: card.id, title: titleOf(card) };
}

/** Calculate (or bootstrap) what is in front of the person. */
export async function calculateHere(kind: 'estimate' | 'boot'): Promise<void> {
  const target = calculateTarget();
  if (target.kind === 'card') { await runCard(target.id); return; }
  if (target.kind === 'run') {
    // Opening puts the version on the Model tab (or says it is there already); nothing runs if that is refused.
    if (!(await openRun(target.id))) return;
  }
  run(kind);
}
