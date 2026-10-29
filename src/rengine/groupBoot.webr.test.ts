// Bootstrapping multiple-group and two-level CB-SEM models in webR. Groups:
// lavaan's bootstrapLavaan (within groups); the draws are checked against
// lavaan's own in the same session. Two levels: clusters resampled.
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { ModelSpec } from '../engine/types';
import commonR from './R/common.R?raw';
import { analysisScript, bootstrapR } from './analyses';
import { callJson, withR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const FX = join(__dirname, '..', 'engine', '__fixtures__');
const f = (name: string, indicators: string[]) => ({ name, type: 'factor' as const, mode: 'A' as const, indicators });
const boot = { samples: 50, seed: 7, confidence: 0.95 };

describe('multiple groups', () => {
  const data = parseCsv(readFileSync(join(FX, 'multigroup', 'hs_school.csv'), 'utf8')).dataset;
  const spec: ModelSpec = {
    constructs: [f('visual', ['x1', 'x2', 'x3']), f('textual', ['x4', 'x5', 'x6']), f('speed', ['x7', 'x8', 'x9'])],
    paths: [{ from: 'visual', to: 'speed' }, { from: 'textual', to: 'speed' }], multigroup: { column: 'school', invariance: 'metric', free: [] },
  };
  it('per group, with the same draws as lavaan’s bootstrapLavaan', async () => {
    const r = await bootstrapR(data, spec, { kind: 'cbBoot', estimator: 'ML', missing: 'casewise', boot }, () => '');
    expect(r.byBlock).toHaveLength(2);
    const ref = await withR(['jsonlite', 'lavaan'], { common: commonR }, (webR) => callJson(webR, `
      d <- lavaan::HolzingerSwineford1939; d$school <- as.integer(d$school == "Grant-White") + 1L
      m <- "visual =~ 1*x1 + x2 + x3\\ntextual =~ 1*x4 + x5 + x6\\nspeed =~ 1*x7 + x8 + x9\\nspeed ~ visual + textual"
      fit <- lavaan::sem(m, d, group = "school", group.equal = "loadings")
      g <- function(f) { s <- lavaan::standardizedSolution(f, se = FALSE); s$est.std[s$op == "~" & s$lhs == "speed" & s$rhs == "visual"] }
      dr <- lavaan::bootstrapLavaan(fit, R = 50, FUN = g, iseed = 7)
      ps_json(list(original = g(fit), sd = apply(dr, 2, sd)))`, null)) as { original: number[]; sd: number[] };
    for (const b of [0, 1]) {
      const st = r.byBlock![b].find((x) => x.key === 'path:visual:speed')!;
      expect(st.original).toBeCloseTo(ref.original[b], 8);
      expect(st.sd).toBeCloseTo(ref.sd[b], 8);
    }
  }, 900_000);
});

describe('two levels', () => {
  const data = parseCsv(readFileSync(join(FX, 'twolevel', 'demo_twolevel.csv'), 'utf8')).dataset;
  const cov = (name: string) => ({ ...f(name, [name]), covariate: true });
  const spec: ModelSpec = {
    constructs: [f('fac', ['y1', 'y2', 'y3']), cov('x1'), cov('x2')],
    paths: [{ from: 'x1', to: 'fac' }, { from: 'x2', to: 'fac' }], multilevel: { column: 'cluster', between: 'same' },
  };
  it('resamples clusters and reports both levels', async () => {
    const r = await bootstrapR(data, spec, { kind: 'cbBoot', estimator: 'ML', missing: 'casewise', boot: { ...boot, samples: 20 } }, () => '');
    expect(r.byBlock).toHaveLength(2);
    for (const b of [0, 1]) {
      const st = r.byBlock![b].find((x) => x.key === 'path:x1:fac')!;
      expect(Number.isFinite(st.original) && Number.isFinite(st.sd) && st.sd > 0).toBe(true);
    }
    const script = await analysisScript(data, spec, { kind: 'cbBoot', estimator: 'ML', missing: 'casewise', boot });
    expect(script).toContain('whole clusters are resampled');
  }, 900_000);
});
