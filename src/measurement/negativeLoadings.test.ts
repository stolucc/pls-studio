// The negative-loading detection (a forgotten reverse-coding), its reviewer-checklist item, and
// the dismissed notes in the project file.

import { describe, expect, it } from 'vitest';
import type { CbEstimate } from '../engine/cbsem';
import {
  DEFAULT_SETTINGS,
  parseProject,
  serializeProject,
  type ModelState,
} from '../model/project';
import { reviewerChecklist } from '../reporting/checklist';
import { cbInput, cbResult, plsInput, plsModel, plsResult } from '../reporting/fixtures';
import {
  cbNegativeLoadingFlags,
  cbNegativeWeights,
  flagText,
  negativeLoadingFlags,
  plsNegativeLoadingFlags,
  plsNegativeWeights,
  signed,
  type SignedLoading,
} from './negativeLoadings';
import { parseMeasurement, withNotReversed } from './state';

const none = { reversed: new Set<string>(), dismissed: new Set<string>() };
const L = (construct: string, indicator: string, loading: number): SignedLoading => ({
  construct,
  indicator,
  loading,
});

describe('negativeLoadingFlags', () => {
  it('flags the negative item of a construct whose other items load positively', () => {
    const flags = negativeLoadingFlags(
      [L('Sat', 'x1', 0.8), L('Sat', 'x2', 0.75), L('Sat', 'x3', -0.62), L('Img', 'y1', 0.7)],
      none,
    );
    expect(flags).toEqual([
      { kind: 'negative', construct: 'Sat', items: [{ indicator: 'x3', loading: -0.62 }] },
    ]);
    expect(flagText(flags[0])).toBe(
      'x3 loads negatively on Sat (−0.62). Is it a negatively worded (reverse-coded) item?',
    );
  });

  it('a tie flags the negative items; a negative majority flags the positive one', () => {
    const tie = negativeLoadingFlags([L('A', 'a1', 0.7), L('A', 'a2', -0.7)], none);
    expect(tie.map((f) => [f.kind, f.items[0].indicator])).toEqual([['negative', 'a2']]);
    const flipped = negativeLoadingFlags(
      [L('A', 'a1', 0.71), L('A', 'a2', -0.8), L('A', 'a3', -0.77)],
      none,
    );
    expect(flipped.map((f) => [f.kind, f.items[0].indicator])).toEqual([['positive', 'a1']]);
    expect(flagText(flipped[0])).toContain('a1 loads positively on A (0.71)');
    expect(flagText(flipped[0])).toContain('Is a1 a negatively worded (reverse-coded) item?');
  });

  it('an all-negative construct is one note about all its items', () => {
    const flags = negativeLoadingFlags([L('A', 'a1', -0.7), L('A', 'a2', -0.65)], none);
    expect(flags).toHaveLength(1);
    expect(flags[0].kind).toBe('all-negative');
    expect(flags[0].items.map((x) => x.indicator)).toEqual(['a1', 'a2']);
    expect(flagText(flags[0])).toContain(
      'Every indicator of A loads negatively (a1 −0.70, a2 −0.65)',
    );
  });

  it('skips reversed and dismissed items, single indicators and missing loadings', () => {
    const loadings = [
      L('A', 'a1', 0.8),
      L('A', 'a2', -0.5),
      L('A', 'a3', -0.4),
      L('A', 'a4', 0.7),
      L('A', 'a5', 0.6),
      L('B', 'b1', -0.9),
      L('C', 'c1', 0.7),
      L('C', 'c2', Number.NaN),
    ];
    const skip = { reversed: new Set(['a2']), dismissed: new Set(['a3']) };
    expect(negativeLoadingFlags(loadings, skip)).toEqual([]);
    // (the skipped items still count for the majority: a3 alone is still the odd one out)
    const one = negativeLoadingFlags(loadings, { ...none, reversed: new Set(['a2']) });
    expect(one.map((f) => f.items[0].indicator)).toEqual(['a3']);
  });

  it('writes a true minus sign', () => {
    expect(signed(-0.615)).toBe('−0.61');
    expect(signed(0.5)).toBe('0.50');
  });
});

describe('PLS-SEM and CB-SEM results', () => {
  // Image (Mode A factor): im1..im3; Satisfaction (Mode B composite): sa1..sa4; Loyalty: lo1, lo2.
  const loadings = [0.82, -0.6, 0.7, -0.4, 0.8, 0.75, 0.6, 0.9, 0.88];

  it('PLS: flags reflective items only, not Mode B indicators', () => {
    const pls = plsResult({ loadings });
    const flags = plsNegativeLoadingFlags(plsModel, null, pls);
    expect(flags.map((f) => f.items[0].indicator)).toEqual(['im2']);
    // sa1's negative loading is in a Mode B block: not flagged.
    expect(flags.some((f) => f.construct === 'Satisfaction')).toBe(false);
  });

  it('PLS: a Mode B weight that is negative is named for the one-line explanation', () => {
    const weights = [0.4, 0.4, 0.4, -0.2, 0.5, 0.4, 0.3, 0.6, 0.5];
    expect(plsNegativeWeights(plsModel, plsResult({ weights }))).toEqual(['sa1']);
    expect(plsNegativeWeights(plsModel, plsResult())).toEqual([]);
  });

  it('PLS: an item reversed in the app, or dismissed in the project, is not flagged', () => {
    const pls = plsResult({ loadings });
    const info = {
      fileName: 'd.csv',
      rows: 10,
      missingCells: 0,
      excluded: [],
      reversed: [{ name: 'im2', min: 1, max: 5 }],
    };
    expect(plsNegativeLoadingFlags(plsModel, info, pls)).toEqual([]);
    const dismissed = { ...plsModel, measurement: { notReversed: ['im2'] } };
    expect(plsNegativeLoadingFlags(dismissed, null, pls)).toEqual([]);
  });

  it('CB-SEM: reads the standardised loading, and leaves composites (<~) out', () => {
    const base = cbResult();
    const estimates: CbEstimate[] = base.estimates.map((e) =>
      // (unstandardised positive, standardised negative: only the standardised sign counts)
      e.rhs === 'x2' && e.op === '=~' ? { ...e, est: 0.9, std: -0.74 } : e,
    );
    const cb = cbResult({ estimates });
    const model = cbInput().model;
    const flags = cbNegativeLoadingFlags(model, null, cb);
    expect(flags.map((f) => [f.construct, f.items[0].indicator, f.items[0].loading])).toEqual([
      ['Anxiety', 'x2', -0.74],
    ]);
    const unstd = cbResult({
      estimates: base.estimates.map((e) => (e.rhs === 'x2' ? { ...e, est: -0.9 } : e)),
    });
    expect(cbNegativeLoadingFlags(model, null, unstd)).toEqual([]);
    const weight: CbEstimate = { ...base.estimates[0], op: '<~', lhs: 'C', rhs: 'x9', std: -0.3 };
    const withComposite = cbResult({ estimates: [...base.estimates, weight] });
    expect(cbNegativeLoadingFlags(model, null, withComposite)).toEqual([]);
    expect(cbNegativeWeights(withComposite)).toEqual(['x9']);
  });
});

describe('reviewer checklist', () => {
  it('adds an issue for a negative loading, and no item without one', () => {
    const plain = reviewerChecklist(plsInput());
    expect(plain.some((i) => i.id === 'negativeloadings')).toBe(false);
    const items = reviewerChecklist(
      plsInput({
        pls: { ...plsResult(), loadings: [0.82, -0.6, 0.7, 0.4, 0.8, 0.75, 0.6, 0.9, 0.88] },
      }),
    );
    const item = items.find((i) => i.id === 'negativeloadings')!;
    expect(item.status).toBe('issue');
    expect(item.evidence).toContain('im2 loads negatively on Image (−0.60)');
    expect(item.link).toEqual({ kind: 'tab', label: 'Loadings & weights' });
    // Dismissed in the project: no item.
    const model = { ...plsModel, measurement: { notReversed: ['im2'] } };
    const dismissed = reviewerChecklist(
      plsInput({
        model,
        pls: { ...plsResult(), loadings: [0.82, -0.6, 0.7, 0.4, 0.8, 0.75, 0.6, 0.9, 0.88] },
      }),
    );
    expect(dismissed.some((i) => i.id === 'negativeloadings')).toBe(false);
  });

  it('CB-SEM: links to the Loadings tab', () => {
    const base = cbResult();
    const cb = cbResult({
      estimates: base.estimates.map((e) => (e.rhs === 'x3' ? { ...e, std: -0.42 } : e)),
    });
    const items = reviewerChecklist(cbInput({ cb: { ...cb, engine: base.engine } }));
    const item = items.find((i) => i.id === 'negativeloadings')!;
    expect(item.evidence).toContain('x3 loads negatively on Anxiety (−0.42)');
    expect(item.link).toEqual({ kind: 'tab', label: 'Loadings' });
  });
});

describe('the dismissed notes in the project', () => {
  const model: ModelState = { ...plsModel, measurement: { notReversed: ['im2', 'lo1'] } };

  it('survive a round trip', () => {
    const back = parseProject(serializeProject(model, DEFAULT_SETTINGS, null, null)).model;
    expect(back.measurement).toEqual({ notReversed: ['im2', 'lo1'] });
  });

  it('drop names that are no longer indicators, and duplicates', () => {
    const file = JSON.parse(serializeProject(model, DEFAULT_SETTINGS, null, null));
    file.model.measurement.notReversed = ['im2', 'gone', 'im2'];
    expect(parseProject(JSON.stringify(file)).model.measurement).toEqual({ notReversed: ['im2'] });
  });

  it('reject anything but a list of names', () => {
    const bad: unknown[] = ['im2', [1], [''], [{ name: 'im2' }], ['x'.repeat(201)]];
    for (const value of bad) {
      const file = JSON.parse(serializeProject(model, DEFAULT_SETTINGS, null, null));
      file.model.measurement.notReversed = value;
      expect(() => parseProject(JSON.stringify(file)), JSON.stringify(value)).toThrow(
        /measurement\.notReversed/,
      );
    }
    const many = Array.from({ length: 5001 }, (_, i) => `x${i}`);
    expect(() => parseMeasurement({ notReversed: many }, new Set())).toThrow(/notReversed/);
  });

  it('withNotReversed adds a name once', () => {
    const once = withNotReversed(undefined, 'x3');
    expect(once).toEqual({ notReversed: ['x3'] });
    expect(withNotReversed(once, 'x3')).toEqual({ notReversed: ['x3'] });
    expect(withNotReversed({ similarPairs: [['a', 'b']] }, 'x1')).toEqual({
      similarPairs: [['a', 'b']],
      notReversed: ['x1'],
    });
  });
});
