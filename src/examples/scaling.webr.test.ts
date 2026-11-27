// Three ways to give a latent variable its scale (packages.ts: lavaan-hs-scale-x1, -x2, -effects), each opened as the
// app opens it, from its lavaan syntax, and compared with desktop lavaan: the same fit and standardised solution, but
// the unstandardised effect and its Wald z differ with the scaling (Gonzalez & Griffin 2001), while the
// likelihood-ratio test of the effect does not. Effects coding: loadings constrained to average 1 (Little, Slegers &
// Card 2006), through the syntax import's equality constraints. Run with npm run test:webr.

import { afterAll, beforeAll, expect, it } from 'vitest';
import { exampleModel, exampleSettings, PACKAGE_EXAMPLES } from './packages';
import { DEFAULT_SETTINGS, toSpec } from '../model/project';
import { cbScriptLavaan, estimateCbLavaan } from '../rengine/lavaan';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { against, example, near, same } from '../validation/record';
import { load } from './cards/modelHarness';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

async function fit(id: string) {
  const ex = PACKAGE_EXAMPLES.find((e) => e.id === id)!;
  example(id, { title: ex.title, method: 'CB-SEM', packages: ['lavaan'], definition: ex });
  const data = await load(ex);
  const settings = exampleSettings(DEFAULT_SETTINGS, ex.settings);
  const run = (syntax: string) =>
    estimateCbLavaan(data, toSpec(exampleModel({ ...ex, syntax })), settings.missing, 'ML');
  const r = await run(ex.syntax!);
  // (the same model with the effect fixed at 0, for the likelihood-ratio test)
  const zero = await run(ex.syntax!.replace('textual ~ visual', 'textual ~ 0*visual'));
  const find = (lhs: string, op: string, rhs: string) =>
    r.estimates.find((e) => e.lhs === lhs && e.op === op && e.rhs === rhs)!;
  const script = await cbScriptLavaan(data, toSpec(exampleModel(ex)), settings.missing, 'ML');
  return { r, zero, find, script };
}

const DESKTOP = {
  label: 'desktop lavaan 0.7-3, sem() on HolzingerSwineford1939 with the same syntax',
  level: 'native' as const,
};

it.each([
  ['lavaan-hs-scale-x1', 0.503, 5.235, [1, 0.559, 0.708]],
  ['lavaan-hs-scale-x2', 0.9, 4.744, null],
  ['lavaan-hs-scale-effects', 0.674, 6.159, [1.323, 0.74, 0.937]],
] as const)(
  '%s: the same fit and standardised effect, its own unstandardised effect and z',
  async (id, est, z, loadings) => {
    const { r, zero, find, script } = await fit(id);
    expect(r.converged).toBe(true);
    against(DESKTOP);
    near('χ²', r.fit.chisq, 24.361, 0.001);
    same('df', r.fit.df, 8);
    const path = find('textual', '~', 'visual');
    near('standardised effect of visual on textual', path.std, 0.4606, 0.0005);
    near('unstandardised effect', path.est, est, 0.0005);
    near('Wald z', path.z!, z, 0.0005);
    // (desktop lavaan, lavTestLRT of the effect fixed at 0: 35.581 on 1 df, whichever the scaling)
    near('Δχ² of fixing the effect at 0', zero.fit.chisq - r.fit.chisq, 35.581, 0.001);
    // (effects coding in the script: every loading labelled, the constraint in place of a marker)
    if (id === 'lavaan-hs-scale-effects') {
      expect(script).toContain('visual =~ NA*x1 + efc1_1*x1 + efc1_2*x2 + efc1_3*x3');
      expect(script).toContain('efc1_1 == 3 - efc1_2 - efc1_3');
      expect(script).not.toContain('visual ~~ 1*visual');
    } else expect(script).not.toContain('efc');
    if (loadings) {
      loadings.forEach((l, k) =>
        near(`loading of x${k + 1}`, find('visual', '=~', `x${k + 1}`).est, l, 0.0005),
      );
    }
  },
  600_000,
);
