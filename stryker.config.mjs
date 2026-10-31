// Mutation testing (npm run test:mutation): Stryker changes the code under
// test (flips operators, drops statements, alters constants) and checks that
// some test fails for each change. Surviving mutants mark untested behaviour.
// Scope: the pure logic (engines, model, figure, formatting); UI components
// and the webR bridges (needing R) are covered by other means; the R-free
// parts of the R layer (parallel planning, the desktop helper client) are in.
// The dry run executes every test under instrumentation with several runners sharing the
// CPU: the slow statistical tests need the long vitest timeout (see vite.config.ts).
process.env.STRYKER_SLOW = '1';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vite.config.ts' },
  checkers: [],
  coverageAnalysis: 'perTest',
  // The logic modules; the numeric engines (hot loops, slow under instrumentation)
  // have their own configuration: stryker.engine.config.mjs (npm run test:mutation:engine).
  mutate: [
    'src/model/**/*.ts',
    'src/figure/**/*.ts',
    'src/geometry.ts',
    'src/latex.ts',
    'src/format.ts',
    'src/diagramLabels.ts',
    'src/methodSwitch.ts',
    'src/components/canvasMenu.ts',
    'src/engine/jn.ts',
    'src/engine/stats.ts',
    'src/engine/dataset.ts',
    'src/engine/vech.ts',
    'src/engine/mcci.ts',
    // Desktop helper client and parallel planning (fetch is mocked in the tests).
    'src/rengine/compute.ts',
    'src/rengine/helper.ts',
    'src/data/recode.ts',
    'src/data/summary.ts',
    // The analysis log (cards, versions, persistence, packing), examples' topics, link parsing, notices.
    'src/analyses/store.ts',
    'src/analyses/persist.ts',
    'src/analyses/codec.ts',
    'src/analyses/runHash.ts',
    'src/analyses/calculate.ts',
    'src/analyses/common.tsx',
    'src/examples/tags.ts',
    'src/cloud/invites.ts',
    'src/rengine/notices.ts',
    'src/sample.ts',
    'src/recent.ts',
    'src/cancellable.ts',
    'src/canvasFit.ts',
    '!src/**/*.test.ts',
    '!src/figure/export.ts',
  ],
  reporters: ['html', 'clear-text', 'progress', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  incremental: true,
  incrementalFile: 'reports/mutation/stryker-incremental.json',
  concurrency: 6,
  timeoutMS: 20000,
  // The instrumented initial run (statistical tests included) takes minutes.
  dryRunTimeoutMinutes: 15,
  thresholds: { high: 80, low: 60, break: null },
  tempDirName: '.stryker-tmp',
};
