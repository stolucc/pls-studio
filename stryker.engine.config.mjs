// Mutation testing of the numeric engines (npm run test:mutation:engine): slow,
// because instrumentation lands in the hot loops; meant to run overnight.
// STRYKER_SLOW raises the vitest timeout (see vite.config.ts).
import base from './stryker.config.mjs';

process.env.STRYKER_SLOW = '1';

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  ...base,
  mutate: [
    'src/engine/**/*.ts',
    '!src/engine/**/*.test.ts',
    '!src/engine/validationHarness.ts',
    '!src/engine/types.ts',
    '!src/engine/jn.ts', '!src/engine/stats.ts', '!src/engine/dataset.ts', '!src/engine/vech.ts', '!src/engine/mcci.ts',
  ],
  htmlReporter: { fileName: 'reports/mutation-engine/index.html' },
  jsonReporter: { fileName: 'reports/mutation-engine/mutation.json' },
  incrementalFile: 'reports/mutation-engine/stryker-incremental.json',
  timeoutMS: 600_000,
  dryRunTimeoutMinutes: 240,
};
