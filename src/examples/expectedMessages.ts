// Warnings and notes an example is expected to raise (PackageExample.expectedMessages): the test suite allows
// exactly these when it runs the example, and the Messages panel marks them as expected in the example instead
// of as problems. Pure functions over the example's definition, shared by both.

import type { ExpectedMessage } from './packages';

/** The level a message of the store or the R bridge has, as an expected message names it. */
export type MessageLevel = 'warning' | 'info' | 'error' | 'note';

const sameLevel = (want: ExpectedMessage['level'], have: MessageLevel | undefined) =>
  !want || !have || (want === 'note' ? have === 'info' || have === 'note' : have === 'warning');

/** The reason a message is expected in the example (the first matching pattern's `why`), or null when it is not. */
export function expectedWhy(expected: ExpectedMessage[] | undefined, text: string, level?: MessageLevel): string | null {
  for (const e of expected ?? []) {
    if (!sameLevel(e.level, level)) continue;
    try { if (new RegExp(e.pattern).test(text)) return e.why; } catch { /* a malformed pattern matches nothing (packages.test.ts rejects it) */ }
  }
  return null;
}

/** The warnings and notes a run raised that the example does not expect (the test suite requires both lists empty). */
export function unexpectedMessages(expected: ExpectedMessage[] | undefined, raised: { warnings: string[]; notes: string[] }): { warnings: string[]; notes: string[] } {
  return {
    warnings: raised.warnings.filter((w) => expectedWhy(expected, w, 'warning') === null),
    notes: [...new Set(raised.notes)].filter((n) => expectedWhy(expected, n, 'note') === null),
  };
}
