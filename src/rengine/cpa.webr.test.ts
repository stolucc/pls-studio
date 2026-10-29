// Every PROCESS model, estimated by our pipeline (src/process plan + manymome
// in webR), against what PROCESS itself reported on the same data
// (scripts/validation/process_reference.R). Bootstrap intervals differ by
// random numbers, so point estimates are compared: coefficients, conditional
// direct and indirect effects, and the indices of moderated mediation.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { materialise, template } from '../process/templates';
import { cpaScriptR, estimateCpaR, type At, type CpaInput } from './cpa';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

interface Effect { at: Record<string, number>; effect: number }
interface Reference {
  model: number; mediators: string[]; w: boolean; z: boolean;
  equations: Record<string, Record<string, number>>;
  direct: Effect[] | null;
  indirect: { path: string[]; effects: Effect[] }[];
  indices: { kind: string; path: string[]; moderator?: string; at?: Record<string, number>; index: number }[];
}

const DIR = join(__dirname, '..', 'process', '__fixtures__', 'reference');
const data = parseCsv(readFileSync(join(DIR, 'data.csv'), 'utf8')).dataset;
const fixtures = import.meta.glob<Reference>('../process/__fixtures__/reference/model*.json', { eager: true, import: 'default' });
const references = Object.values(fixtures).sort((a, b) => a.model - b.model);

const input = (r: Reference, boot = 50): CpaInput => {
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

describe.each(references.map((r) => [r.model, r] as const))('PROCESS model %i in webR (manymome)', (_, r) => {
  it('reproduces PROCESS', async () => {
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
      }
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

it('exports the script it runs', async () => {
  const script = await cpaScriptR(data, input(references.find((r) => r.model === 7)!, 1000));
  expect(script).toContain('fit_m1 <- lm(m1 ~ x + w + w:x + c1, data = data)');
  expect(script).toContain('boot_out <- do_boot(fits, R = 1000, seed = 1');
  expect(script).toContain('cond_indirect_effects(wlevels = mod_levels("w", fit = fits, values = probe_values$w), x = "x", y = "y", m = c("m1")');
}, 600_000);
