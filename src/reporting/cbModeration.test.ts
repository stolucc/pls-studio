// The CB-SEM checklist grades the model's factors, not the latent interaction the estimation
// generates from product indicators (it is among the results' constructs, not the model's).

import { describe, expect, it } from 'vitest';
import { reviewerChecklist } from './checklist';
import { cbInput, cbResult } from './fixtures';

const base = cbResult();
const products = ['x1.y1', 'x2.y2', 'x3.y3'];
const cb = cbResult({
  constructs: [...base.constructs, 'Anxiety:Depression'],
  indicators: [...base.indicators, ...products.map((name) => ({ name, construct: 2 }))],
  stdLoadings: [...base.stdLoadings, 0.3, 0.35, 0.2],
  reliability: [...base.reliability, { cr: 0.3, ave: 0.1 }],
  htmt: [
    [null, null, null],
    [0.62, null, null],
    [0.95, 0.9, null],
  ],
  moderations: [{ from: 'Anxiety', moderator: 'Depression', to: 'Depression', construct: 2 }],
});

describe('CB-SEM checklist with a latent interaction', () => {
  const items = reviewerChecklist(cbInput({ cb }));
  const item = (id: string) => items.find((x) => x.id === id)!;

  it('leaves the generated interaction factor out of the measurement checks', () => {
    expect(item('loadings').evidence).not.toMatch(/x1\.y1|x2\.y2|x3\.y3/);
    expect(item('reliability').evidence).not.toContain('Anxiety:Depression');
    expect(item('htmt').evidence).not.toContain('Anxiety:Depression');
  });

  it('grades the model’s factors as before', () => {
    const plain = reviewerChecklist(cbInput());
    for (const id of ['loadings', 'reliability', 'htmt'])
      expect(item(id).evidence).toBe(plain.find((x) => x.id === id)!.evidence);
  });
});
