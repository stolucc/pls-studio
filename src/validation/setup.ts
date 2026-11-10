// vitest setup (every test file). With PS_VALIDATION_DIR set (npm run validate:evidence): every toBeCloseTo is
// recorded, under the example a test declared (record.ts) or else as a comparison of the test's feature check
// (features.ts), and the file's evidence is written when it ends. Without it, nothing changes.

import { afterAll, afterEach, expect } from 'vitest';
import { current, flush, runtime } from './collector';
import { featureCheck, recordComparison } from './record';

if (process.env.PS_VALIDATION_DIR) {
  afterAll(flush);
  afterEach((ctx) => {
    current.example = null; current.source = null;
    // A webR validation test with no recorded comparison (counts, orderings, recovered structure) still leaves its check: whether
    // it passed. The plain test files recorded without R (runtime 'fixture') also test behaviour: there only tests that compared
    // numbers leave a check, or a failure.
    const failed = !!ctx.task.result?.errors?.length;
    const check = featureCheck(expect.getState().currentTestName ?? ctx.task.name, runtime() !== 'fixture' || failed);
    if (check && failed) check.passed = false;
  });
  expect.extend({
    // Exactly as vitest's own: |expected − received| < ½·10^−digits, equal infinities pass; like vitest's, it
    // coerces (a number that arrives from R as a string compares by its value).
    toBeCloseTo(received: number, expected: number, digits = 2) {
      const pass = (received === Infinity && expected === Infinity) || (received === -Infinity && expected === -Infinity)
        || Math.abs(Number(expected) - Number(received)) < 10 ** -digits / 2;
      const isNot = (this as { isNot?: boolean }).isNot;
      const label = (this as { assertion?: { __flags?: { message?: string } } }).assertion?.__flags?.message;
      if (!isNot) recordComparison(label ?? `value ${((current.example ?? featureCheck())?.comparisons.length ?? 0) + 1}`, Number(received), Number(expected), 10 ** -digits / 2, pass);
      return { pass, message: () => `expected ${received} to${isNot ? ' not' : ''} be close to ${expected} (${digits} digits)` };
    },
  });
}
