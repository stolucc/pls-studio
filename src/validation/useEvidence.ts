// The validation evidence (public/validation.json), fetched once when first needed.

import { useEffect, useState } from 'react';
import type { Check, Evidence, EvidenceLevel } from './types';

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
    hint: 'The app’s numbers equal the same R package run in desktop R on the same data (a reference script), or the package’s own documented output.',
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
 * The kinds of evidence a check has: for an example, those of the sources it was actually compared with
 * (published, native R; often both, which are different evidence, not one stronger than the other), or
 * "runs" when it was compared with none; for a method check, its own.
 */
export function evidenceKinds(c: Check): EvidenceLevel[] {
  if (c.subject !== 'example') return [c.level];
  const used = new Set(c.comparisons.map((x) => x.source).filter(Boolean));
  const kinds = (['published', 'native', 'recovery'] as const).filter((k) =>
    c.sources.some((s) => s.level === k && used.has(s.label)),
  );
  return kinds.length ? [...kinds] : ['runs'];
}

/** The largest difference of a check's numeric comparisons. */
export function largestDifference(c: Check): number | null {
  const d = c.comparisons
    .filter((x) => typeof x.value === 'number' && typeof x.reference === 'number')
    .map((x) => Math.abs((x.value as number) - (x.reference as number)));
  return d.length ? Math.max(...d) : null;
}
