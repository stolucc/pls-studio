// Bootstrapping latent-interaction models estimated by LMS / QML. modsem has no
// bootstrap of its own: cases are resampled and the model refitted. The draws
// are checked against the same resampling written directly with modsem in the
// same session (same seed: same samples, so equal statistics).
// Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { slowIt } from './webrSlow';
import { parseCsv } from '../engine/dataset';
import type { ModelSpec } from '../engine/types';
import commonR from './R/common.R?raw';
import { analysisScript, bootstrapR } from './analyses';
import { callJson, withR } from './runtime';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const DIR = join(__dirname, '..', 'engine', '__fixtures__', 'modsem');
const data = parseCsv(readFileSync(join(DIR, 'oneInt.csv'), 'utf8')).dataset;
const f = (name: string, p: string) => ({
  name,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: [1, 2, 3].map((i) => `${p}${i}`),
});
const spec: ModelSpec = {
  constructs: [f('X', 'x'), f('Z', 'z'), f('Y', 'y')],
  paths: [
    { from: 'X', to: 'Y' },
    { from: 'Z', to: 'Y' },
  ],
  moderations: [{ from: 'X', moderator: 'Z', to: 'Y' }],
};

describe.each([
  ['qml', 8],
  ['lms', 4],
] as const)('%s', (method, samples) => {
  // (slow: minutes in webR; run with WEBR_SLOW, as npm run validate:evidence does)
  slowIt(
    'resamples cases and refits, as plain modsem code does',
    async () => {
      const boot = { samples, seed: 11, confidence: 0.95 };
      const r = await bootstrapR(
        data,
        spec,
        { kind: 'cbBoot', estimator: 'ML', missing: 'casewise', boot, interaction: method },
        () => '',
      );
      expect(r.engine.package).toBe('modsem');
      const ref = (await withR(['jsonlite', 'modsem'], { common: commonR }, (webR) =>
        callJson(
          webR,
          `
      suppressPackageStartupMessages(library(modsem)); d <- read.csv(text = ${JSON.stringify(readFileSync(join(DIR, 'oneInt.csv'), 'utf8'))})
      m <- "X =~ x1 + x2 + x3\\nZ =~ z1 + z2 + z3\\nY =~ y1 + y2 + y3\\nY ~ X + Z + X:Z"
      g <- function(f) { s <- standardized_estimates(f); s$est[s$op == "~" & s$lhs == "Y" & s$rhs == "X:Z"] }
      o <- g(modsem(m, d, method = "${method}"))
      set.seed(11)
      dr <- suppressWarnings(vapply(1:${samples}, function(i) g(modsem(m, d[sample.int(nrow(d), replace = TRUE), ], method = "${method}")), 0))
      ps_json(list(original = o, sd = sd(dr), mean = mean(dr)))`,
          null,
        ),
      )) as { original: number; sd: number; mean: number };
      const st = r.stats.find((x) => x.key === 'path:X × Z:Y')!;
      expect(st, 'interaction path').toBeDefined();
      expect(st.original).toBeCloseTo(ref.original, 8);
      expect(st.mean).toBeCloseTo(ref.mean, 6);
      expect(st.sd).toBeCloseTo(ref.sd, 6);
      for (const k of ['path:X:Y', 'path:Z:Y', 'loading:x2', 'r2:Y'])
        expect(
          r.stats.find((x) => x.key === k),
          k,
        ).toBeDefined();
    },
    1_800_000,
  );
});

it('the exported script refits modsem on resampled cases', async () => {
  const text = await analysisScript(data, spec, {
    kind: 'cbBoot',
    estimator: 'ML',
    missing: 'casewise',
    boot: { samples: 100, seed: 1, confidence: 0.95 },
    interaction: 'lms',
  });
  expect(text).toContain('library(modsem)');
  expect(text).toContain('refit <- function(d) modsem(model, data = d, method = "lms")');
  expect(text).toContain('sample.int(nrow(data), replace = TRUE)');
}, 600_000);
