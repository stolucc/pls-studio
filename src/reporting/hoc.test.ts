// The guided higher-order construct check (reporting/hoc.ts): type detection and
// which lines apply, with which status, for the four HOC types (Ringle, Sarstedt &
// Straub 2012) under the three approaches (Becker, Klein & Wetzels 2012;
// Sarstedt et al. 2019), on a hand-made result. The derived statistics are
// validated against cSEM and seminr in hocCheck.webr.test.ts.

import { describe, expect, it } from 'vitest';
import type { BootstrapResult, BootstrapStat, PlsResult } from '../engine/types';
import { DEFAULT_SETTINGS, type HocApproach } from '../model/project';
import { reviewerChecklist } from './checklist';
import {
  hocChecklistItems,
  hocChecks,
  hocHtmtExclusions,
  hocMeasurement,
  hocType,
  measurementOf,
  reliabilityFromLoadings,
  standardizedAlpha,
  vifFromCorrelations,
  type HocCheck,
  type Measurement,
} from './hoc';
import { hocFixture as fixture, type HocFixture as Fixture } from './hocFixtures';

const APPROACHES: HocApproach[] = ['two_stage', 'embedded', 'repeated'];
const TYPES: [Measurement, Measurement][] = [
  ['reflective', 'reflective'],
  ['reflective', 'formative'],
  ['formative', 'reflective'],
  ['formative', 'formative'],
];

const stat = (key: string, original: number, significant: boolean): BootstrapStat => ({
  key,
  group: 'weight',
  label: key,
  original,
  mean: original,
  sd: 0.1,
  t: significant ? 4 : 0.5,
  p: significant ? 0.001 : 0.6,
  ciLow: significant ? original - 0.1 : -0.1,
  ciHigh: significant ? original + 0.1 : 0.2,
});
const boot = (stats: BootstrapStat[]): BootstrapResult => ({
  samples: 5000,
  failed: 0,
  confidence: 0.95,
  stats,
});

function check(
  f: Fixture,
  b: BootstrapResult | null = null,
  edit?: (p: PlsResult) => void,
): HocCheck {
  const { model, pls } = fixture(f);
  edit?.(pls);
  const [c] = hocChecks({ model, pls, boot: b, approach: f.approach, plsPackage: 'cSEM' });
  return c;
}
const line = (c: HocCheck, id: string) => c.lines.find((l) => l.id === id)!;
const ids = (c: HocCheck) => c.lines.map((l) => l.id);

describe('the HOC type', () => {
  it('reads Mode A as reflective and Mode B as formative; sum scores by the construct type', () => {
    expect(measurementOf({ type: 'composite', mode: 'A' })).toBe('reflective');
    expect(measurementOf({ type: 'factor', mode: 'B' })).toBe('formative');
    expect(measurementOf({ type: 'factor', mode: 'unit' })).toBe('reflective');
    expect(measurementOf({ type: 'composite', mode: 'unit' })).toBe('formative');
  });

  it('weights the HOC as each package does: cSEM’s two-stage approaches by its type, otherwise by its mode', () => {
    const compositeModeA = { type: 'composite', mode: 'A' } as const;
    expect(hocMeasurement(compositeModeA, 'two_stage', 'cSEM')).toBe('formative');
    expect(hocMeasurement(compositeModeA, 'embedded', 'cSEM')).toBe('formative');
    expect(hocMeasurement(compositeModeA, 'repeated', 'cSEM')).toBe('reflective');
    expect(hocMeasurement(compositeModeA, 'two_stage', 'seminr')).toBe('reflective');
    expect(hocMeasurement({ type: 'factor', mode: 'B' }, 'two_stage', 'cSEM')).toBe('reflective');
  });

  it('names the four types and mixed dimensions, each with a one-line explanation', () => {
    for (const [lower, higher] of TYPES) {
      const t = hocType([lower, lower], higher);
      expect(t.label).toBe(`${lower}–${higher}`);
      expect(t.explanation).toMatch(/\.$/);
    }
    const mixed = hocType(['reflective', 'formative'], 'formative');
    expect(mixed.lower).toBe('mixed');
    expect(mixed.label).toBe('mixed–formative');
  });

  it('is detected from the model for all four types under all three approaches', () => {
    for (const approach of APPROACHES) {
      for (const [lower, higher] of TYPES) {
        const c = check({ lower, higher, approach });
        expect(c.type.label, `${lower}-${higher}, ${approach}`).toBe(`${lower}–${higher}`);
        expect(c.approach).toBe(approach);
        expect(c.components).toEqual(['L1', 'L2']);
      }
    }
  });
});

describe('the checklist lines for every type and approach', () => {
  const LOWER_LINES: Record<Measurement, string[]> = {
    reflective: ['loc-loadings', 'loc-reliability', 'loc-ave', 'loc-htmt'],
    formative: ['loc-item-vif', 'loc-item-weights', 'loc-redundancy'],
  };
  const HIGHER_LINES: Record<Measurement, string[]> = {
    reflective: ['hoc-loadings', 'hoc-reliability', 'hoc-ave', 'hoc-htmt'],
    formative: ['hoc-vif', 'hoc-weights', 'hoc-signs', 'hoc-redundancy'],
  };

  for (const approach of APPROACHES) {
    for (const [lower, higher] of TYPES) {
      it(`${lower}–${higher}, ${approach}: the statistics of its levels, and what not to interpret`, () => {
        const c = check({ lower, higher, approach });
        const want = [...LOWER_LINES[lower], ...HIGHER_LINES[higher]];
        // Repeated indicators with an antecedent (X → H): its paths are biased towards zero.
        if (approach === 'repeated') want.push('hoc-antecedents');
        expect(ids(c)).toEqual(want);
        for (const l of c.lines) {
          expect(['pass', 'attention', 'na', 'notComputed']).toContain(l.status);
          expect(l.sources.length, l.id).toBeGreaterThan(0);
          expect(l.threshold, l.id).toMatch(/\(.*\d{4}.*\)/); // every rule says whose it is
        }
        const ignored = c.ignore.map((i) => i.what).join(' | ');
        expect(ignored).toContain('HTMT of H with its own dimensions');
        if (approach === 'repeated') {
          expect(ignored).toContain('Reliability tab');
          expect(ignored).toContain('R² of H');
        } else {
          expect(ignored).not.toContain('R² of H');
        }
        if (approach !== 'two_stage')
          expect(ignored).toContain('HTMT of H with the other constructs');
        if (approach !== 'repeated' && higher === 'formative')
          expect(ignored).toContain('H’s reliability and AVE');
        const advice = c.advice.map((a) => a.title);
        if (higher === 'formative') {
          expect(advice).toEqual([
            'Weights that change sign',
            'A dimension that is not significant',
            'No global item for the redundancy analysis',
          ]);
        } else if (approach === 'repeated') {
          expect(advice).toEqual(['Reliability of a reflective higher-order construct']);
        } else {
          expect(advice).toEqual([]);
        }
      });
    }
  }
});

describe('a reflective HOC', () => {
  it('two-stage: reliability and AVE are the package’s stage 2 values', () => {
    const c = check({ lower: 'reflective', higher: 'reflective', approach: 'two_stage' });
    const rel = line(c, 'hoc-reliability');
    expect(rel.computed).toBe(false);
    expect(rel.value).toBe('ρC 0.84, ρA 0.85, α 0.82');
    expect(rel.status).toBe('pass');
    expect(line(c, 'hoc-ave').value).toBe('0.72');
  });

  it('repeated indicators: reliability and AVE from the dimensions’ loadings, not the repeated items', () => {
    const c = check({ lower: 'reflective', higher: 'reflective', approach: 'repeated' });
    const { rhoC, ave } = reliabilityFromLoadings([0.9, 0.85]);
    expect(c.derived.rhoC).toBeCloseTo(rhoC, 12);
    const rel = line(c, 'hoc-reliability');
    expect(rel.computed).toBe(true);
    expect(rel.value).toContain(`ρC ${rhoC.toFixed(2)}`);
    expect(rel.value).not.toContain('ρA'); // not computed in this approach
    expect(line(c, 'hoc-ave').value).toBe(ave.toFixed(2));
    expect(line(c, 'hoc-ave').status).toBe('pass'); // (the repeated items' AVE of .27 would fail)
  });

  it('judges the HOC’s HTMT with the other constructs only on two-stage results, never with its own dimensions', () => {
    const two = check({ lower: 'reflective', higher: 'reflective', approach: 'two_stage' });
    expect(line(two, 'hoc-htmt').status).toBe('pass');
    expect(line(two, 'hoc-htmt').value).toBe('Largest 0.60');
    for (const approach of ['embedded', 'repeated'] as const) {
      const c = check({ lower: 'reflective', higher: 'reflective', approach });
      expect(line(c, 'hoc-htmt').status).toBe('notComputed');
    }
  });

  it('flags a low dimension loading', () => {
    const c = check(
      { lower: 'reflective', higher: 'reflective', approach: 'two_stage' },
      null,
      (p) => {
        p.higherOrder![1].loading = 0.35;
      },
    );
    expect(line(c, 'hoc-loadings').status).toBe('attention');
  });
});

describe('reflective dimensions', () => {
  it('keeps a loading between .40 and .708 when its dimension is reliable, and uses .90 between dimensions of one HOC', () => {
    const c = check({ lower: 'reflective', higher: 'formative', approach: 'two_stage' });
    expect(line(c, 'loc-loadings').status).toBe('pass');
    expect(line(c, 'loc-loadings').value).toContain('a3 0.650');
    const htmt = line(c, 'loc-htmt');
    expect(htmt.status).toBe('pass');
    expect(htmt.value).toBe('Largest 0.70'); // (H–L1 1.10 is not a criterion)
    const tight = check(
      { lower: 'reflective', higher: 'formative', approach: 'two_stage' },
      null,
      (p) => {
        p.htmt[2][1] = 0.88; // L2–L1: under .90 for dimensions of the same HOC
        p.htmt[1][0] = 0.86; // L1–X: over .85
      },
    );
    expect(line(tight, 'loc-htmt').status).toBe('attention');
    expect(line(tight, 'loc-htmt').value).toBe('At or above the threshold: L1–X 0.86');
  });
});

describe('a formative HOC', () => {
  const f = { lower: 'reflective', higher: 'formative', approach: 'two_stage' } as const;

  it('computes the dimensions’ VIFs from their scores', () => {
    const c = check(f);
    const v = line(c, 'hoc-vif');
    expect(v.computed).toBe(true);
    expect(v.status).toBe('pass');
    expect(c.derived.vif.L1).toBeCloseTo(c.derived.vif.L2, 12); // two dimensions: the same VIF
    expect(c.derived.vif.L1).toBeGreaterThan(1);
  });

  it('asks for bootstrapping before judging the weights', () => {
    expect(line(check(f), 'hoc-weights').status).toBe('attention');
    expect(line(check(f), 'hoc-weights').detail).toMatch(/Run bootstrapping/);
  });

  it('passes significant weights; keeps a non-significant one with a loading of .50 or more', () => {
    const b = boot([stat('hoWeight:H:L1', 0.6, true), stat('hoWeight:H:L2', 0.5, false)]);
    const w = line(check(f, b), 'hoc-weights');
    expect(w.status).toBe('pass');
    expect(w.detail).toContain('kept for its absolute contribution');
    expect(w.detail).toContain('L2 (loading 0.850)');
  });

  it('flags a dimension whose weight and loading are both not significant (Cenfetelli & Bassellier 2009)', () => {
    const b = boot([
      stat('hoWeight:H:L1', 0.6, true),
      stat('hoWeight:H:L2', 0.1, false),
      stat('hoLoading:H:L2', 0.3, false),
    ]);
    const c = check(f, b, (p) => {
      p.higherOrder![1].loading = 0.3;
    });
    const w = line(c, 'hoc-weights');
    expect(w.status).toBe('attention');
    expect(w.detail).toContain('Weight and loading both not significant: L2');
    expect(w.detail).toContain('only if content validity allows');
  });

  it('reads the weights of repeated indicators from the dimensions’ paths', () => {
    const b = boot([stat('path:L1:H', 0.6, true), stat('path:L2:H', 0.5, true)]);
    const c = check({ ...f, approach: 'repeated' }, b);
    expect(line(c, 'hoc-weights').status).toBe('pass');
    expect(line(c, 'hoc-weights').detail).toBe('Every weight is significant.');
  });

  it('flags a weight whose sign differs from its loading’s', () => {
    const c = check(f, null, (p) => {
      p.higherOrder![1].weight = -0.2;
    });
    const s = line(c, 'hoc-signs');
    expect(s.status).toBe('attention');
    expect(s.value).toBe('L2: weight -0.200, loading 0.850');
    expect(line(check(f), 'hoc-signs').status).toBe('pass');
  });

  it('never fakes a redundancy analysis, but names a single item the HOC alone predicts', () => {
    const plain = line(check(f), 'hoc-redundancy');
    expect(plain.status).toBe('notComputed');
    expect(plain.detail).toContain('report this as a limitation');
    const withZ = line(check({ ...f, global: true }), 'hoc-redundancy');
    expect(withZ.status).toBe('notComputed');
    expect(withZ.detail).toContain(
      'If Z is a global measure of H, its path is the redundancy coefficient: H → Z 0.400.',
    );
  });
});

describe('formative dimensions', () => {
  it('check indicator VIFs, weights and a redundancy analysis that is not computed', () => {
    const c = check({ lower: 'formative', higher: 'reflective', approach: 'embedded' });
    expect(line(c, 'loc-item-vif').status).toBe('pass');
    expect(line(c, 'loc-item-weights').status).toBe('attention'); // not bootstrapped
    expect(line(c, 'loc-redundancy').status).toBe('notComputed');
  });
});

describe('the derived statistics', () => {
  it('ρC and AVE from loadings (cSEM’s stage 2 values for its ?csem example: .8543, .6646)', () => {
    const { rhoC, ave } = reliabilityFromLoadings([0.6794, 0.8564, 0.8937]);
    expect(rhoC).toBeCloseTo(0.8543, 4);
    expect(ave).toBeCloseTo(0.6646, 4);
  });

  it('standardised α and VIFs from a correlation matrix', () => {
    const R = [
      [1, 0.5],
      [0.5, 1],
    ];
    expect(standardizedAlpha(R)).toBeCloseTo(2 / 3, 12);
    expect(vifFromCorrelations(R)).toEqual([4 / 3, 4 / 3].map((v) => expect.closeTo(v, 12)));
  });
});

describe('the reviewer checklist', () => {
  const input = (approach: HocApproach, higher: Measurement) => {
    const { model, pls } = fixture({ lower: 'reflective', higher, approach });
    return {
      model,
      settings: { ...DEFAULT_SETTINGS, hocApproach: approach },
      info: null,
      pls: { ...pls, engine: { package: 'cSEM', version: '0.6.1' } },
    };
  };

  it('adds one item per HOC that summarises its check and links to the tab', () => {
    const items = reviewerChecklist(input('two_stage', 'reflective'));
    const h = items.find((i) => i.id === 'hoc:H')!;
    expect(h.section).toBe('Measurement model');
    expect(h.status).toBe('done');
    expect(h.evidence).toContain('reflective–reflective (two-stage).');
    expect(h.link).toEqual({ kind: 'tab', label: 'Higher-order constructs' });
    const formative = hocChecklistItems({
      ...input('two_stage', 'formative'),
      boot: null,
      approach: 'two_stage',
      plsPackage: 'cSEM',
    })[0];
    expect(formative.status).toBe('issue'); // weights not bootstrapped
    expect(formative.evidence).toContain('Not computed, for you to address: Convergent validity');
  });

  it('leaves a HOC’s HTMT with its own dimensions out of the discriminant validity item', () => {
    const htmt = reviewerChecklist(input('two_stage', 'reflective')).find((i) => i.id === 'htmt')!;
    expect(htmt.status).toBe('done');
    expect(htmt.evidence).toBe('Largest HTMT 0.70.');
    const skip = hocHtmtExclusions({
      ...input('repeated', 'reflective'),
      boot: null,
      approach: 'repeated',
      plsPackage: 'cSEM',
    });
    expect(skip(3, 1)).toBe(true); // H–L1, its own dimension
    expect(skip(4, 3)).toBe(true); // Y–H: H's HTMT on repeated items
    expect(skip(2, 1)).toBe(false);
  });

  it('adds nothing for a model without HOCs', () => {
    const { model, pls } = fixture({
      lower: 'reflective',
      higher: 'reflective',
      approach: 'two_stage',
    });
    const items = hocChecklistItems({
      model,
      pls: { ...pls, higherOrder: undefined },
      boot: null,
      approach: 'two_stage',
      plsPackage: 'cSEM',
    });
    expect(items).toEqual([]);
  });
});
