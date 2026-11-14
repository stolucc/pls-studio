// The post hoc modification log (model/posthoc.ts) in the methods text and the reviewer checklist.

import { describe, expect, it } from 'vitest';
import type { PostHocModification } from '../model/posthoc';
import { postHocEvidence } from './checklist';
import { postHocText } from './methods';

const freed: PostHocModification = {
  id: 'h1',
  kind: 'free',
  lhs: 'x7',
  op: '~~',
  rhs: 'x8',
  at: 1,
  mi: 34.145,
  sepc: 0.859,
  decision: 'M',
};
const removed = (p: number, id: string): PostHocModification => ({
  id,
  kind: 'remove',
  lhs: 'B',
  op: '~',
  rhs: 'A',
  at: 2,
  p,
});
const cite = (...keys: string[]) => `[${keys.join(',')}]`;

describe('post hoc modifications in the methods text', () => {
  it('lists them, with the decision rule for freed parameters and the caveat', () => {
    const t = postHocText([freed, removed(0.4, 'h2')], cite)!;
    expect(t).toBe(
      'After inspecting the results, the model was modified post hoc (freed the covariance x7 ↔ x8 (MI = 34.15, SEPC = 0.86); deleted the path A → B, p = .400). ' +
        'Freed parameters were chosen by their standardised expected parameter change and the decision rule of [saris2009]. ' +
        'Such data-driven changes capitalise on chance, so the final model’s fit is optimistic and needs confirmation in new data [maccallum1992].',
    );
  });
  it('says nothing without any', () => {
    expect(postHocText(undefined, cite)).toBeNull();
    expect(postHocText([], cite)).toBeNull();
    expect(postHocText([removed(0.4, 'a')], cite)).not.toContain('saris2009');
  });
});

describe('post hoc modifications in the checklist', () => {
  it('lists them, and flags a run of deleted non-significant paths', () => {
    expect(postHocEvidence(undefined)).toBe('');
    expect(postHocEvidence([freed])).toBe(
      'Logged post hoc modifications (1): Freed the covariance x7 ↔ x8 (MI = 34.15, SEPC = 0.86). ',
    );
    const e = postHocEvidence([freed, removed(0.4, 'a'), removed(0.6, 'b')]);
    expect(e).toMatch(/^Logged post hoc modifications \(3\)/);
    expect(e).toMatch(/The last 2 were deletions of non-significant paths/);
  });
});
