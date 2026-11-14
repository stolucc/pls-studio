// One rule per threshold, wherever it is applied: the checklist, the loading triage, the HTMT
// helper and the result tables agree on the boundary values.

import { describe, expect, it } from 'vitest';
import { htmtCls } from '../components/results/Table';
import { htmtVerdict } from '../measurement/htmt';
import { loadingBand } from '../measurement/loadings';
import { reviewerChecklist } from './checklist';
import { plsInput, plsModel, plsResult } from './fixtures';
import { methodsText } from './methods';
import type { PlsResult } from '../engine/types';
import { HTMT_DISTINCT, LOADING_MIN, rhoADefined } from './thresholds';

const quality = (rhoA: number, rhoC = 0.85) => ({ alpha: 0.8, rhoC, rhoA, ave: 0.6 });

describe('shared thresholds', () => {
  it('flags a ρA above .95, as the label says', () => {
    const pls = plsResult({ quality: [quality(0.97), quality(0.8), quality(0.8)] });
    const item = reviewerChecklist(plsInput({ pls })).find((x) => x.id === 'reliability')!;
    expect(item.label).toBe('Internal consistency: ρA and ρC between .70 and .95');
    expect(item.status).toBe('issue');
    expect(item.evidence).toContain('Outside .70–.95: Image (above .95: redundant items).');
  });

  it('holds a loading of 0.705 below the cut-off in the checklist and the triage alike', () => {
    expect(LOADING_MIN).toBe(0.708);
    expect(loadingBand(0.705)).toBe('consider');
    const pls = plsResult({ loadings: [0.82, 0.79, 0.705, 0.7, 0.8, 0.75, 0.6, 0.9, 0.88] });
    const item = reviewerChecklist(plsInput({ pls })).find((x) => x.id === 'indicatorreliability')!;
    expect(item.evidence).toContain('im3 (0.705)');
  });

  it('counts an HTMT at the threshold as failing in the table, the helper and the checklist', () => {
    expect(htmtCls(HTMT_DISTINCT)).toBe('warn');
    expect(htmtCls(0.9)).toBe('bad');
    expect(htmtCls(0.849)).toBe('');
    expect(htmtVerdict(HTMT_DISTINCT, null, HTMT_DISTINCT)).toBe('fails');
    const pls = plsResult({
      htmt: [
        [null, null, null],
        [0.6, null, null],
        [0.85, 0.7, null],
      ],
    });
    const item = reviewerChecklist(plsInput({ pls })).find((x) => x.id === 'htmt')!;
    expect(item.status).toBe('issue');
  });
});

describe('ρA of Mode A composites and of blocks without estimated Mode A weights', () => {
  // Image as a Mode A composite: ρA is computed from its Mode A weights (seminr; cSEM's 1 is
  // replaced by the bridge, the built-in engine computes it) and judged like ρC and the AVE.
  const asComposite = (over: object) => ({
    ...plsModel,
    constructs: plsModel.constructs.map((k) =>
      k.name === 'Image' ? { ...k, type: 'composite' as const, ...over } : k,
    ),
  });
  const types: PlsResult['types'] = ['composite', 'composite', 'factor'];

  it('is reported and judged for a Mode A composite', () => {
    const model = asComposite({});
    const pls = plsResult({ types, quality: [quality(0.82), quality(0.8), quality(0.8)] });
    const item = reviewerChecklist(plsInput({ model, pls })).find((x) => x.id === 'reliability')!;
    expect(item.evidence).toContain('Image: ρA 0.82, ρC 0.85');
    expect(item.status).toBe('done');

    const high = plsResult({ types, quality: [quality(0.97), quality(0.8), quality(0.8)] });
    const flagged = reviewerChecklist(plsInput({ model, pls: high })).find(
      (x) => x.id === 'reliability',
    )!;
    expect(flagged.status).toBe('issue');
    expect(flagged.evidence).toContain('Outside .70–.95: Image (above .95: redundant items).');
    expect(methodsText(plsInput({ model, pls })).text).toContain(
      'Cronbach’s α, ρA and ρC between 0.70 and 0.95',
    );
  });

  it('is n/a with predefined weights (the engines’ 1 is a convention), and not judged', () => {
    const model = asComposite({ predefinedWeights: { im1: 1, im2: 1, im3: 1 } });
    const pls = plsResult({ types, quality: [quality(1), quality(0.8), quality(0.8)] });
    const item = reviewerChecklist(plsInput({ model, pls })).find((x) => x.id === 'reliability')!;
    expect(item.evidence).toContain('Image: ρA n/a, ρC 0.85');
    expect(item.status).toBe('done');
    expect(methodsText(plsInput({ model, pls })).text).toContain(
      'Cronbach’s α, ρC and, for the constructs with estimated Mode A weights, ρA between 0.70 ' +
        'and 0.95',
    );
    expect(methodsText(plsInput()).text).toContain('Cronbach’s α, ρA and ρC between 0.70 and 0.95');
  });

  it('applies to estimated Mode A weights only', () => {
    const three = ['a', 'b', 'c'];
    expect(rhoADefined({ mode: 'A', indicators: three })).toBe(true);
    expect(rhoADefined({ mode: 'B', indicators: three })).toBe(false);
    expect(rhoADefined({ mode: 'unit', indicators: three })).toBe(false);
    expect(rhoADefined({ mode: 'A', indicators: ['a'] })).toBe(false);
    expect(rhoADefined({ mode: 'A', indicators: three, predefinedWeights: { a: 1 } })).toBe(false);
  });
});
