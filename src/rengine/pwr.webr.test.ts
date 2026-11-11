// The Power (standard tests) card equals pwr called directly in desktop R (scripts/validation/pwr.R): the help
// pages' examples (Cohen 1988's exercises) for achieved power and the N needed, and the sensitivity mode.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseStdPowerOptions, stdPowerInput } from '../analyses/stdPower';
import { examplePanels, PACKAGE_EXAMPLES, panelPreset } from '../examples/packages';
import { against, example, near } from '../validation/record';
import { pwrR, pwrScriptR, type PwrInput } from './pwr';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

type Case = { n: number; power: number; effect: number };
const ref = JSON.parse(
  readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'pwr', 'reference.json'), 'utf8'),
) as Record<string, Case> & { t2_curve_100: number };

const CASES: [string, PwrInput][] = [
  ['t1_power', { test: 't1', solve: 'power', alpha: 0.1, effect: 0.2, n: 60 }],
  [
    'paired_power',
    { test: 'paired', solve: 'power', alpha: 0.05, effect: 8 / (16 * Math.sqrt(0.8)), n: 40 },
  ],
  ['t2_power', { test: 't2', solve: 'power', alpha: 0.05, effect: 2 / 2.8, n: 30 }],
  [
    't2_n',
    { test: 't2', solve: 'n', alpha: 0.05, effect: 0.3, power: 0.75, alternative: 'greater' },
  ],
  ['anova_power', { test: 'anova', solve: 'power', alpha: 0.05, effect: 0.28, k: 4, n: 20 }],
  ['anova_n', { test: 'anova', solve: 'n', alpha: 0.05, effect: 0.28, k: 4, power: 0.8 }],
  [
    'p2_power',
    { test: 'p2', solve: 'power', alpha: 0.05, effect: 0.3, n: 80, alternative: 'greater' },
  ],
  [
    'p1_power',
    { test: 'p1', solve: 'power', alpha: 0.05, effectFrom: 'props', prop1: 0.5, prop2: 0.4, n: 60 },
  ],
  ['p1_n', { test: 'p1', solve: 'n', alpha: 0.05, effect: 0.2, power: 0.95 }],
  ['r_power', { test: 'r', solve: 'power', alpha: 0.05, effect: 0.3, n: 50 }],
  [
    'r_power_greater',
    { test: 'r', solve: 'power', alpha: 0.05, effect: 0.3, n: 50, alternative: 'greater' },
  ],
  ['r_n', { test: 'r', solve: 'n', alpha: 0.05, effect: 0.3, power: 0.8 }],
  ['chisq_power', { test: 'chisq', solve: 'power', alpha: 0.05, effect: 0.289, df: 3, n: 100 }],
  ['chisq_power_01', { test: 'chisq', solve: 'power', alpha: 0.01, effect: 0.346, df: 2, n: 140 }],
  ['chisq_n', { test: 'chisq', solve: 'n', alpha: 0.05, effect: 0.1, df: 20, power: 0.8 }],
  ['f2_power', { test: 'f2', solve: 'power', alpha: 0.05, effect: 0.1 / 0.9, u: 5, n: 95 }],
  ['f2_n', { test: 'f2', solve: 'n', alpha: 0.05, effect: 0.15, u: 3, power: 0.8 }],
  ['t2_effect', { test: 't2', solve: 'effect', alpha: 0.05, n: 64, power: 0.8 }],
  ['anova_effect', { test: 'anova', solve: 'effect', alpha: 0.05, k: 3, n: 30, power: 0.9 }],
  ['p2_effect', { test: 'p2', solve: 'effect', alpha: 0.05, n: 100, power: 0.8 }],
  ['r_effect', { test: 'r', solve: 'effect', alpha: 0.05, n: 80, power: 0.8 }],
  ['chisq_effect', { test: 'chisq', solve: 'effect', alpha: 0.01, df: 2, n: 140, power: 0.8 }],
  ['f2_effect', { test: 'f2', solve: 'effect', alpha: 0.05, u: 4, n: 100, power: 0.8 }],
  [
    'p2_props_n',
    {
      test: 'p2',
      solve: 'n',
      alpha: 0.05,
      effectFrom: 'props',
      prop1: 0.65,
      prop2: 0.45,
      power: 0.9,
    },
  ],
];

describe('power for standard tests (pwr)', () => {
  it.each(CASES)('%s equals pwr in desktop R', async (key, input) => {
    const r = await pwrR(input);
    const want = ref[key];
    // Closed forms (noncentral t, F, χ², normal) to 1e-6; solved quantities come from uniroot, whose tolerance
    // (pwr's tol = .Machine$double.eps^0.25) allows ~1e-5 between webR and desktop R.
    const solvedDigits = 4;
    expect(r.power, `${key}: power`).toBeCloseTo(want.power, input.solve === 'power' ? 6 : 4);
    expect(r.n, `${key}: N`).toBeCloseTo(want.n, input.solve === 'n' ? solvedDigits : 8);
    expect(r.effect, `${key}: effect size`).toBeCloseTo(
      want.effect,
      input.solve === 'effect' ? solvedDigits : 8,
    );
    if (input.solve === 'n') expect(r.nNeeded).toBe(Math.ceil(want.n));
  });

  it('draws the power curve over N with pwr at each point; the script is the one that ran', async () => {
    const input: PwrInput = {
      test: 't2',
      solve: 'n',
      alpha: 0.05,
      effect: 0.3,
      power: 0.75,
      alternative: 'greater',
    };
    const r = await pwrR(input);
    const at = r.curve.n.indexOf(100);
    const i = at >= 0 ? at : r.curve.n.findIndex((n) => n > 100);
    expect(r.curve.n.length).toBeGreaterThan(20);
    expect(r.curve.n[0]).toBe(2);
    // The curve rises with N.
    for (let k = 1; k < r.curve.power.length; k++)
      expect(r.curve.power[k]).toBeGreaterThan(r.curve.power[k - 1]);
    if (at >= 0) expect(r.curve.power[i], 'curve at n = 100').toBeCloseTo(ref.t2_curve_100, 6);
    const script = await pwrScriptR(input);
    expect(script).toContain(
      'pw <- pwr.t.test(n = NULL, d = 0.3, sig.level = 0.05, power = 0.75, type = "two.sample", alternative = "greater")',
    );
  });

  it('rejects requests outside the whitelist', async () => {
    await expect(pwrR({ test: 'x' as never, solve: 'n', alpha: 0.05 })).rejects.toThrow(/test/);
    await expect(
      pwrR({
        test: 't2',
        solve: 'n',
        alpha: 0.05,
        effect: 0.5,
        power: 0.8,
        alternative: 'up' as never,
      }),
    ).rejects.toThrow(/alternative/);
    await expect(
      pwrR({ test: 't2', solve: 'n', alpha: 0.05, effect: 0, power: 0.8 }),
    ).rejects.toThrow(/zero/);
  });
});

// The home-screen example: pwr's help pages (Cohen's exercises), each card as the example opens it.
it('the pwr example’s cards equal the help pages run natively', async () => {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === 'pwr-cohen')!;
  example('pwr-cohen', {
    title: ex.title,
    method: 'Basic statistics',
    packages: ['pwr'],
    definition: ex,
  });
  against({
    label: 'the help pages’ examples in desktop R, scripts/validation/pwr.R',
    script: 'scripts/validation/pwr.R',
    level: 'native',
  });
  const keys = ['t2_n', 'anova_n', 'r_n', 'f2_power'];
  const panels = examplePanels(ex);
  expect(panels.length).toBe(keys.length);
  for (const [i, panel] of panels.entries()) {
    const options = parseStdPowerOptions(panelPreset(panel))!;
    const r = await pwrR(stdPowerInput(options));
    const want = ref[keys[i]];
    // (N from uniroot: 1e-4; the power of a given N is a closed form: 1e-6)
    near(`${keys[i]}: N`, r.n, want.n, 1e-4);
    near(`${keys[i]}: power`, r.power, want.power, options.solve === 'power' ? 1e-6 : 1e-4);
  }
});
