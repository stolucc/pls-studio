// @vitest-environment happy-dom
// public/validation.json, the evidence the app shows, is complete and current: every example has a check, every
// check passed, each example's definition is the one its evidence was recorded for, the self-check examples carry
// a digest, and the R packages are the versions in the webR lock. Regenerate with npm run validate:evidence.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../components/HomeScreen';
import { PACKAGE_EXAMPLES } from '../examples/packages';
import { BUILTIN } from '../io';
import { DEFAULT_SETTINGS } from '../model/project';
import { makeSample } from '../sample';
import { definitionHash } from './record';
import { SELF_CHECK_IDS } from './selfCheck';
import { builtinDefinition } from './textbook';
import type { Evidence } from './types';

const root = join(__dirname, '..', '..');
const evidence = JSON.parse(readFileSync(join(root, 'public', 'validation.json'), 'utf8')) as Evidence;
const lock = JSON.parse(readFileSync(join(root, 'scripts', 'webr', 'webr-lock.json'), 'utf8')) as { webr: string; r: string; packages: Record<string, { version: string }> };
const exampleCheck = (id: string) => evidence.checks.find((c) => c.subject === 'example' && c.id === id);
const STALE = 'changed since its evidence was recorded: npm run validate:evidence';

describe('the validation evidence', () => {
  it('every check passed', () => {
    expect(evidence.checks.filter((c) => !c.passed).map((c) => `${c.subject} ${c.id}`)).toEqual([]);
  });

  it('every example has a check, with a level and at least the run’s own comparison', () => {
    const ids = [...EXAMPLES.map((e) => e.id), ...PACKAGE_EXAMPLES.map((e) => e.id)];
    expect(ids.filter((id) => !exampleCheck(id))).toEqual([]);
    for (const id of ids) expect(exampleCheck(id)!.comparisons.length, id).toBeGreaterThan(0);
  });

  it('a level above “runs” comes with a source that has comparisons', () => {
    for (const c of evidence.checks.filter((x) => x.subject === 'example' && x.level !== 'runs')) {
      const used = new Set(c.comparisons.map((x) => x.source));
      expect(c.sources.some((s) => s.level === c.level && used.has(s.label)), `${c.id}: ${c.level}`).toBe(true);
    }
  });

  it('each package example is the one its evidence was recorded for', () => {
    for (const ex of PACKAGE_EXAMPLES) expect(exampleCheck(ex.id)!.definition, `${ex.id} ${STALE}`).toBe(definitionHash(ex));
  });

  it('each built-in example is the one its evidence was recorded for', async () => {
    const { data, model } = makeSample();
    expect(exampleCheck('customer')!.definition, `customer ${STALE}`).toBe(definitionHash(builtinDefinition({ model, data })));
    for (const [id, b] of Object.entries(BUILTIN)) {
      const ex = (await b.make())(DEFAULT_SETTINGS);
      expect(exampleCheck(id)!.definition, `${id} ${STALE}`).toBe(definitionHash(builtinDefinition(ex)));
    }
  }, 60_000);

  it('the self-check examples carry their digests', () => {
    for (const id of SELF_CHECK_IDS) expect(Object.keys(exampleCheck(id)?.digest ?? {}).length, id).toBeGreaterThan(5);
  });

  it('was recorded with the R and package versions the app ships', () => {
    expect(evidence.webR).toBe(lock.webr);
    expect(evidence.R).toBe(lock.r);
    for (const [p, v] of Object.entries(evidence.versions)) expect(v, p).toBe(lock.packages[p]?.version);
  });
});
