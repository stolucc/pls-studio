// The validation evidence (public/validation.json), fetched once when first needed.

import { useEffect, useState } from 'react';
import { ESTIMATE_LEVELS, isEstimateComparison } from './types';
import type { Check, Comparison, Evidence, EvidenceLevel } from './types';

let cached: Promise<Evidence | null> | null = null;

/** The evidence, or null when this build has none (a missing file: the server may answer with its HTML page instead). */
export function loadEvidence(): Promise<Evidence | null> {
  cached ??= fetch(`${import.meta.env.BASE_URL}validation.json`)
    .then((r) =>
      r.ok && (r.headers?.get('content-type') ?? 'application/json').includes('json')
        ? (r.json() as Promise<Evidence>)
        : null,
    )
    .then((e) => (e && Array.isArray(e.checks) ? e : null))
    .catch(() => null);
  return cached;
}

/** For tests: fetch again. */
export function resetEvidence() {
  cached = null;
}

/** Whether the evidence is still loading, there, or not available in this build. */
export type EvidenceStatus =
  | { state: 'loading' }
  | { state: 'ready'; evidence: Evidence }
  | { state: 'missing' };

export function useEvidenceStatus(): EvidenceStatus {
  const [s, setS] = useState<EvidenceStatus>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    void loadEvidence().then((e) => {
      if (live) setS(e ? { state: 'ready', evidence: e } : { state: 'missing' });
    });
    return () => {
      live = false;
    };
  }, []);
  return s;
}

/** The evidence, or null while it loads or when this build has none. */
export function useEvidence(): Evidence | null {
  const s = useEvidenceStatus();
  return s.state === 'ready' ? s.evidence : null;
}

export const exampleEvidence = (e: Evidence | null, id: string): Check | undefined =>
  e?.checks.find((c) => c.subject === 'example' && c.id === id);

/** `short`: the badge (one word or two); `long`: the level's name; `hint`: what it means (tooltips, the Validation page). */
export const LEVEL_TEXT: Record<EvidenceLevel, { short: string; long: string; hint: string }> = {
  published: {
    short: 'Published',
    long: 'Reproduces published results',
    hint: 'The app’s numbers equal those printed by other people with other software: a book’s tables, Mplus output, a paper.',
  },
  native: {
    short: 'Native R',
    long: 'Matches the R package run natively',
    hint: 'The app’s numbers equal the same R package run in desktop R on the same data (a reference script, or values recorded from desktop R), or the package’s own documented output.',
  },
  'same-r': {
    short: 'Same R',
    long: 'Matches the package’s own function in the same R',
    hint: 'The app’s numbers equal the package’s function called directly (or a computation by hand) in the same R session that computed them: this checks the app’s request, options and reading of the result, not R or the package itself.',
  },
  recovery: {
    short: 'Simulated',
    long: 'Recovers known values in simulated data',
    hint: 'No reference package exists: simulated data with known true values, which the method recovers.',
  },
  runs: {
    short: 'Runs',
    long: 'Runs as documented',
    hint: 'The package’s documented example estimates without unexpected warnings; there are no independent numbers to compare it with.',
  },
};

/**
 * An example's comparisons against the sources of one kind of evidence (for "runs": those of the run itself, with
 * no source); for a method check, all of them.
 */
export function kindComparisons(c: Check, k: EvidenceLevel): Comparison[] {
  if (c.subject !== 'example') return c.comparisons;
  if (k === 'runs') return c.comparisons.filter((x) => !x.source);
  const labels = new Set(c.sources.filter((s) => s.level === k).map((s) => s.label));
  return c.comparisons.filter((x) => !!x.source && labels.has(x.source));
}

/**
 * The kinds of evidence a check has: for an example, those of the sources it was actually compared with
 * (published, native R; often both, which are different evidence, not one stronger than the other), or
 * "runs" when it was compared with none; for a method check, its own. Published and native evidence need a
 * comparison of an estimated quantity (types.ts isEstimateComparison): counts alone do not give it.
 */
export function evidenceKinds(c: Check): EvidenceLevel[] {
  if (c.subject !== 'example') return [c.level];
  const kinds = (['published', 'native', 'same-r', 'recovery'] as const).filter((k) => {
    const compared = kindComparisons(c, k);
    return ESTIMATE_LEVELS.includes(k) ? compared.some(isEstimateComparison) : compared.length > 0;
  });
  return kinds.length ? [...kinds] : ['runs'];
}

/** "12 numbers compared", for a badge's tooltip: the comparisons behind one kind of evidence. */
export function comparedText(c: Check, k: EvidenceLevel): string {
  const n = kindComparisons(c, k).length;
  return `${n} number${n === 1 ? '' : 's'} compared`;
}

/** The largest difference of a check's numeric comparisons. */
export function largestDifference(c: Check): number | null {
  const d = c.comparisons
    .filter((x) => typeof x.value === 'number' && typeof x.reference === 'number')
    .map((x) => Math.abs((x.value as number) - (x.reference as number)));
  return d.length ? Math.max(...d) : null;
}
