import { describe, expect, it } from 'vitest';
import type { BootstrapStat } from '../engine/types';
import { reviewerChecklist } from './checklist';
import { plsBoot, plsInput, cbInput } from './fixtures';
import {
  apaNumber,
  buildPair,
  ciName,
  classifyMediation,
  excludesZero,
  intervalDigits,
  mediationPairs,
  mediationSentence,
  pairNotes,
  SEVERAL_MEDIATORS_NOTE,
  processMediationPair,
  splitChain,
  typeCounts,
  type Interval,
  type MediationType,
} from './mediation';
import { methodsText } from './methods';

// An interval by sign: '+' significant positive, '-' significant negative, '0' includes zero (with a
// positive or negative estimate).
const iv = (kind: '+' | '-' | '0+' | '0-'): Interval => {
  switch (kind) {
    case '+':
      return { est: 0.3, lo: 0.1, hi: 0.5 };
    case '-':
      return { est: -0.3, lo: -0.5, hi: -0.1 };
    case '0+':
      return { est: 0.05, lo: -0.1, hi: 0.2 };
    default:
      return { est: -0.05, lo: -0.2, hi: 0.1 };
  }
};

describe('excludesZero', () => {
  it('a bound exactly at zero does not exclude it; NaN never does', () => {
    expect(excludesZero({ est: 0.2, lo: 0, hi: 0.4 })).toBe(false);
    expect(excludesZero({ est: -0.2, lo: -0.4, hi: 0 })).toBe(false);
    expect(excludesZero({ est: 0.2, lo: 1e-12, hi: 0.4 })).toBe(true);
    expect(excludesZero({ est: -0.2, lo: -0.4, hi: -1e-12 })).toBe(true);
    expect(excludesZero({ est: NaN, lo: NaN, hi: NaN })).toBe(false);
  });
});

describe('classifyMediation: every sign and significance combination (Zhao et al., 2010)', () => {
  const kinds = ['+', '-', '0+', '0-'] as const;
  const expected = (ind: (typeof kinds)[number], dir: (typeof kinds)[number]): MediationType => {
    const indSig = ind === '+' || ind === '-';
    const dirSig = dir === '+' || dir === '-';
    if (indSig && dirSig) return ind === dir ? 'complementary' : 'competitive';
    if (indSig) return 'indirect-only';
    if (dirSig) return 'direct-only';
    return 'no-effect';
  };
  for (const ind of kinds)
    for (const dir of kinds)
      it(`indirect ${ind}, direct ${dir} → ${expected(ind, dir)}`, () => {
        const r = classifyMediation(iv(ind), iv(dir));
        expect(r.type).toBe(expected(ind, dir));
        expect(r.directTested).toBe(true);
        expect(r.indirectSignificant).toBe(ind === '+' || ind === '-');
        expect(r.directSignificant).toBe(dir === '+' || dir === '-');
      });

  it('the four types of a significant indirect effect, spelled out', () => {
    expect(classifyMediation(iv('+'), iv('+')).type).toBe('complementary');
    expect(classifyMediation(iv('-'), iv('-')).type).toBe('complementary');
    expect(classifyMediation(iv('+'), iv('-')).type).toBe('competitive');
    expect(classifyMediation(iv('-'), iv('+')).type).toBe('competitive');
    expect(classifyMediation(iv('+'), iv('0-')).type).toBe('indirect-only');
  });

  it('an interval touching zero counts as not significant', () => {
    const touching = { est: 0.2, lo: 0, hi: 0.4 };
    expect(classifyMediation(touching, iv('+')).type).toBe('direct-only');
    expect(classifyMediation(iv('+'), touching).type).toBe('indirect-only');
    expect(classifyMediation(touching, touching).type).toBe('no-effect');
  });

  it('no direct path in the model: the direct effect is untested (fixed at zero)', () => {
    const a = classifyMediation(iv('+'), null);
    expect(a.type).toBe('indirect-only');
    expect(a.directTested).toBe(false);
    expect(classifyMediation(iv('0+'), null).type).toBe('no-effect');
  });

  it('uses the interval, not the p-value or the estimate size', () => {
    // A tiny effect whose interval excludes zero is significant; a large one whose interval does not, is not.
    expect(classifyMediation({ est: 0.001, lo: 0.0001, hi: 0.002 }, iv('0+')).type).toBe(
      'indirect-only',
    );
    expect(classifyMediation({ est: 0.6, lo: -0.01, hi: 1.2 }, iv('+')).type).toBe('direct-only');
  });
});

describe('splitChain', () => {
  it('splits keys by the model’s names, also names that contain ":"', () => {
    expect(splitChain('X:M:Y', ['X', 'M', 'Y'])).toEqual(['X', 'M', 'Y']);
    expect(splitChain('X:Z:M:Y', ['X', 'X:Z', 'M', 'Y'])).toEqual(['X:Z', 'M', 'Y']);
    expect(splitChain('X:Q:Y', ['X', 'M', 'Y'])).toBeNull();
  });
});

const stat = (key: string, group: BootstrapStat['group'], e: Interval): BootstrapStat => ({
  key,
  group,
  label: key,
  original: e.est,
  mean: e.est,
  sd: 0.1,
  t: e.est / 0.1,
  p: 0.5,
  ciLow: e.lo,
  ciHigh: e.hi,
});

describe('mediationPairs: parallel and serial mediators', () => {
  // X → M1 → Y, X → M2 → Y, X → M1 → M2 → Y (serial), X → Y.
  const C = ['X', 'M1', 'M2', 'Y'];
  const paths = new Set(['X>M1', 'X>M2', 'M1>M2', 'M1>Y', 'M2>Y', 'X>Y']);
  const has = (a: string, b: string) => paths.has(`${a}>${b}`);

  it('classifies each specific effect against the same direct effect; the serial chain is one effect', () => {
    const boot = {
      stats: [
        stat('path:X:Y', 'path', iv('+')),
        stat('indirect:X:Y', 'indirect', iv('+')),
        stat('specific:X:M1:Y', 'specific', iv('+')),
        stat('specific:X:M2:Y', 'specific', iv('-')),
        stat('specific:X:M1:M2:Y', 'specific', iv('0+')),
        // A mediator as X: M1 → M2 → Y, against the direct path M1 → Y.
        stat('path:M1:Y', 'path', iv('0+')),
        stat('indirect:M1:Y', 'indirect', iv('+')),
        stat('specific:M1:M2:Y', 'specific', iv('+')),
      ],
    };
    const pairs = mediationPairs(boot, C, has);
    const xy = pairs.find((p) => p.from === 'X' && p.to === 'Y')!;
    expect(xy.specific.map((e) => [e.path.join('→'), e.cls.type])).toEqual([
      ['X→M1→Y', 'complementary'],
      ['X→M2→Y', 'competitive'],
      ['X→M1→M2→Y', 'direct-only'],
    ]);
    expect(xy.total!.cls.type).toBe('complementary');
    expect(xy.significantSpecific).toBe(2);
    expect(xy.opposingSpecific).toBe(true);
    expect(xy.totalHidesSpecific).toBe(false);
    const m1y = pairs.find((p) => p.from === 'M1' && p.to === 'Y')!;
    expect(m1y.specific[0].cls.type).toBe('indirect-only');
    expect(typeCounts(pairs)).toEqual({
      complementary: 1,
      competitive: 1,
      'direct-only': 1,
      'indirect-only': 1,
    });
  });

  it('“only 1 of 4 specific indirect effects is significant”, total effect and total indirect not significant', () => {
    const C4 = ['X', 'M1', 'M2', 'M3', 'M4', 'Y'];
    const stats = [
      stat('path:X:Y', 'path', iv('0+')),
      stat('indirect:X:Y', 'indirect', iv('0+')),
      stat('specific:X:M1:Y', 'specific', iv('+')),
      stat('specific:X:M2:Y', 'specific', iv('0-')),
      stat('specific:X:M3:Y', 'specific', iv('0+')),
      stat('specific:X:M4:Y', 'specific', iv('0-')),
    ];
    const pairs = mediationPairs({ stats }, C4, () => true);
    const p = pairs[0];
    expect(p.specific.map((e) => e.cls.type)).toEqual([
      'indirect-only',
      'no-effect',
      'no-effect',
      'no-effect',
    ]);
    expect(p.total!.cls.type).toBe('no-effect');
    expect(p.totalHidesSpecific).toBe(true);
    const notes = pairNotes(p).join(' ');
    expect(notes).toContain('1 of 4 specific indirect effects of X on Y is significant');
    expect(SEVERAL_MEDIATORS_NOTE).toContain(
      'one significant specific effect is mediation through that path',
    );
    expect(notes).toContain('read the specific effects, not the total');
  });

  it('opposite significant specific effects cancelling out: inconsistent mediation', () => {
    const p = buildPair('X', 'Y', iv('0+'), iv('0+'), [
      { path: ['X', 'M1', 'Y'], interval: iv('+') },
      { path: ['X', 'M2', 'Y'], interval: iv('-') },
    ]);
    expect(p.opposingSpecific).toBe(true);
    expect(p.totalHidesSpecific).toBe(true);
    expect(pairNotes(p).join(' ')).toContain('inconsistent mediation');
  });

  it('without specific effects (CB-SEM, older results): the total indirect effect alone', () => {
    const pairs = mediationPairs(
      { stats: [stat('path:X:Y', 'path', iv('-')), stat('indirect:X:Y', 'indirect', iv('+'))] },
      ['X', 'M', 'Y'],
      () => true,
    );
    expect(pairs).toHaveLength(1);
    expect(pairs[0].specific).toEqual([]);
    expect(pairs[0].total!.cls.type).toBe('competitive');
    expect(typeCounts(pairs)).toEqual({ competitive: 1 });
  });

  it('a pair without the direct path: untested direct effect', () => {
    const pairs = mediationPairs(
      {
        stats: [
          stat('indirect:X:Y', 'indirect', iv('+')),
          stat('specific:X:M:Y', 'specific', iv('+')),
        ],
      },
      ['X', 'M', 'Y'],
      () => false,
    );
    expect(pairs[0].direct).toBeNull();
    expect(pairs[0].specific[0].cls).toMatchObject({ type: 'indirect-only', directTested: false });
  });
});

describe('reporting sentences', () => {
  const style = { symbol: 'β' as const, ci: '95% CI' };
  const one = (ind: Interval, dir: Interval | null) => {
    const p = buildPair('X', 'Y', dir, ind, [{ path: ['X', 'M', 'Y'], interval: ind }]);
    return mediationSentence(p, p.specific[0], style);
  };

  it('complementary, as in the task’s example wording', () => {
    expect(one({ est: 0.21, lo: 0.12, hi: 0.31 }, { est: 0.15, lo: 0.05, hi: 0.25 })).toBe(
      'The indirect effect of X on Y through M was significant (β = .21, 95% CI [.12, .31]) and the direct effect remained significant with the same sign (β = .15, 95% CI [.05, .25]): complementary (partial) mediation (Zhao et al., 2010).',
    );
  });
  it('competitive, indirect-only, direct-only, no effect, untested direct path', () => {
    expect(one(iv('+'), iv('-'))).toContain('with the opposite sign (β = −.30');
    expect(one(iv('+'), iv('-'))).toContain('competitive (partial) mediation');
    expect(one(iv('+'), iv('0+'))).toContain(
      'and the direct effect was not (β = .05, 95% CI [−.10, .20]): indirect-only (full) mediation',
    );
    expect(one(iv('0+'), iv('+'))).toContain(
      'was not significant (β = .05, 95% CI [−.10, .20]), while the direct effect was',
    );
    expect(one(iv('0+'), iv('0-'))).toMatch(
      /^Neither the indirect effect of X on Y through M .* nor the direct effect .* was significant: no effect \(no mediation\)/,
    );
    const untested = one(iv('+'), null);
    expect(untested).toContain('The model has no direct path from X to Y');
    expect(untested).toContain(
      'Add the direct path to classify the mediation (Nitzl et al., 2016).',
    );
  });
  it('serial chains and the total indirect effect', () => {
    const p = buildPair('X', 'Y', iv('+'), iv('+'), [
      { path: ['X', 'M1', 'M2', 'Y'], interval: iv('+') },
    ]);
    expect(mediationSentence(p, p.specific[0], style)).toContain(
      'of X on Y serially through M1 and then M2',
    );
    expect(mediationSentence(p, p.total!, style)).toMatch(
      /^The total indirect effect of X on Y \(through all mediators\) was significant/,
    );
  });
  it('numbers: APA style for standardised values, plain for unstandardised; interval names', () => {
    expect(apaNumber(0.214, true)).toBe('.21');
    expect(apaNumber(-0.214, true)).toBe('−.21');
    expect(apaNumber(-0.001, true)).toBe('.00');
    expect(apaNumber(1.5, true)).toBe('1.50');
    expect(apaNumber(0.214, false)).toBe('0.21');
    // A bound that would round to zero gets more decimals, so its sign shows.
    expect(intervalDigits({ est: 0.06, lo: -0.002, hi: 0.13 })).toBe(3);
    expect(intervalDigits({ est: 0.06, lo: 0.0004, hi: 0.13 })).toBe(4);
    expect(intervalDigits({ est: 0.06, lo: 0.01, hi: 0.13 })).toBe(2);
    const p = buildPair('X', 'Y', null, null, [
      { path: ['X', 'M', 'Y'], interval: { est: 0.062, lo: -0.002, hi: 0.13 } },
    ]);
    expect(mediationSentence(p, p.specific[0], { symbol: 'β', ci: '95% CI' })).toContain(
      '(β = .062, 95% CI [−.002, .130])',
    );
    expect(ciName({ confidence: 0.95 })).toBe('95% CI');
    expect(ciName({ confidence: 0.95, interval: 'bca' })).toBe('95% BCa CI');
    expect(ciName({ confidence: 0.9, interval: 'percentile', tails: 1 })).toBe(
      '90% CI (one-sided)',
    );
  });
});

describe('PROCESS models', () => {
  const row = (e: Interval) => ({ ...e });
  it('parallel mediators without moderation: one pair, b and the regression interval of c′', () => {
    const p = processMediationPair({
      direct: { moderators: [], rows: [row(iv('0+'))] },
      directs: [],
      counterfactual: null,
      indirect: [
        { path: ['X', 'M1', 'Y'], moderators: [], rows: [row(iv('+'))] },
        { path: ['X', 'M2', 'Y'], moderators: [], rows: [row(iv('0-'))] },
      ],
      total: row(iv('+')),
    })!;
    expect(p.specific.map((e) => e.cls.type)).toEqual(['indirect-only', 'no-effect']);
    expect(p.total!.cls.type).toBe('indirect-only');
  });
  it('a moderated (conditional) effect, multicategorical X or counterfactual effects: no single typology', () => {
    const base = {
      direct: { moderators: [], rows: [row(iv('+'))] },
      directs: [],
      counterfactual: null,
      indirect: [{ path: ['X', 'M', 'Y'], moderators: [], rows: [row(iv('+'))] }],
      total: null,
    };
    expect(processMediationPair(base)).not.toBeNull();
    expect(
      processMediationPair({
        ...base,
        indirect: [
          { path: ['X', 'M', 'Y'], moderators: ['W'], rows: [row(iv('+')), row(iv('+'))] },
        ],
      }),
    ).toBeNull();
    expect(
      processMediationPair({ ...base, direct: { moderators: ['W'], rows: [row(iv('+'))] } }),
    ).toBeNull();
    expect(processMediationPair({ ...base, directs: [{}] })).toBeNull();
    expect(processMediationPair({ ...base, counterfactual: {} })).toBeNull();
  });
});

describe('methods text and checklist', () => {
  const mediated = plsBoot({
    stats: [
      stat('path:Image:Loyalty', 'path', iv('+')),
      stat('indirect:Image:Loyalty', 'indirect', iv('+')),
      stat('specific:Image:Satisfaction:Loyalty', 'specific', iv('+')),
    ],
  });

  it('PLS-SEM: the classification is described, with Zhao et al. and Nitzl et al.', () => {
    const r = methodsText(plsInput({ boot: mediated }));
    expect(r.text).toContain(
      'Each specific indirect effect was classified as complementary, competitive or indirect-only mediation',
    );
    expect(r.text).toContain(
      'following Zhao et al. (2010), as adopted for PLS-SEM by Nitzl et al. (2016)',
    );
    expect(r.text).toContain(
      'A significant total effect was not required (Zhao et al., 2010; Hayes, 2009).',
    );
    expect(r.latex).toContain('\\citet{zhao2010}');
    expect(r.bibtex).toContain('@article{nitzl2016');
  });
  it('no sentence without bootstrapped indirect effects (unchanged text)', () => {
    expect(methodsText(plsInput()).text).not.toContain('Zhao');
    expect(methodsText(plsInput({ boot: null })).text).not.toContain('Zhao');
  });
  it('checklist: done with the counts after bootstrapping, an issue before', () => {
    const done = reviewerChecklist(plsInput({ boot: mediated })).find(
      (i) => i.id === 'mediationtype',
    )!;
    expect(done.status).toBe('done');
    expect(done.evidence).toBe(
      'Specific indirect effects: 1 complementary (partial) mediation. A reporting sentence for each is on the Indirect & total effects tab.',
    );
    expect(done.link).toEqual({ kind: 'tab', label: 'Indirect & total effects' });
    const before = reviewerChecklist(plsInput({ boot: null })).find(
      (i) => i.id === 'mediationtype',
    )!;
    expect(before.status).toBe('issue');
    expect(before.evidence).toContain('run Bootstrap');
  });
  it('checklist: no item for a model without an indirect effect', () => {
    const items = reviewerChecklist(cbInput());
    const hasChain = cbInput().model.paths.some((p) =>
      cbInput().model.paths.some((q) => q.from === p.to),
    );
    expect(items.some((i) => i.id === 'mediationtype')).toBe(hasChain);
  });
});
