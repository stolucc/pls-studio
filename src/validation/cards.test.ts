// @vitest-environment happy-dom
// The per-analysis evidence manifest (cards.ts) is complete and its references are real: an entry for every registered
// card and every mode in the cards' own option lists, examples that exist, open that card and are graded against a
// reference, validated test files that exist, and the number of gaps only ever goes down. No R.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANALYSIS_TYPES } from '../analyses/registry';
import { BTTEST_TYPES } from '../analyses/bayes';
import { BSEM_ENGINES } from '../analyses/bsem';
import { CHART_KINDS } from '../analyses/charts';
import { CUSTOMML_TYPES } from '../analyses/customml';
import { DID_DESIGNS } from '../analyses/did';
import { ENDO_METHODS } from '../analyses/endo';
import { IRT_MODELS, LCA_AUX_METHODS, LCA_KINDS } from '../analyses/items';
import { PSEM_MODES } from '../analyses/psem';
import { MATCH_METHODS } from '../analyses/match';
import { METASEM_METHODS } from '../analyses/metasem';
import { EGA_MODELS, NETWORK_COR_METHODS, NETWORK_ESTIMATORS } from '../analyses/network';
import { QUAD_SOURCES } from '../analyses/quadml';
import { FAMILIES, LINKS, ZERO_MODELS } from '../analyses/regression';
import { CORRELATION_METHODS, FREQTEST_TYPES, RELIABILITY_TYPES, TTEST_TYPES } from '../analyses/tests';
import { CMB_TYPES } from '../analyses/validity';
import { HYP_MODES } from '../analyses/hypotheses';
import { APIM_MODES } from '../analyses/apim';
import { EXAMPLES } from '../components/HomeScreen';
import { examplePanels, PACKAGE_EXAMPLES } from '../examples/packages';
import { EFA_METHODS } from '../model/efa';
import { BOOT_INTERVALS, CB_ESTIMATORS, HOC_APPROACHES, INTERACTIONS, MISSING_TREATMENTS, PLS_APPROACHES } from '../model/project';
import { DFI_FUNCTIONS } from '../rengine/dfi';
import { GLMM_FAMILIES } from '../rengine/glmm';
import { CARD_EVIDENCE, evidenceClass, splitFeature } from './cards';
import { FEATURES } from './features';
import type { Evidence } from './types';
import { cases } from '../engine/validationHarness';
import { evidenceKinds } from './useEvidence';

/** The gaps left (entries with `todo`): this may only go down. */
const TODO_MAX = 2;

/** Each card's statistically distinct modes, from its own option lists: a new family, link or engine needs an entry. */
const CARD_MODES: Record<string, readonly string[]> = {
  chart: CHART_KINDS, ttest: TTEST_TYPES, correlation: CORRELATION_METHODS, freqtest: FREQTEST_TYPES, reliability: RELIABILITY_TYPES, bttest: BTTEST_TYPES,
  regression: [...FAMILIES.map(([f]) => f), ...Object.entries(LINKS).flatMap(([f, links]) => links.slice(1).map(([l]) => `${f}:${l}`)), ...ZERO_MODELS],
  customml: CUSTOMML_TYPES, did: DID_DESIGNS, efa: EFA_METHODS.map((m) => m.id), cmb: CMB_TYPES, irt: IRT_MODELS, lca: [...LCA_KINDS.map((k) => k.id), ...LCA_AUX_METHODS.map(([m]) => `aux:${m}`)], quadml: QUAD_SOURCES,
  network: [...NETWORK_ESTIMATORS.map((e) => `estimator:${e}`), ...NETWORK_COR_METHODS.map((c) => `cor:${c}`)], ega: EGA_MODELS, dynamicfit: DFI_FUNCTIONS,
  metasem: METASEM_METHODS, psem: PSEM_MODES, bsem: BSEM_ENGINES, endo: ENDO_METHODS, glmm: GLMM_FAMILIES, hypotheses: HYP_MODES, apim: APIM_MODES,
  // MatchIt's methods (nearest, optimal, full, …) share one code path; weighting is WeightIt's.
  match: [...new Set(MATCH_METHODS.map((m) => (m === 'weighting' ? 'weighting' : 'matchit')))],
};
/** The Model tab's estimation choices (model/project.ts). */
const MODEL_MODES = [
  ...CB_ESTIMATORS.map((e) => `model:cbsem:estimator:${e}`), ...PLS_APPROACHES.map((a) => `model:plsApproach:${a}`), ...HOC_APPROACHES.map((a) => `model:hocApproach:${a}`),
  ...MISSING_TREATMENTS.map((m) => `model:missing:${m}`), ...BOOT_INTERVALS.map((b) => `model:bootInterval:${b}`), ...INTERACTIONS.map((i) => `model:interaction:${i}`),
];

const src = join(__dirname, '..');
const root = join(src, '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
/** Test code that grades examples (calls against()): test files and their kits. */
const graders = walk(src).filter((p) => /\.tsx?$/.test(p) && !p.endsWith(join('validation', 'record.ts'))).map((p) => readFileSync(p, 'utf8')).filter((t) => t.includes('against('));
/** An example id as a grader names it: `'id'`, or an Mplus example by its key (`'ex6.26'`). */
const named = (t: string, id: string) => t.includes(`'${id}'`) || (id.startsWith('mplus-') && t.includes(`'${id.slice(6)}'`));
const evidence = existsSync(join(root, 'public', 'validation.json')) ? JSON.parse(readFileSync(join(root, 'public', 'validation.json'), 'utf8')) as Evidence : null;
const ids = new Set(ANALYSIS_TYPES.map((t) => t.id));
const entries = Object.entries(CARD_EVIDENCE);
const cardOf = (key: string) => key.split(':')[0];
/** The source of a FEATURES test file (`rengine/tests` → src/rengine/tests.webr.test.ts). */
const featureSource = (file: string) => {
  const p = ['.webr.test.ts', '.webr.test.tsx', '.test.ts', '.test.tsx'].map((x) => join(src, `${file}${x}`)).find(existsSync);
  return p ? readFileSync(p, 'utf8') : null;
};

describe('the per-analysis evidence manifest', () => {
  it('has an entry for every card, every mode of a card and every Model-tab choice, and no other', () => {
    const want = [...ids, ...Object.entries(CARD_MODES).flatMap(([card, modes]) => modes.map((m) => `${card}:${m}`)), ...MODEL_MODES];
    expect(want.filter((k) => !CARD_EVIDENCE[k]), 'missing entries').toEqual([]);
    const free = (k: string) => (k.startsWith('model:') || k.startsWith('builtin:')) && !MODEL_MODES.includes(k);
    expect(Object.keys(CARD_EVIDENCE).filter((k) => !want.includes(k) && !free(k)), 'entries for no card or mode').toEqual([]);
    for (const card of Object.keys(CARD_MODES)) expect(ids.has(card), card).toBe(true);
  });

  it('gives every mode and every Model-tab or built-in entry a title, and a card its own evidence or that of its modes', () => {
    for (const [k, e] of entries) {
      if (!ids.has(k)) expect(e.title, k).toBeTruthy();
      const cls = evidenceClass(e);
      if (cls === 'modes') expect(CARD_MODES[k], `${k}: no evidence of its own and no modes`).toBeTruthy();
      if (cls === 'none' || cls === 'todo') expect(e.examples ?? e.features ?? e.unit, `${k}: none/todo with evidence`).toBeUndefined();
    }
  });

  it('names examples that exist, open that card and are graded against a reference', () => {
    const known = new Set([...EXAMPLES.map((e) => e.id), ...PACKAGE_EXAMPLES.map((e) => e.id)]);
    const bad: string[] = [];
    for (const [k, e] of entries) for (const id of e.examples ?? []) {
      if (!known.has(id)) { bad.push(`${k}: no example ${id}`); continue; }
      const pkg = PACKAGE_EXAMPLES.find((x) => x.id === id);
      // (an example that opens cards must open this one; a Model-tab example, e.g. the MGA's, opens none)
      if (ids.has(cardOf(k)) && pkg && examplePanels(pkg).length && !examplePanels(pkg).some((p) => p.kind === cardOf(k))) bad.push(`${k}: ${id} does not open the card`);
      const recorded = evidence?.checks.find((c) => c.subject === 'example' && c.id === id);
      if (!((recorded && !evidenceKinds(recorded).includes('runs')) || graders.some((t) => named(t, id)))) bad.push(`${k}: ${id} is not graded (against() in a test, or published/native evidence)`);
    }
    expect(bad).toEqual([]);
  });

  it('names validated test files that exist, and tests in them', () => {
    const bad: string[] = [];
    for (const [k, e] of entries) for (const ref of e.features ?? []) {
      const { file, test } = splitFeature(ref);
      const f = FEATURES[file];
      if (f === undefined || typeof f === 'string') bad.push(`${k}: ${file} is not a validated feature (features.ts)`);
      // (the corpus test names its tests by case: engine/validation::pls_ is every pls_* case)
      else if (test && !featureSource(file)?.includes(test) && !(file === 'engine/validation' && cases.some((c) => c.name.startsWith(test)))) bad.push(`${k}: no test of ${file} named “…${test}…”`);
    }
    expect(bad).toEqual([]);
  });

  it('names unit tests that exist', () => {
    for (const [k, e] of entries) for (const u of e.unit ?? []) {
      expect(existsSync(join(root, u.file)), `${k}: ${u.file}`).toBe(true);
      expect(u.reference.length, k).toBeGreaterThan(0);
    }
  });

  it(`has at most ${TODO_MAX} gaps (lower TODO_MAX when one is closed)`, () => {
    const todo = entries.filter(([, e]) => e.todo).map(([k]) => k);
    expect(todo.length, todo.join(', ')).toBeLessThanOrEqual(TODO_MAX);
  });
});
