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
import { checks, current, fileName } from './collector';
import type { Check, EvidenceLevel, EvidenceSource } from './types';

/** A stable hash of an example's definition (key order normalised). */
export function definitionHash(def: unknown): string {
  const norm = (v: unknown): unknown => (Array.isArray(v) ? v.map(norm) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])])) : v);
  return createHash('sha256').update(JSON.stringify(norm(def) ?? null)).digest('hex').slice(0, 16);
}

/** Start (or continue) the check of an example; until against(), comparisons count as "runs". */
export function example(id: string, meta: { title: string; method: string; packages: string[]; definition?: unknown }): Check {
  const key = `example:${id}`;
  const test = `${fileName()}: ${expect.getState().currentTestName ?? ''}`;
  let check = checks.get(key);
  if (!check) {
    check = { id, subject: 'example', title: meta.title, method: meta.method, level: 'runs', sources: [], comparisons: [], packages: [...meta.packages], passed: true, test,
      ...(meta.definition !== undefined ? { definition: definitionHash(meta.definition) } : {}) };
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

/** Record one comparison under the current example (setup.ts calls this for toBeCloseTo). */
export function recordComparison(quantity: string, value: number | string, reference: number | string, tolerance: number, passed: boolean) {
  const check = current.example;
  if (!check) return;
  const label = current.source;
  check.comparisons.push({ quantity, value, reference, tolerance, ...(label ? { source: label } : {}) });
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
