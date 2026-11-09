// Every PROCESS model, estimated by our pipeline (src/process plan + manymome
// in webR), against what PROCESS itself reported on the same data
// (scripts/validation/process_reference.R). Bootstrap intervals differ by
// random numbers, so point estimates are compared: coefficients, conditional
// direct and indirect effects, and the indices of moderated mediation.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { itIfFast } from './webrSlow';
import { parseCsv } from '../engine/dataset';
import { materialise, template } from '../process/templates';
import { cpaScriptR, estimateCpaR, type At, type CpaInput, type CpaResult } from './cpa';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

interface Effect { at: Record<string, number>; effect: number }
interface Reference {
  model: number; mediators: string[]; w: boolean; z: boolean; hc: 'none' | 'HC0' | 'HC1' | 'HC2' | 'HC3' | 'HC4';
  equations: Record<string, Record<string, number>>;
  se: Record<string, Record<string, number>>;
  summary: Record<string, { r2: number; f: number; df1: number; df2: number }>;
  interactions?: Record<string, { label: string; r2change: number; f: number; df1: number; p: number }[]>;
  direct: (Effect & { se?: number })[] | null;
  indirect: { path: string[]; effects: Effect[] }[];
  indices: { kind: string; path: string[]; moderator?: string; at?: Record<string, number>; index: number }[];
}

const DIR = join(__dirname, '..', 'process', '__fixtures__', 'reference');
const data = parseCsv(readFileSync(join(DIR, 'data.csv'), 'utf8')).dataset;
const fixtures = import.meta.glob<Reference>('../process/__fixtures__/reference/model*.json', { eager: true, import: 'default' });
const references = Object.values(fixtures).sort((a, b) => a.model - b.model);

const input = (r: Reference, boot = 50): CpaInput => ({ ...baseInput(r, boot), hc: r.hc ?? 'none' });
const baseInput = (r: Reference, boot: number): CpaInput => {
  const roles = { x: 'x', y: 'y', m: r.mediators, w: r.w ? 'w' : undefined, z: r.z ? 'z' : undefined };
  const names = ['x', 'y', ...r.mediators, ...(r.w ? ['w'] : []), ...(r.z ? ['z'] : []), 'c1'];
  return {
    graph: materialise(template(r.model)!, roles), model: r.model, order: ['w', 'z'],
    variables: names.map((name) => ({ name, indicators: [name] })), covariates: ['c1'],
    missing: 'casewise', probe: 'percentiles', boot: { samples: boot, seed: 1 }, confidence: 0.95,
  };
};

const TOL = 1e-6;
const sameAt = (a: At, b: Record<string, number>) => Object.keys(b).length === Object.keys(a).length && Object.entries(b).every(([k, v]) => Math.abs(a[k] - v) < TOL);
const key = (p: string[]) => p.join('>');
const KIND: Record<string, string> = {
  'Index of moderated mediation': 'mm', 'Indices of partial moderated mediation': 'partial',
  'Index of moderated moderated mediation': 'mmm', 'Indices of conditional moderated mediation by W': 'cmm',
};

/** PROCESS labels rows by role ("X*W", "BOTH(M1)"); the reference data names variables by role in lower case. */
function checkInteractions(mine: CpaResult['equations'][number]['interactions'], theirs: NonNullable<Reference['interactions']>[string]) {
  expect(mine.length, 'number of interaction tests').toBe(theirs.length);
  for (const t of theirs) {
    const both = /^BOTH/.exec(t.label);
    const focal = both ? (/\((\w+)\)/.exec(t.label)?.[1] ?? 'x').toLowerCase() : '';
    const key = t.label.toLowerCase().split('*').sort().join('*');
    const row = both ? mine.find((x) => x.terms.length > 1 && x.focal === focal) : mine.find((x) => x.terms.length === 1 && [...x.terms[0]].sort().join('*') === key);
    expect(row, t.label).toBeTruthy();
    expect(row!.r2change, `${t.label} R² change`).toBeCloseTo(t.r2change, 6);
    expect(row!.f, `${t.label} F`).toBeCloseTo(t.f, 4);
    expect(row!.df1).toBe(t.df1);
  }
}

/** The PROCESS models that take 15 s or more in webR (with a bootstrap): run with WEBR_SLOW, as npm run validate:evidence does. */
const SLOW_MODELS = new Set([11, 12, 13, 17, 18, 19, 20, 21, 22, 28, 29, 66, 69, 70, 71, 72, 73, 75, 76, 88, 89]);
describe.each(references.map((r) => [r.model, r] as const))('PROCESS model %i in webR (manymome)', (_, r) => {
  itIfFast(SLOW_MODELS.has(r.model))('reproduces PROCESS', async () => {
    const res = await estimateCpaR(data, input(r));
    expect(res.n).toBe(300);
    for (const [outcome, coef] of Object.entries(r.equations)) {
      const eq = res.equations.find((e) => e.outcome === outcome)!;
      expect(eq, outcome).toBeTruthy();
      expect(eq.coefficients.length).toBe(Object.keys(coef).length);
      for (const [term, b] of Object.entries(coef)) {
        const vars = term === 'constant' ? '' : term.split('*').sort().join('*');
        const mine = eq.coefficients.find((c) => [...c.term].sort().join('*') === vars);
        expect(mine?.est, `${outcome}: ${term}`).toBeCloseTo(b, 6);
        expect(mine?.se, `${outcome}: se of ${term}`).toBeCloseTo(r.se[outcome][term], 6);
      }
      expect(eq.r2).toBeCloseTo(r.summary[outcome].r2, 6);
      expect(eq.f!).toBeCloseTo(r.summary[outcome].f, 4);
      checkInteractions(eq.interactions, r.interactions?.[outcome] ?? []);
    }
    if (r.direct) {
      expect(res.direct!.rows.length).toBe(r.direct.length);
      for (const d of r.direct) expect(res.direct!.rows.find((x) => sameAt(x.at, d.at))?.est, `direct at ${JSON.stringify(d.at)}`).toBeCloseTo(d.effect, 6);
    }
    for (const p of r.indirect) {
      const mine = res.indirect.find((i) => key(i.path) === key(p.path))!;
      expect(mine, key(p.path)).toBeTruthy();
      expect(mine.rows.length).toBe(p.effects.length);
      for (const e of p.effects) expect(mine.rows.find((x) => sameAt(x.at, e.at))?.est, `${key(p.path)} at ${JSON.stringify(e.at)}`).toBeCloseTo(e.effect, 6);
    }
    expect(res.indices.length).toBe(r.indices.length);
    for (const i of r.indices) {
      const kind = KIND[i.kind];
      const mine = res.indices.find((x) => x.kind === kind && key(x.path) === key(i.path) && (x.moderator === i.moderator || kind !== 'mm' && kind !== 'partial') && (!i.at || sameAt(x.at ?? {}, i.at)));
      expect(mine?.est, `${i.kind} ${key(i.path)}`).toBeCloseTo(i.index, 6);
      expect(mine!.lo).toBeLessThanOrEqual(mine!.hi);
    }
  }, 600_000);
});

const hcFixtures = import.meta.glob<Reference>('../process/__fixtures__/reference/hc/model*.json', { eager: true, import: 'default' });

describe.each(Object.entries(hcFixtures).map(([f, r]) => [f.split('/').pop()!, r] as const))('heteroskedasticity-consistent SEs: %s', (_, r) => {
  it('match PROCESS’s hc option', async () => {
    const res = await estimateCpaR(data, input(r, 2));
    expect(res.hc).toBe(r.hc);
    for (const [outcome, se] of Object.entries(r.se)) {
      const eq = res.equations.find((e) => e.outcome === outcome)!;
      for (const [term, v] of Object.entries(se)) {
        const vars = term === 'constant' ? '' : term.split('*').sort().join('*');
        expect(eq.coefficients.find((c) => [...c.term].sort().join('*') === vars)?.se, `${outcome}: ${term}`).toBeCloseTo(v, 6);
      }
      expect(eq.f!, `${outcome}: robust F`).toBeCloseTo(r.summary[outcome].f, 4);
      checkInteractions(eq.interactions, r.interactions?.[outcome] ?? []);
    }
    for (const d of r.direct ?? []) if (d.se !== undefined) expect(res.direct!.rows.find((x) => sameAt(x.at, d.at))?.se).toBeCloseTo(d.se, 6);
  }, 600_000);
});

it('exports the script it runs', async () => {
  const script = await cpaScriptR(data, input(references.find((r) => r.model === 7)!, 1000));
  expect(script).toContain('fit_m1 <- lm(m1 ~ x + w + w:x + c1, data = data)');
  expect(script).toContain('boot_out <- do_boot(fits, R = 1000, seed = 1');
  expect(script).toContain('cond_indirect_effects(wlevels = mod_levels("w", fit = fits, values = probe_values$w), x = "x", y = "y", m = c("m1")');
}, 600_000);
