import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CbFit, CbResult } from '../../engine/cbsem';
import type { Construct, ModelState } from '../../model/project';
import { fitNotes, reportedIndices } from './FitGuide';
import { efaComparison, MisfitPanelBody, miParameter } from './MisfitPanel';
import { CbTab } from './CbTabs';

const fit = (over: Partial<CbFit> = {}): CbFit => ({
  chisq: 85.306,
  df: 24,
  pvalue: 0,
  baselineChisq: 918.852,
  baselineDf: 36,
  cfi: 0.931,
  tli: 0.896,
  rmsea: 0.092,
  rmseaLow: 0.071,
  rmseaHigh: 0.114,
  rmseaP: 0.001,
  srmr: 0.065,
  aic: 7535.49,
  bic: 7646.703,
  logl: -3737.745,
  npar: 21,
  ...over,
});
const robust = (over: Partial<CbFit> = {}) =>
  fit({
    chisqScaled: 80.872,
    dfScaled: 24,
    pvalueScaled: 0,
    scalingFactor: 1.055,
    baselineChisqScaled: 789.892,
    cfiScaled: 0.925,
    tliScaled: 0.887,
    cfiRobust: 0.93,
    tliRobust: 0.895,
    rmseaScaled: 0.089,
    rmseaRobust: 0.092,
    ...over,
  });
const ids = (cb: Pick<CbResult, 'fit' | 'estimator'>) => fitNotes(cb).map((n) => n.id);

describe('fit-index guidance', () => {
  it('ML: report the standard column; no scaled-difference note', () => {
    expect(ids({ fit: fit({ rmsea: 0.05 }), estimator: 'ML' })).toEqual(['report-standard']);
  });

  it('MLR: report the robust column, and use the scaled difference test for comparisons', () => {
    const notes = fitNotes({ fit: robust({ rmseaRobust: 0.05 }), estimator: 'MLR' });
    expect(notes.map((n) => n.id)).toEqual(['report-robust', 'scaled-difference']);
    expect(notes[0].text).toMatch(/Brosseau-Liard, Savalei & Li 2012/);
    expect(notes[1].text).toMatch(/do not subtract scaled χ²/);
    expect(notes[1].text).toMatch(/lavTestLRT/);
    expect(reportedIndices(robust({ cfiRobust: 0.9 })).cfi).toBe(0.9);
  });

  it('explains robust indices that lavaan leaves NA', () => {
    const f = robust({
      cfiRobust: undefined,
      tliRobust: undefined,
      rmseaRobust: undefined,
      rmsea: 0.05,
    });
    const notes = fitNotes({ fit: f, estimator: 'WLSMV' });
    expect(notes.map((n) => n.id)).toEqual(['robust-missing', 'scaled-difference']);
    expect(notes[0].text).toMatch(/ordinal indicators and a baseline model other than the default/);
    // (robust ML by rsem has no robust indices by design: no NA warning)
    expect(ids({ fit: robust({ cfiRobust: undefined, rmsea: 0.05 }), estimator: 'RML' })).toEqual([
      'report-standard',
      'scaled-difference',
    ]);
  });

  it('TLI above 1 and CFI of 0', () => {
    expect(ids({ fit: fit({ tli: 1.02, cfi: 1 }), estimator: 'ML' })).toContain('tli-above-one');
    expect(ids({ fit: fit({ tli: 1 }), estimator: 'ML' })).not.toContain('tli-above-one');
    const zero = fitNotes({ fit: fit({ cfi: 0 }), estimator: 'ML' }).find(
      (n) => n.id === 'cfi-zero',
    );
    expect(zero?.level).toBe('warning');
    expect(zero?.text).toMatch(/no better than the baseline model/);
  });

  it('a high RMSEA: the conditional few-df note with the model’s df (Kenny, Kaniskan & McCoach 2015)', () => {
    const note = fitNotes({ fit: fit({ df: 4, rmsea: 0.15 }), estimator: 'ML' }).find(
      (n) => n.id === 'rmsea-low-df',
    );
    expect(note?.level).toBe('info');
    expect(note?.text).toMatch(/If the model has few degrees of freedom \(here df = 4\)/);
    expect(note?.text).toMatch(/Kenny, Kaniskan & McCoach \(2015\)/);
    // (no df cutoff of the app's own: shown whenever RMSEA misses the cutoff)
    expect(ids({ fit: fit({ df: 24, rmsea: 0.15 }), estimator: 'ML' })).toContain('rmsea-low-df');
    expect(ids({ fit: fit({ df: 2, rmsea: 0.04 }), estimator: 'ML' })).not.toContain(
      'rmsea-low-df',
    );
    expect(ids({ fit: fit({ df: 0, rmsea: 0 }), estimator: 'ML' })).not.toContain('rmsea-low-df');
  });

  it('renders under the fit table with the baseline χ² behind CFI and TLI', () => {
    const cb = {
      fit: robust(),
      estimator: 'MLR',
      n: 301,
      iterations: 30,
      warnings: [],
    } as unknown as CbResult;
    const out = renderToStaticMarkup(<CbTab tab="fit" cb={cb} boot={null} />);
    expect(out).toContain('Report the second column (Robust / scaled)');
    expect(out).toContain('χ²(baseline) = 918.85 on 36 df');
    expect(out).toContain('How to read these fit indices');
    expect(out).toContain('Why the columns differ');
    expect(out).toContain('Diagnose misfit');
  });
});

const F = (id: string, name: string, indicators: string[], over: Partial<Construct> = {}) =>
  ({
    id,
    name,
    type: 'factor',
    mode: 'A',
    indicators,
    x: 0,
    y: 0,
    side: 'left',
    ...over,
  }) as Construct;
const hs: ModelState = {
  constructs: [
    F('v', 'visual', ['x1', 'x2', 'x3']),
    F('t', 'textual', ['x4', 'x5', 'x6']),
    F('s', 'speed', ['x7', 'x8', 'x9']),
  ],
  paths: [],
  moderations: [],
};

describe('EFA comparison around the model’s number of factors', () => {
  it('k − 1 to k + 1 factors on the factors’ indicators, lavaan’s extraction with the fit by number', () => {
    const x = efaComparison(hs);
    if (typeof x === 'string') throw new Error(x);
    expect(x.k).toBe(3);
    expect(x.design).toMatchObject({
      vars: ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9'],
      method: 'lavaan',
      criterion: 'fixed',
      nfactors: 4,
      from: 2,
      rotation: 'geominQ',
      correlation: 'pearson',
    });
  });

  it('polychoric with ordinal indicators; covariates and single indicators left out', () => {
    const m: ModelState = {
      ...hs,
      constructs: [...hs.constructs, F('c', 'age', ['age'], { covariate: true })],
      ordered: ['x1'],
    };
    const x = efaComparison(m);
    if (typeof x === 'string') throw new Error(x);
    expect(x.design.correlation).toBe('polychoric');
    expect(x.design.vars).not.toContain('age');
  });

  it('one factor: 1 and 2 factors; too few indicators or no factor says why', () => {
    const one = efaComparison({ ...hs, constructs: [F('v', 'visual', ['x1', 'x2', 'x3'])] });
    if (typeof one === 'string') throw new Error(one);
    expect([one.design.from, one.design.nfactors]).toEqual([1, 2]);
    expect(efaComparison({ ...hs, constructs: [] })).toMatch(/no factor/);
    const two = efaComparison({
      ...hs,
      constructs: [F('a', 'a', ['x1', 'x2']), F('b', 'b', ['x3', 'x4'])],
    });
    if (typeof two === 'string') throw new Error(two);
    expect([two.design.from, two.design.nfactors]).toEqual([1, 3]);
    expect(efaComparison({ ...hs, constructs: [F('a', 'a', ['x1', 'x2'])] })).not.toBeTypeOf(
      'string',
    );
  });
});

describe('the Diagnose misfit panel', () => {
  const panel = (c: CbResult, model: ModelState = hs, fresh = false) =>
    renderToStaticMarkup(<MisfitPanelBody cb={c} model={model} fresh={fresh} />);
  const cb = {
    fit: fit(),
    estimator: 'ML',
    misfit: {
      mi: [
        { lhs: 'visual', op: '=~', rhs: 'x9', mi: 36.411, epc: 0.577, sepc: 0.515 },
        { lhs: 'x7', op: '~~', rhs: 'x8', mi: 34.145, epc: 0.536, sepc: 0.859 },
        { lhs: 'x2', op: '~~', rhs: 'x3', mi: 1, epc: 0.01, sepc: 0.02 },
      ],
      miCount: 54,
      residuals: [{ pairs: [{ a: 'x7', b: 'x8', r: 0.072, z: 4.6 }] }],
      code: ['mi_all <- modindices(fit)'],
    },
  } as unknown as CbResult;

  it('opens by itself when the fit looks poor, ranking by SEPC with plain judgements', () => {
    const out = panel(cb);
    expect(out).toContain('<details open=""');
    expect(out).toContain('CFI, RMSEA beyond the guideline cutoffs');
    expect(out).toContain('Largest residuals');
    expect(out).toContain('x7 ↔ x8');
    expect(out.indexOf('x7 ↔ x8 (covariance)')).toBeLessThan(out.indexOf('visual → x9 (loading)'));
    expect(out).toContain('Likely misspecified (large change)');
    expect(out).toContain('No misspecification');
    expect(out).toContain('Compare with EFA at 2–4 factors');
    expect(out).toContain('mi_all &lt;- modindices(fit)');
    expect(out).not.toContain('robust ones');
  });

  it('stays closed when the fit is fine, and notes non-robust MIs with a robust estimator', () => {
    const good = {
      ...cb,
      fit: robust({ cfiRobust: 0.99, rmseaRobust: 0.03, srmr: 0.03 }),
    } as CbResult;
    const out = panel(good);
    expect(out).not.toContain('<details open=""');
    expect(out).toContain('not robust ones');
  });

  it('lists the post hoc modifications and warns about successive deletions', () => {
    const out = panel(cb, {
      ...hs,
      modifications: [
        { id: 'a', kind: 'remove', lhs: 'B', op: '~', rhs: 'A', at: 1, p: 0.4 },
        { id: 'b', kind: 'remove', lhs: 'C', op: '~', rhs: 'A', at: 2, p: 0.7 },
      ],
    });
    expect(out).toContain('Post hoc modifications in this project (2)');
    expect(out).toContain('Deleted the path A → B, p = .400');
    expect(out).toContain('deleted 2 non-significant paths');
  });

  it('says why without lavaan’s diagnostics', () => {
    expect(panel({ ...cb, misfit: undefined })).toContain(
      'need lavaan’s fit of a single-level model',
    );
    expect(panel({ ...cb, misfit: { ...cb.misfit!, error: 'boom' } } as CbResult)).toContain(
      'lavaan could not compute the diagnostics: boom',
    );
  });

  it('offers to free what the rule calls misspecified, only from results of the current model', () => {
    expect(panel(cb)).not.toContain('Free x7 ↔ x8');
    const out = panel(cb, hs, true);
    expect(out).toContain('Free x7 ↔ x8 (covariance)');
    expect(out).toContain('Free visual → x9 (loading)');
    expect(out).not.toContain('Free x2 ↔ x3');
  });

  it('names parameters in words', () => {
    expect(miParameter({ lhs: 'f', op: '~', rhs: 'g' })).toBe('g → f (path)');
  });
});
