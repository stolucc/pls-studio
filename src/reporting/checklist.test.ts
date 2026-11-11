import { describe, expect, it } from 'vitest';
import type { CbEstimate } from '../engine/cbsem';
import { hasWork } from './citations';
import { checklistBlocked, reviewerChecklist, statusCounts, type CheckItem } from './checklist';
import { cbInput, cbResult, cpaInput, cpaResult, plsBoot, plsInput, plsResult } from './fixtures';

const item = (items: CheckItem[], id: string) => {
  const i = items.find((x) => x.id === id);
  if (!i) throw new Error(`no item ${id}: ${items.map((x) => x.id).join(', ')}`);
  return i;
};

describe('reviewer checklist: CB-SEM', () => {
  const items = reviewerChecklist(cbInput());

  it('reports χ², df and p (scaled) and the fit indices against Hu & Bentler', () => {
    expect(item(items, 'chisq')).toMatchObject({ status: 'done' });
    expect(item(items, 'chisq').evidence).toContain('Scaled χ²(8) = 16.90, p = .031');
    expect(item(items, 'indices')).toMatchObject({ status: 'done' });
    expect(item(items, 'indices').evidence).toContain('Robust CFI = 0.988');
    const poor = reviewerChecklist(
      cbInput({ cb: cbResult({ fit: { ...cbResult().fit, cfiRobust: 0.91, rmseaRobust: 0.09 } }) }),
    );
    expect(item(poor, 'indices').status).toBe('issue');
    expect(item(poor, 'indices').evidence).toContain('CFI 0.910 < .95; RMSEA 0.090 > .06');
    // A just-identified model has no testable fit.
    const sat = reviewerChecklist(
      cbInput({ cb: cbResult({ fit: { ...cbResult().fit, df: 0, dfScaled: 0 } }) }),
    );
    expect(item(sat, 'chisq').status).toBe('na');
    expect(sat.some((i) => i.id === 'indices')).toBe(false);
  });

  it('flags loadings below .50 and weak reliability, and Heywood cases', () => {
    expect(item(items, 'loadings')).toMatchObject({ status: 'issue' });
    expect(item(items, 'loadings').evidence).toContain('x3 (0.42)');
    expect(item(items, 'reliability').status).toBe('issue');
    expect(item(items, 'reliability').evidence).toContain('Anxiety (CR 0.66, AVE 0.44)');
    expect(item(items, 'heywood').status).toBe('done');
    expect(item(items, 'r2').evidence).toBe('Depression: 0.30.');
    const neg: CbEstimate = {
      kind: 'residual',
      lhs: 'y3',
      op: '~~',
      rhs: 'y3',
      est: -0.05,
      se: 0.02,
      z: -2.5,
      p: 0.01,
      std: -0.06,
    };
    const heywood = reviewerChecklist(
      cbInput({
        cb: cbResult({
          estimates: [...cbResult().estimates, neg],
          stdLoadings: [0.78, 0.74, 0.42, 0.81, 1.03, 0.77],
        }),
      }),
    );
    expect(item(heywood, 'heywood').status).toBe('issue');
    expect(item(heywood, 'heywood').evidence).toBe(
      'Negative variance: y3. Standardised loading beyond ±1: y2.',
    );
  });

  it('checks HTMT, the N:q ratio, the estimator and missing data', () => {
    expect(item(items, 'htmt')).toMatchObject({ status: 'done', evidence: 'Largest HTMT 0.62.' });
    expect(item(items, 'samplesize').status).toBe('done');
    expect(item(items, 'samplesize').evidence).toContain('N:q = 21.7');
    expect(
      item(reviewerChecklist(cbInput({ cb: cbResult({ n: 150 }) })), 'samplesize').status,
    ).toBe('issue');
    expect(item(items, 'distribution').status).toBe('done'); // MLR
    expect(
      item(reviewerChecklist(cbInput({ cb: cbResult({ estimator: 'ML' }) })), 'distribution')
        .status,
    ).toBe('author');
    expect(
      item(
        reviewerChecklist(
          cbInput({ cb: cbResult({ estimator: 'ML' }), log: [{ type: 'screen', run: true }] }),
        ),
        'distribution',
      ).status,
    ).toBe('done');
    expect(item(items, 'missing')).toMatchObject({ status: 'done' });
    expect(item(items, 'missing').evidence).toContain('57 missing cells; treated by FIML');
  });

  it('asks for invariance tests only with groups, and leaves equivalent models to the author', () => {
    expect(item(items, 'invariance').status).toBe('na');
    const grouped = {
      ...cbInput().model,
      multigroup: { column: 'sex', invariance: 'scalar' as const, free: [] },
    };
    expect(item(reviewerChecklist(cbInput({ model: grouped })), 'invariance').status).toBe('issue');
    const tested = reviewerChecklist(
      cbInput({
        model: grouped,
        invariance: {
          robust: true,
          warnings: [],
          levels: [
            { level: 'configural', chisq: 20, df: 16, cfi: 0.99, rmsea: 0.03, srmr: 0.03 },
            {
              level: 'metric',
              chisq: 25,
              df: 20,
              cfi: 0.985,
              rmsea: 0.03,
              srmr: 0.04,
              cfiChange: -0.005,
              p: 0.29,
            },
          ],
        },
      }),
    );
    expect(item(tested, 'invariance').status).toBe('done');
    expect(item(tested, 'invariance').evidence).toContain(
      'metric (CFI 0.985, ΔCFI -0.005, Δχ² p = .290)',
    );
    expect(item(items, 'equivalent').status).toBe('author');
  });

  it('includes the model check’s problems, and the bootstrap of indirect effects only with mediation', () => {
    expect(item(items, 'specification').status).toBe('done');
    const flagged = reviewerChecklist(cbInput(), [
      { level: 'warning', message: 'Indicator x3 is in two constructs.' },
    ]);
    expect(item(flagged, 'specification')).toMatchObject({
      status: 'issue',
      evidence: 'Indicator x3 is in two constructs.',
    });
    expect(item(items, 'bootstrap').status).toBe('na'); // one path, no mediation
  });
});

describe('reviewer checklist: PLS-SEM', () => {
  const items = reviewerChecklist(plsInput());

  it('assesses indicator reliability, ρA/ρC, AVE and HTMT of the Mode A blocks', () => {
    // Image's im3 (0.65) is below .708, but above .40 with Image meeting ρC and AVE: it may stay.
    expect(item(items, 'indicatorreliability').evidence).toContain('im3 (0.650)');
    expect(item(items, 'indicatorreliability').status).toBe('done');
    const weak = reviewerChecklist(
      plsInput({
        pls: plsResult({ loadings: [0.82, 0.79, 0.35, 0.7, 0.8, 0.75, 0.6, 0.9, 0.88] }),
      }),
    );
    expect(item(weak, 'indicatorreliability').status).toBe('issue');
    expect(item(items, 'reliability').status).toBe('done');
    expect(item(items, 'ave').status).toBe('done');
    expect(item(items, 'htmt')).toMatchObject({ status: 'issue' });
    expect(item(items, 'htmt').evidence).toBe('At or above .85: Loyalty–Image (0.92).');
  });

  it('assesses the formative block by VIF and bootstrapped weights', () => {
    expect(item(items, 'outervif').status).toBe('done');
    expect(item(items, 'outervif').evidence).toContain('Between 3 and 5: sa2 (3.40)');
    expect(item(items, 'weights').status).toBe('issue'); // the bootstrap has no weight statistics
    const withWeights = reviewerChecklist(
      plsInput({
        boot: plsBoot({
          stats: [
            ...plsBoot().stats,
            {
              key: 'w',
              group: 'weight',
              label: 'sa1',
              original: 0.4,
              mean: 0.4,
              sd: 0.1,
              t: 4,
              p: 0,
              ciLow: 0.2,
              ciHigh: 0.6,
            },
          ],
        }),
      }),
    );
    expect(item(withWeights, 'weights').status).toBe('done');
  });

  it('asks for PLSpredict until it has run, and marks the structural model', () => {
    expect(item(items, 'predict').status).toBe('issue');
    expect(item(items, 'predict').link).toEqual({
      kind: 'card',
      type: 'plspredict',
      label: 'Add PLSpredict',
    });
    expect(
      item(reviewerChecklist(plsInput({ log: [{ type: 'plspredict', run: true }] })), 'predict')
        .status,
    ).toBe('done');
    expect(item(items, 'r2').evidence).toContain('Satisfaction: 0.25, Loyalty: 0.48');
    expect(item(items, 'f2').status).toBe('done');
    expect(item(items, 'innervif').status).toBe('done');
    expect(item(items, 'bootstrap').status).toBe('done');
    expect(item(reviewerChecklist(plsInput({ boot: null })), 'bootstrap').status).toBe('issue');
    expect(item(items, 'srmr').status).toBe('done');
    expect(item(items, 'missing').status).toBe('issue'); // mean replacement
    expect(item(items, 'cmb').status).toBe('author');
    expect(item(items, 'micom').status).toBe('na');
  });
});

describe('reviewer checklist: conditional process analysis', () => {
  const items = reviewerChecklist(cpaInput());

  it('checks HC standard errors, bootstrap resamples and the scales', () => {
    expect(item(items, 'hc')).toMatchObject({ status: 'done', evidence: 'HC3 standard errors.' });
    expect(
      item(reviewerChecklist(cpaInput({ process: cpaResult({ hc: 'none' }) })), 'hc').status,
    ).toBe('author');
    expect(item(items, 'bootstrap').status).toBe('done');
    expect(
      item(
        reviewerChecklist(cpaInput({ process: cpaResult({ boot: { samples: 1000 } }) })),
        'bootstrap',
      ).status,
    ).toBe('issue');
    expect(item(items, 'scales').status).toBe('issue');
    expect(item(items, 'scales').evidence).toContain('Efficacy is a mean score');
    expect(
      item(reviewerChecklist(cpaInput({ log: [{ type: 'reliability', run: true }] })), 'scales')
        .status,
    ).toBe('done');
    expect(item(items, 'probing').status).toBe('na');
    expect(item(items, 'index').status).toBe('na');
    expect(item(items, 'causal').status).toBe('author');
    expect(item(items, 'missing')).toMatchObject({
      status: 'done',
      evidence: 'No missing values in the data.',
    });
  });

  it('wants the index of moderated mediation when the model has one', () => {
    const modmed = cpaResult({ moderators: [{ name: 'Support', values: [1, 2, 3] }] });
    const r = reviewerChecklist(cpaInput({ process: modmed }));
    expect(item(r, 'index').status).toBe('issue');
    expect(item(r, 'probing').status).toBe('done');
    expect(
      item(
        reviewerChecklist(
          cpaInput({
            process: {
              ...modmed,
              indices: [
                {
                  kind: 'mm',
                  path: ['Training', 'Efficacy', 'Performance'],
                  moderator: 'Support',
                  est: 0.1,
                  se: 0.04,
                  lo: 0.02,
                  hi: 0.18,
                },
              ],
            },
          }),
        ),
        'index',
      ).status,
    ).toBe('done');
  });
});

describe('reviewer checklist', () => {
  it('cites known works and has unique items, with every status counted', () => {
    for (const items of [
      reviewerChecklist(cbInput()),
      reviewerChecklist(plsInput()),
      reviewerChecklist(cpaInput()),
    ]) {
      expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
      for (const i of items) {
        expect(i.sources.length, i.id).toBeGreaterThan(0);
        for (const k of i.sources) expect(hasWork(k), `${i.id}: ${k}`).toBe(true);
        expect(i.evidence, i.id).toMatch(/\S/);
      }
      const n = statusCounts(items);
      expect(n.done + n.issue + n.author + n.na).toBe(items.length);
    }
  });

  it('cites the guidelines it follows', () => {
    const keys = (items: CheckItem[]) => new Set(items.flatMap((i) => i.sources));
    expect(keys(reviewerChecklist(plsInput())).has('hair2019')).toBe(true);
    expect(keys(reviewerChecklist(cbInput())).has('jackson2009')).toBe(true);
    expect(keys(reviewerChecklist(cbInput())).has('appelbaum2018')).toBe(true);
    expect(keys(reviewerChecklist(cpaInput())).has('hayes2022')).toBe(true);
  });

  it('needs the method’s results first, and does not cover MIIV-2SLS', () => {
    expect(checklistBlocked(plsInput({ pls: null }))).toMatch(/Calculate the model first/);
    expect(
      checklistBlocked(cbInput({ settings: { ...cbInput().settings, estimator: '2SLS' } })),
    ).toMatch(/not MIIV-2SLS/);
    expect(() => reviewerChecklist(cpaInput({ process: null }))).toThrow(/Calculate/);
  });
});
