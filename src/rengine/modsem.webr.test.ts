// Latent interactions by LMS and QML (modsem) in webR. Two checks: our results
// equal modsem's own parameter and standardised estimates in the same session
// (the mapping), and they agree with native modsem (scripts/validation/modsem.R,
// an older build: different integration settings, so within 0.01).
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { johnsonNeyman } from '../engine/jn';
import type { ModelSpec } from '../engine/types';
import commonR from './R/common.R?raw';
import { cbScriptLavaan, estimateCbLavaan } from './lavaan';
import { callJson, withR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'engine', '__fixtures__', 'modsem');
const data = parseCsv(readFileSync(join(DIR, 'oneInt.csv'), 'utf8')).dataset;
const ref = JSON.parse(readFileSync(join(DIR, 'oneInt.json'), 'utf8'));
const f = (name: string, p: string) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators: [1, 2, 3].map((i) => `${p}${i}`) });
const spec: ModelSpec = {
  constructs: [f('X', 'x'), f('Z', 'z'), f('Y', 'y')],
  paths: [{ from: 'X', to: 'Y' }, { from: 'Z', to: 'Y' }],
  moderations: [{ from: 'X', moderator: 'Z', to: 'Y' }],
};
type Row = { lhs: string; op: string; rhs: string; est: number; se: number; std: number };

describe.each(['lms', 'qml'] as const)('%s', (method) => {
  it('equals modsem’s own estimates and agrees with native modsem', async () => {
    const r = await estimateCbLavaan(data, spec, 'casewise', 'ML', method);
    expect(r.interaction).toBe(method);
    expect(r.constructs).toContain('X × Z');
    const own = await withR(['jsonlite', 'modsem'], { common: commonR }, (webR) => callJson(webR, `
      library(modsem); m <- "X =~ x1 + x2 + x3\\nZ =~ z1 + z2 + z3\\nY =~ y1 + y2 + y3\\nY ~ X + Z + X:Z"
      f <- modsem(m, oneInt, method = "${method}"); pe <- parameter_estimates(f); st <- standardized_estimates(f)
      s <- pe[pe$op == "~", ]; ps_json(lapply(seq_len(nrow(s)), function(i) list(rhs = s$rhs[i], est = s$est[i], se = s$std.error[i],
        std = st$est[st$op == "~" & st$rhs == s$rhs[i]])))`, null)) as { rhs: string; est: number; se: number; std: number }[];
    const name = (x: string) => (x === 'X:Z' ? 'X × Z' : x);
    for (const o of own) {
      const e = r.estimates.find((x) => x.op === '~' && x.lhs === 'Y' && x.rhs === name(o.rhs))!;
      expect(e.est, o.rhs).toBeCloseTo(o.est, 8);
      expect(e.se!).toBeCloseTo(o.se, 8);
      expect(e.std).toBeCloseTo(o.std, 8);
    }
    for (const e of (ref[method].estimates as Row[]).filter((x) => x.op === '~')) {
      expect(r.estimates.find((x) => x.op === '~' && x.lhs === 'Y' && x.rhs === name(e.rhs))!.est, `native ${e.rhs}`).toBeCloseTo(e.est, 1);
    }
    // The Johnson–Neyman machinery needs the interaction's index into the covariance matrix.
    expect(r.estimates.find((x) => x.rhs === 'X × Z')!.index).toBeTypeOf('number');
    expect(r.vcov!.length).toBeGreaterThan(10);
  }, 900_000);
});

it('exports the modsem script', async () => {
  const script = await cbScriptLavaan(data, spec, 'casewise', 'ML', 'lms');
  expect(script).toContain('Y ~ X + Z + X:Z');
  expect(script).toContain('fit <- modsem(model, data = data, method = "lms")');
}, 900_000);

describe.each(['lms', 'qml'] as const)('%s Johnson–Neyman', (method) => {
  it('has the parameter covariances the Johnson–Neyman plot needs', async () => {
    const r = await estimateCbLavaan(data, spec, 'casewise', 'ML', method);
    const jn = johnsonNeyman(r, r.moderations[0]);
    expect(jn.bint).toBeCloseTo(r.estimates.find((e) => e.op === '~' && e.rhs === 'X × Z')!.est, 12);
    expect(jn.se(0)).toBeGreaterThan(0);
  }, 900_000);
});
