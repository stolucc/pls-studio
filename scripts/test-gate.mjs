// The local gate before a commit (npm run test:gate): CI does not run (README, "Validation"), and plain `npm test`
// leaves out every *.webr.test.ts, so it checks nothing of the R bridge. In order, stopping at the first failure:
//   1. type check (tsc -b), 2. lint (eslint), 3. formatting (prettier --check),
//   4. the unit tests (vitest run: no R),
//   5. the bridge's most important webR tests with R in desktop R (WEBR_TESTS=1 PS_NATIVE_R=1: the helper's R workers
//      and library, src/rengine/nativeR.ts), under a minute: request validation and code injection, quoting,
//      the shared R helpers, lavaan, cSEM and seminr (reference fixtures and published results), and the core CB-SEM
//      and PLS analyses.
// The desktop-R step needs R and the helper's library (pls-studio-helper setup, or PS_HELPER_LIBRARY). The server
// tests need PostgreSQL: npm run test:server.
//   npm run test:gate                 (all five steps)
//   npm run test:gate -- --r-only     (step 5 alone)

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The bridge tests run in desktop R (measured 2026-11-14: about 20 s in all, files in parallel). */
export const GATE_R_TESTS = [
  // the request's validation, code injection through names and options, R string quoting
  'src/rengine/injection.webr.test.ts',
  'src/rengine/quoting.webr.test.ts',
  'src/rengine/common.webr.test.ts',
  // lavaan: the bridge's fit, measures and fixtures; CB-SEM diagnostics, fixed values, multigroup, invariance
  'src/rengine/lavaan.webr.test.ts',
  'src/rengine/cbDiag.webr.test.ts',
  'src/rengine/fixedValues.webr.test.ts',
  'src/rengine/multigroup.webr.test.ts',
  'src/rengine/invariance.webr.test.ts',
  'src/rengine/esem.webr.test.ts',
  'src/rengine/efa.webr.test.ts',
  // cSEM and seminr: the reference cases, the published results (Hair et al., Monecke & Leisch), higher-order constructs
  'src/rengine/pls.webr.test.ts',
  'src/rengine/published.webr.test.ts',
  'src/rengine/hoc.webr.test.ts',
  // effects, regression, tests and robust estimation: the analysis cards most projects use
  'src/rengine/effects.webr.test.ts',
  'src/rengine/regression.webr.test.ts',
  'src/rengine/tests.webr.test.ts',
  'src/rengine/robust.webr.test.ts',
  'src/rengine/analyses.webr.test.ts',
];

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const STEPS = [
  { name: 'type check', args: ['tsc', '-b'] },
  { name: 'lint', args: ['eslint', '.'] },
  {
    name: 'formatting',
    args: [
      'prettier',
      '--check',
      'src/**/*.{ts,tsx}',
      'scripts/**/*.{mjs,js,ts}',
      'server/src/**/*.ts',
      'server/tests/**/*.ts',
      'vite.config.ts',
      'eslint.config.js',
      'server/vitest.config.ts',
    ],
  },
  { name: 'unit tests', args: ['vitest', 'run'] },
  {
    name: 'bridge tests in desktop R',
    args: ['vitest', 'run', ...GATE_R_TESTS],
    env: { WEBR_TESTS: '1', PS_NATIVE_R: '1' },
  },
];

function main() {
  const rOnly = process.argv.includes('--r-only');
  const started = Date.now();
  for (const step of rOnly ? STEPS.slice(-1) : STEPS) {
    const t0 = Date.now();
    console.log(`\n▶ ${step.name}`);
    const run = spawnSync(npx, step.args, {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...step.env },
    });
    const seconds = Math.round((Date.now() - t0) / 1000);
    if (run.status !== 0) {
      console.error(`\n✗ test:gate: ${step.name} failed (${seconds} s)`);
      process.exit(run.status ?? 1);
    }
    console.log(`✓ ${step.name} (${seconds} s)`);
  }
  console.log(`\n✓ test:gate passed in ${Math.round((Date.now() - started) / 1000)} s`);
}

// (run as a script; src/validation/gate.test.ts imports the list)
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
