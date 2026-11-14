// Loading triage for reflective (Mode A) indicators, after Hair, Hult, Ringle & Sarstedt
// (2017, 2021), PLS-SEM primer, the indicator-reliability flowchart:
// - loading below 0.40: a candidate for deletion;
// - 0.40 to below 0.70: delete only if removing the indicator raises the construct's AVE to
//   0.50 or more, or its composite reliability (ρC) to 0.70 or more, and content validity
//   does not suffer; otherwise keep it;
// - 0.70 or more: keep.
// The effect of a removal is found by re-estimating the model without the indicator
// (measurement/reestimate.ts). Nothing is ever deleted without the author's confirmation.

import type { PlsResult } from '../engine/types';
import type { ModelState } from '../model/project';
import type { QualitySnapshot } from './state';

/** Below this, a candidate for deletion (Hair et al. 2017, 2021). */
export const LOADING_DELETE = 0.4;
/** At or above this, keep (Hair et al. 2017, 2021). */
export const LOADING_KEEP = 0.7;
/** Convergent validity: AVE of at least 0.50 (Fornell & Larcker 1981; Hair et al. 2021). */
export const AVE_MIN = 0.5;
/** Composite reliability ρC of at least 0.70 (Hair et al. 2021). */
export const RHOC_MIN = 0.7;

export type LoadingBand = 'delete' | 'consider' | 'keep';

/** The band of a loading: below 0.40, 0.40 to below 0.70, or 0.70 and above. */
export function loadingBand(loading: number): LoadingBand {
  if (loading < LOADING_DELETE) return 'delete';
  if (loading < LOADING_KEEP) return 'consider';
  return 'keep';
}

/**
 * - `supported`: removal lifts AVE to 0.50 or ρC to 0.70 (from below), and leaves the other
 *   criterion no worse off with respect to its threshold;
 * - `notNeeded`: the construct already meets both thresholds, so the indicator stays;
 * - `notSupported`: removal does not lift either criterion above its threshold.
 */
export type RemovalOutcome = 'supported' | 'notNeeded' | 'notSupported';

export interface RemovalDecision {
  outcome: RemovalOutcome;
  /** One plain sentence saying why. */
  why: string;
}

const f2 = (x: number) => x.toFixed(2);

/** What re-estimating without an indicator says about removing it (for 0.40–0.70 loadings). */
export function removalDecision(before: QualitySnapshot, after: QualitySnapshot): RemovalDecision {
  const aveMet = before.ave >= AVE_MIN;
  const rhoMet = before.rhoC >= RHOC_MIN;
  if (aveMet && rhoMet)
    return {
      outcome: 'notNeeded',
      why: `Keep: the construct already meets AVE ≥ ${f2(AVE_MIN)} and ρC ≥ ${f2(RHOC_MIN)}.`,
    };
  const aveLifted = !aveMet && after.ave >= AVE_MIN;
  const rhoLifted = !rhoMet && after.rhoC >= RHOC_MIN;
  // A removal must not push the other criterion below a threshold it met before.
  const aveBroken = aveMet && after.ave < AVE_MIN;
  const rhoBroken = rhoMet && after.rhoC < RHOC_MIN;
  if ((aveLifted || rhoLifted) && !aveBroken && !rhoBroken) {
    const parts: string[] = [];
    if (aveLifted) parts.push(`AVE from ${f2(before.ave)} to ${f2(after.ave)}`);
    if (rhoLifted) parts.push(`ρC from ${f2(before.rhoC)} to ${f2(after.rhoC)}`);
    return {
      outcome: 'supported',
      why: `Removal raises ${parts.join(' and ')}, above the threshold. Delete only if content validity holds.`,
    };
  }
  return {
    outcome: 'notSupported',
    why: 'Keep: removal does not lift AVE to 0.50 or ρC to 0.70.',
  };
}

/** One reflective indicator in the triage. */
export interface TriageItem {
  constructId: string;
  construct: string;
  indicator: string;
  loading: number;
  band: LoadingBand;
  /** Indicators of its construct (removal must leave at least two). */
  blockSize: number;
  /** A common factor (ρA applies), not a composite. */
  factor: boolean;
  /** The construct as estimated now. */
  before: QualitySnapshot;
}

/**
 * The reflective (Mode A) indicators of first-order constructs with two or more indicators,
 * with their loadings from the results, in the model's order.
 */
export function triageItems(model: ModelState, pls: PlsResult): TriageItem[] {
  const out: TriageItem[] = [];
  for (const k of model.constructs) {
    if (k.mode !== 'A' || k.components?.length || k.indicators.length < 2) continue;
    const j = pls.constructs.indexOf(k.name);
    if (j < 0) continue;
    const q = pls.quality[j];
    const before = { ave: q.ave, rhoA: q.rhoA, rhoC: q.rhoC };
    for (const name of k.indicators) {
      const at = pls.indicators.findIndex((x) => x.name === name && x.construct === j);
      if (at < 0) continue;
      const loading = pls.loadings[at];
      if (!Number.isFinite(loading)) continue;
      out.push({
        constructId: k.id,
        construct: k.name,
        indicator: name,
        loading,
        band: loadingBand(loading),
        blockSize: k.indicators.length,
        factor: k.type === 'factor',
        before,
      });
    }
  }
  return out;
}

/** Whether removing the indicator leaves its construct with two or more indicators. */
export function canRemove(item: Pick<TriageItem, 'blockSize'>): boolean {
  return item.blockSize >= 3;
}

/** The items whose removal the triage re-estimates: loadings below 0.70 that can be removed. */
export function reestimationCandidates(items: TriageItem[]): TriageItem[] {
  return items.filter((x) => x.band !== 'keep' && canRemove(x));
}

/** The model without one indicator of one construct, and the settings that named it. */
export function withoutIndicator(
  model: ModelState,
  constructId: string,
  indicator: string,
): ModelState {
  return {
    ...model,
    constructs: model.constructs.map((c) => {
      if (c.id !== constructId) return c;
      const next = { ...c, indicators: c.indicators.filter((i) => i !== indicator) };
      if (next.dominant === indicator) delete next.dominant;
      next.predefinedWeights = without(c.predefinedWeights, indicator);
      next.fixedLoadings = without(c.fixedLoadings, indicator);
      next.loadingLabels = without(c.loadingLabels, indicator);
      next.reliabilities = without(c.reliabilities, indicator);
      for (const key of [
        'predefinedWeights',
        'fixedLoadings',
        'loadingLabels',
        'reliabilities',
      ] as const)
        if (next[key] === undefined) delete next[key];
      return next;
    }),
  };
}

function without<T>(record: Record<string, T> | undefined, key: string) {
  if (!record) return undefined;
  const { [key]: _drop, ...rest } = record;
  return Object.keys(rest).length ? rest : undefined;
}

/** The reason recorded in the deleted-items log, from the rule that applied. */
export function deletionReason(item: TriageItem, after?: QualitySnapshot | null): string {
  const l = item.loading.toFixed(2);
  if (item.band === 'delete') return `Loading ${l}, below 0.40 (Hair et al. 2017, 2021).`;
  if (item.band === 'consider' && after) {
    const d = removalDecision(item.before, after);
    if (d.outcome === 'supported') {
      return `Loading ${l}, between 0.40 and 0.70; removal raised AVE to ${f2(after.ave)} and ρC to ${f2(after.rhoC)} (Hair et al. 2017, 2021).`;
    }
  }
  return `Loading ${l}; deleted by the author.`;
}
