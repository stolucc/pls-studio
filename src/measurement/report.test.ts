// The deleted-items log in the methods text and the reviewer checklist, and pairs marked as
// conceptually similar held to HTMT 0.90 in the checklist.

import { describe, expect, it } from 'vitest';
import { reviewerChecklist } from '../reporting/checklist';
import { plsInput, plsModel } from '../reporting/fixtures';
import { methodsText } from '../reporting/methods';
import { deletedItemsCheck, htmtCutOf, itemsDeletedLine } from './report';
import type { DeletedItem } from './state';
import { plsResult } from '../reporting/fixtures';

const item: DeletedItem = {
  indicator: 'im4',
  construct: 'Image',
  loading: 0.581,
  reason: 'Loading 0.58, between 0.40 and 0.70; removal raised AVE to 0.58 and ρC to 0.81.',
  note: 'The other items cover the definition.',
  before: { ave: 0.47, rhoA: 0.72, rhoC: 0.78 },
  after: { ave: 0.58, rhoA: 0.74, rhoC: 0.81 },
};
const withLog = { ...plsModel, measurement: { deletedItems: [item] } };

describe('Items deleted', () => {
  it('lists each item with its construct, loading and the change it made', () => {
    expect(itemsDeletedLine(withLog)).toBe(
      'Items deleted: im4 (Image; loading 0.58; AVE 0.47 → 0.58, ρC 0.78 → 0.81).',
    );
    expect(itemsDeletedLine(plsModel)).toBeNull();
    const noAfter = { ...plsModel, measurement: { deletedItems: [{ ...item, after: undefined }] } };
    expect(itemsDeletedLine(noAfter)).toBe('Items deleted: im4 (Image; loading 0.58).');
  });

  it('goes into the methods text with the rule and its sources', () => {
    const t = methodsText(plsInput({ model: withLog }));
    expect(t.text).toContain('Items deleted: im4 (Image; loading 0.58;');
    expect(t.text).toContain('Indicators with loadings below 0.40 were candidates for deletion');
    expect(t.text).toContain('(Hair et al., 2017; Hair et al., 2021)');
    expect(t.keys).toEqual(expect.arrayContaining(['hair2017', 'hair2021']));
    expect(t.bibtex).toContain('@book{hair2017');
    expect(methodsText(plsInput()).text).not.toContain('Items deleted');
  });

  it('goes into the reviewer checklist for the author to justify', () => {
    const items = reviewerChecklist(plsInput({ model: withLog }));
    const d = items.find((x) => x.id === 'deleteditems');
    expect(d).toMatchObject({ status: 'author', section: 'Measurement model' });
    expect(d!.evidence).toContain('Items deleted: im4');
    expect(d!.evidence).toContain('Notes: im4: The other items cover the definition.');
    expect(reviewerChecklist(plsInput()).some((x) => x.id === 'deleteditems')).toBe(false);
    expect(deletedItemsCheck(plsModel)).toBeNull();
  });
});

describe('pairs marked conceptually similar', () => {
  it('are held to 0.90 instead of 0.85 in the checklist', () => {
    // Loyalty–Image HTMT 0.92: fails at either threshold; at 0.87 it passes only when marked similar.
    const pls = plsResult({
      htmt: [
        [null, null, null],
        [0.6, null, null],
        [0.87, 0.7, null],
      ],
    });
    const plain = reviewerChecklist(plsInput({ pls }));
    expect(plain.find((x) => x.id === 'htmt')!.status).toBe('issue');
    expect(plain.find((x) => x.id === 'htmt')!.evidence).toBe(
      'At or above .85: Loyalty–Image (0.87).',
    );
    const marked = {
      ...plsModel,
      measurement: { similarPairs: [['i', 'l']] as [string, string][] },
    };
    const similar = reviewerChecklist(plsInput({ model: marked, pls }));
    expect(similar.find((x) => x.id === 'htmt')!.status).toBe('done');
    const cut = htmtCutOf(marked, pls);
    expect(cut(2, 0)).toBe(0.9);
    expect(cut(1, 0)).toBe(0.85);
    // 0.92 still fails when marked similar
    const high = reviewerChecklist(plsInput({ model: marked }));
    expect(high.find((x) => x.id === 'htmt')!.evidence).toContain(
      'At or above the threshold (.90 for pairs marked similar): Loyalty–Image (0.92).',
    );
  });
});
