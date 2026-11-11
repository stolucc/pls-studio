// For tests only: the validation evidence of the examples (src/validation/types.ts). A test names the example it
// checks and the source it compares with; every toBeCloseTo that follows is recorded under them
// (setup.ts), with the label given to expect, so the assertions themselves stay as they are.
//
//   example(ex.id, { title: ex.title, method: 'CB-SEM', packages: ['lavaan'], definition: ex });
//   against({ label: 'Mplus User’s Guide, example 5.25 (output)', level: 'published' });
//   expect(r.fit.chisq, 'χ²').toBeCloseTo(51.353, 3);          // recorded
//   same('df', r.fit.df, 46);                                    // an exact comparison, recorded
//
// With PS_VALIDATION_DIR set (npm run validate:evidence) each test file's checks are written when it ends;
// scripts/validation/evidence.mjs merges them.

import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { cardsOfCheck } from './cards';
import { checks, current, fileName, runtime } from './collector';
import { FEATURES } from './features';
import type { Check, EvidenceLevel, EvidenceSource } from './types';

/**
 * Fields of an example that describe it or the test suite's allowances, not what is estimated: left out of its
 * definition hash, so that rewording what an example shows (or why a message is expected) leaves its evidence current.
 */
export const UNHASHED_FIELDS = ['shows', 'expectedMessages'] as const;

/** A stable hash of an example's definition (key order normalised; UNHASHED_FIELDS of the top level left out). */
export function definitionHash(def: unknown): string {
  if (def && typeof def === 'object' && !Array.isArray(def)) {
    const rest = { ...(def as Record<string, unknown>) };
    for (const k of UNHASHED_FIELDS) delete rest[k];
    def = rest;
  }
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as object)
              .sort()
              .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(norm(def) ?? null))
    .digest('hex')
    .slice(0, 16);
}

/** The cards an example opens (its panels) and the manifest entries that name it. */
function exampleCards(id: string, def: unknown): string[] {
  const d = (def && typeof def === 'object' ? def : {}) as {
    panel?: { kind?: unknown };
    morePanels?: { kind?: unknown }[];
  };
  const kinds = d.panel
    ? [d.panel, ...(d.morePanels ?? [])]
        .map((p) => p.kind)
        .filter((k): k is string => typeof k === 'string')
    : [];
  return [...new Set([...kinds, ...cardsOfCheck('example', id)])];
}

/**
 * The current test's check, when its file is a validated feature (features.ts) and evidence is being recorded: every
 * comparison a test makes outside an example is recorded under it, and a test with none still leaves whether it passed.
 */
export function featureCheck(
  testName = expect.getState().currentTestName ?? '',
  create = true,
): Check | null {
  const feature = FEATURES[fileName()];
  if (!process.env.PS_VALIDATION_DIR || !feature || typeof feature === 'string') return null;
  const id = `${fileName()}::${testName}`;
  const key = `feature:${id}`;
  let check = checks.get(key);
  if (!check && create) {
    const cards = cardsOfCheck('feature', id),
      where = runtime();
    check = {
      id,
      subject: 'feature',
      title: `${feature.title}: ${testName}`,
      method: feature.method,
      level: feature.level,
      sources: feature.sources,
      comparisons: [],
      packages: feature.packages,
      passed: true,
      test: `${fileName()}: ${testName}`,
      ...(cards.length ? { cards } : {}),
      ...(where ? { runtime: where } : {}),
    };
    checks.set(key, check);
  }
  return check ?? null;
}

/** Start (or continue) the check of an example; until against(), comparisons count as "runs". */
export function example(
  id: string,
  meta: { title: string; method: string; packages: string[]; definition?: unknown },
): Check {
  const key = `example:${id}`;
  const test = `${fileName()}: ${expect.getState().currentTestName ?? ''}`;
  let check = checks.get(key);
  if (!check) {
    const cards = exampleCards(id, meta.definition),
      where = runtime();
    check = {
      id,
      subject: 'example',
      title: meta.title,
      method: meta.method,
      level: 'runs',
      sources: [],
      comparisons: [],
      packages: [...meta.packages],
      passed: true,
      test,
      ...(meta.definition !== undefined ? { definition: definitionHash(meta.definition) } : {}),
      ...(cards.length ? { cards } : {}),
      ...(where ? { runtime: where } : {}),
    };
    checks.set(key, check);
  } else {
    for (const p of meta.packages) if (!check.packages.includes(p)) check.packages.push(p);
    if (!check.test.includes(test)) check.test += `; ${test}`;
  }
  current.example = check;
  current.source = null;
  return check;
}

const RANK: Record<EvidenceLevel, number> = { published: 0, native: 1, recovery: 2, runs: 3 };

/** The source the next comparisons are made against. */
export function against(source: EvidenceSource & { level: EvidenceLevel }) {
  const check = current.example;
  if (!check) throw new Error('against() before example()');
  if (!check.sources.some((s) => s.label === source.label)) check.sources.push(source);
  current.source = source.label;
}

/** Record one comparison under the current example, or else the current test's feature check (setup.ts calls this for toBeCloseTo). */
export function recordComparison(
  quantity: string,
  value: number | string,
  reference: number | string,
  tolerance: number,
  passed: boolean,
) {
  const check = current.example;
  if (!check) {
    const f = featureCheck();
    if (f) {
      f.comparisons.push({ quantity, value, reference, tolerance });
      if (!passed) f.passed = false;
    }
    return;
  }
  const label = current.source;
  check.comparisons.push({
    quantity,
    value,
    reference,
    tolerance,
    ...(label ? { source: label } : {}),
  });
  if (!passed) check.passed = false;
  const src = label ? check.sources.find((s) => s.label === label) : undefined;
  if (src?.level && RANK[src.level] < RANK[check.level]) check.level = src.level;
}

/** An exact comparison (counts, df, labels), asserted and recorded. */
export function same(quantity: string, got: number | string, want: number | string) {
  recordComparison(quantity, got, want, 0, got === want);
  expect(got, quantity).toBe(want);
}

/** The browser self-check's digest of the current example's result (digest.ts). */
export function recordDigest(d: Record<string, number>) {
  if (current.example) current.example.digest = d;
}

/** |got − want| ≤ tolerance, asserted and recorded. */
export function near(quantity: string, got: number, want: number, tolerance: number) {
  recordComparison(quantity, got, want, tolerance, Math.abs(got - want) <= tolerance);
  expect(Math.abs(got - want), `${quantity}: |${got} − ${want}|`).toBeLessThanOrEqual(tolerance);
}

/** The run's own check: no unexpected R warnings or notes (the "runs" evidence every example has). */
export function cleanRun(unexpected: number) {
  const source = current.source;
  current.source = null;
  same('unexpected R warnings and notes', unexpected, 0);
  current.source = source;
}
