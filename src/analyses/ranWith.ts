// The options a card's result was computed with: the result is shown with
// them (on the Analyses tab and in the report), even after the options change.

import { analysisType } from './registry';
import type { AnalysisCard } from './types';

/** The options of the card's last run, with its display-only options as they are now. */
export function ranWith(card: AnalysisCard): unknown {
  const t = analysisType(card.type);
  if (!t || !card.run) return card.options;
  try {
    const ran = t.parseOptions(JSON.parse(card.run.options));
    if (!ran) return card.options;
    // Display-only options follow the card as it is now.
    const now = card.options as Record<string, unknown>;
    return { ...ran, ...Object.fromEntries((t.display ?? []).map((k) => [k, now[k]])) };
  } catch {
    return card.options;
  }
}
