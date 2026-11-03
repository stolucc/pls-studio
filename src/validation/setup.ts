// vitest setup (every test file). With PS_VALIDATION_DIR set (npm run validate:evidence): every toBeCloseTo is
// recorded, under the example a test declared (record.ts) or else as a comparison of the test's feature check
// (features.ts), and the file's evidence is written when it ends. Without it, nothing changes.

import { afterAll, afterEach, expect } from 'vitest';
import { checks, current, fileName, flush } from './collector';
import { recordComparison } from './record';
import { FEATURES } from './features';

if (process.env.PS_VALIDATION_DIR) {
  afterAll(flush);
  afterEach((ctx) => {
    current.example = null; current.source = null;
    // A validation test with no toBeCloseTo (counts, orderings, recovered structure) still leaves its check: whether it passed.
    const feature = FEATURES[fileName()];
    if (!feature || typeof feature === 'string') return;
    const test = expect.getState().currentTestName ?? ctx.task.name;
    const key = `feature:${fileName()}::${test}`;
    const failed = !!ctx.task.result?.errors?.length;
    const check = checks.get(key);
    if (check) { if (failed) check.passed = false; return; }
    checks.set(key, { id: `${fileName()}::${test}`, subject: 'feature', title: `${feature.title}: ${test}`, method: feature.method, level: feature.level,
      sources: feature.sources, comparisons: [], packages: feature.packages, passed: !failed, test: `${fileName()}: ${test}` });
  });
  expect.extend({
    // Exactly as vitest's own: |expected − received| < ½·10^−digits, equal infinities pass; like vitest's, it
    // coerces (a number that arrives from R as a string compares by its value).
    toBeCloseTo(received: number, expected: number, digits = 2) {
      const pass = (received === Infinity && expected === Infinity) || (received === -Infinity && expected === -Infinity)
        || Math.abs(Number(expected) - Number(received)) < 10 ** -digits / 2;
      const isNot = (this as { isNot?: boolean }).isNot;
      const feature = FEATURES[fileName()];
      const label = (this as { assertion?: { __flags?: { message?: string } } }).assertion?.__flags?.message;
      if (!isNot && current.example) recordComparison(label ?? `value ${current.example.comparisons.length + 1}`, Number(received), Number(expected), 10 ** -digits / 2, pass);
      else if (!isNot && feature && feature !== 'examples' && feature !== 'none') {
        const test = expect.getState().currentTestName ?? '';
        const key = `feature:${fileName()}::${test}`;
        const check = checks.get(key) ?? { id: `${fileName()}::${test}`, subject: 'feature' as const, title: `${feature.title}: ${test}`, method: feature.method, level: feature.level,
          sources: feature.sources, comparisons: [], packages: feature.packages, passed: true, test: `${fileName()}: ${test}` };
        checks.set(key, check);
        check.comparisons.push({ quantity: label ?? `value ${check.comparisons.length + 1}`, value: Number(received), reference: Number(expected), tolerance: 10 ** -digits / 2 });
        if (!pass) check.passed = false;
      }
      return { pass, message: () => `expected ${received} to${isNot ? ' not' : ''} be close to ${expected} (${digits} digits)` };
    },
  });
}
