// Matching in webR against native MatchIt / cobalt / marginaleffects
// (scripts/validation/match.R): MatchIt's vignette on lalonde, 1:1 nearest-
// neighbour propensity score matching and full matching (ATT).
// Native MatchIt 4.7.2, webR 4.8.1. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { categoriesOf } from '../io';
import { rCall } from './bridge';
import { matchR, matchScriptR, type MatchInput } from './match';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'match', 'reference.json'), 'utf8'));
const base: MatchInput = { treatment: 'treat', covariates: ['age', 'educ', 'race', 'married', 'nodegree', 're74', 're75'], outcome: 're78',
  method: 'nearest', distance: 'glm', estimand: 'ATT', ratio: 1, caliper: null, replace: false, seed: 1, confidence: 0.95 };

describe('MatchIt on lalonde', () => {
  const load = async () => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: 'MatchIt', name: 'lalonde', na: [] }, 'MatchIt');
    return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
  };
  it.each(['nearest', 'full'] as const)('%s matching: sample sizes, balance and the effect equal native R', async (method) => {
    const data = await load();
    expect(data.categories?.race).toEqual(['black', 'hispan', 'white']);
    const r = await matchR(data, { ...base, method });
    const n = ref[method];
    expect(r.counts.map((x) => x.treated)).toEqual(n.nn);
    for (const [k, v] of Object.entries(n.diffAfter as Record<string, number>)) {
      const name = k === 'distance' ? 'Propensity score' : k;
      expect(r.balance.find((b) => b.variable === name)!.diffAfter, k).toBeCloseTo(v, 6);
    }
    expect(r.effect!.est).toBeCloseTo(n.effect.est, 4);
    // (marginaleffects differentiates numerically: agreement to about 7 significant digits)
    expect(r.effect!.se / n.effect.se).toBeCloseTo(1, 6);
  }, 900_000);

  it('the script carries the matching call and the factor coding', async () => {
    const s = await matchScriptR(await load(), base);
    expect(s).toContain('m <- matchit(treat ~ age + educ + race + married + nodegree + re74 + re75, data = data, method = "nearest", distance = "glm", estimand = "ATT")');
    expect(s).toContain('data$race <- factor(data$race, levels = seq_len(3), labels = c("black", "hispan", "white"))');
  }, 900_000);
});
