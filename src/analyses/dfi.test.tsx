// The Dynamic fit cutoffs card without R: which dynamic function the model's shape calls for and which are refused
// with what message, options from files (old or partial ones filled in), the reading of the package's tables (the
// three layouts it prints, and exactFit's), the verdicts, and the view.

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { useCompute } from '../rengine/compute';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import type { DfiResult, DfiTable } from '../rengine/dfi';
import {
  dfiAnalysis as card,
  dfiBlocked,
  dfiCutoffText,
  dfiDefaultFn,
  dfiEmpirical,
  dfiLevels,
  dfiNumber,
  dfiShape,
  dfiVerdicts,
  DfiView,
} from './dfi';
import type { AnalysisCtx } from './types';

const K = (id: string, inds: string[], more: Partial<ModelState['constructs'][number]> = {}) => ({
  id,
  name: id,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: inds,
  x: 0,
  y: 0,
  side: 'left' as const,
  ...more,
});
const three: ModelState = {
  constructs: [
    K('F1', ['x1', 'x2', 'x3']),
    K('F2', ['x4', 'x5', 'x6']),
    K('F3', ['x7', 'x8', 'x9']),
  ],
  paths: [],
  moderations: [],
};
const one: ModelState = {
  constructs: [K('F1', ['x1', 'x2', 'x3', 'x4'])],
  paths: [],
  moderations: [],
};
const names = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9'];
const continuous = {
  names,
  cols: names.map((_, k) => Float64Array.from({ length: 40 }, (_, i) => Math.sin(i * (k + 1)) * 2)),
};
const likert = {
  names,
  cols: names.map((_, k) =>
    Float64Array.from({ length: 40 }, (_, i) => 1 + ((i + k + (i % 3)) % 5)),
  ),
};
const matrix = {
  names,
  cols: [],
  moments: { S: names.map((_, i) => names.map((_, j) => (i === j ? 1 : 0.3))), n: 301 },
};
const settings = {
  ...DEFAULT_SETTINGS,
  method: 'cbsem' as const,
  engine: 'r' as const,
  estimator: 'ML' as const,
};
const ordinalSettings = { ...settings, estimator: 'WLSMV' as const, missing: 'casewise' as const };
const ctx = (
  model: ModelState,
  data: AnalysisCtx['data'] = continuous,
  over: Partial<AnalysisCtx> = {},
): AnalysisCtx => ({ data, info: null, settings, pls: null, projectName: 'p', model, ...over });
const opts = (fn: string, more: object = {}) =>
  card.parseOptions({
    fn,
    reps: 500,
    estimator: '',
    scale: 'normal',
    mad: [0.038, 0.05, 0.06],
    ...more,
  })!;

// (the card runs in the browser's R and in desktop R alike: the tests stand where the browser's R is in use)
beforeAll(() => useCompute.setState({ backend: 'browser' }));

describe('the model’s shape and the dynamic function it calls for', () => {
  it('reads factors, higher-order factors, paths, ordinal and Likert indicators, raw data', () => {
    expect(dfiShape(three, continuous)).toMatchObject({
      factors: 3,
      hoc: false,
      structural: false,
      ordinal: 'none',
      raw: true,
      likert: false,
      problem: null,
    });
    expect(dfiShape(three, likert)).toMatchObject({ likert: true });
    expect(dfiShape(three, matrix)).toMatchObject({ raw: false, likert: false });
    expect(dfiShape({ ...three, ordered: names }, likert)).toMatchObject({ ordinal: 'all' });
    expect(dfiShape({ ...three, ordered: ['x1'] }, likert)).toMatchObject({ ordinal: 'some' });
    expect(
      dfiShape({ ...three, paths: [{ id: 'p', from: 'F1', to: 'F2' }] }, continuous),
    ).toMatchObject({ structural: true });
    const hier = {
      ...three,
      constructs: [...three.constructs, K('g', [], { components: ['F1', 'F2', 'F3'] })],
    };
    expect(dfiShape(hier, continuous)).toMatchObject({ factors: 3, hoc: true });
    expect(dfiShape(undefined, continuous).problem).toMatch(/Draw a CB-SEM model/);
    expect(
      dfiShape(
        { ...three, multigroup: { column: 'g', invariance: 'configural', free: [] } },
        continuous,
      ).problem,
    ).toMatch(/single group/);
    expect(
      dfiShape({ ...three, constructs: [K('C', ['x1', 'x2'], { type: 'composite' })] }, continuous)
        .problem,
    ).toMatch(/composites/);
  });

  it('suggests cfaOne / cfaHB for CFAs, cat* for ordinal items, hier1HB for hierarchical models, DDDFI with paths', () => {
    expect(dfiDefaultFn(dfiShape(one, continuous))).toBe('cfaOne');
    expect(dfiDefaultFn(dfiShape(three, continuous))).toBe('cfaHB');
    expect(dfiDefaultFn(dfiShape({ ...one, ordered: ['x1', 'x2', 'x3', 'x4'] }, likert))).toBe(
      'catOne',
    );
    expect(dfiDefaultFn(dfiShape({ ...three, ordered: names }, likert))).toBe('catHB');
    expect(dfiDefaultFn(dfiShape({ ...three, ordered: ['x1'] }, likert))).toBe('DDDFI');
    expect(
      dfiDefaultFn(dfiShape({ ...three, paths: [{ id: 'p', from: 'F1', to: 'F2' }] }, continuous)),
    ).toBe('DDDFI');
    expect(
      dfiDefaultFn(
        dfiShape(
          {
            ...three,
            constructs: [...three.constructs, K('g', [], { components: ['F1', 'F2', 'F3'] })],
          },
          continuous,
        ),
      ),
    ).toBe('hier1HB');
    expect(card.defaults(ctx(three))).toEqual({
      fn: 'cfaHB',
      reps: 500,
      estimator: '',
      scale: 'normal',
      mad: [0.038, 0.05, 0.06],
    });
    expect(card.defaults(ctx({ ...one, ordered: ['x1', 'x2', 'x3', 'x4'] }, likert))).toMatchObject(
      { fn: 'catOne', reps: 250, scale: 'categorical' },
    );
  });

  it('blocks a function that does not fit the shape, naming the one that does', () => {
    expect(card.blocked(opts('cfaHB'), ctx(three))).toBeNull();
    // (the browser's R runs dynamic since the patched build, scripts/webr/fetch.mjs PATCHED: neither backend blocks the card)
    useCompute.setState({ backend: 'helper' });
    expect(card.blocked(opts('cfaHB'), ctx(three))).toBeNull();
    expect(card.sub).not.toMatch(/desktop/);
    useCompute.setState({ backend: 'browser' });
    expect(card.blocked(opts('cfaOne'), ctx(three))).toBe(
      'dynamic::cfaOne is for one-factor models; this model has 3 factors (use cfaHB).',
    );
    expect(card.blocked(opts('cfaHB'), ctx(one))).toMatch(/two or more factors \(use cfaOne\)/);
    expect(
      card.blocked(opts('cfaHB'), ctx({ ...three, paths: [{ id: 'p', from: 'F1', to: 'F2' }] })),
    ).toMatch(/without structural paths; for a model with paths use DDDFI/);
    expect(card.blocked(opts('catHB'), ctx(three))).toMatch(/indicators are all ordinal/);
    expect(
      card.blocked(
        opts('cfaHB'),
        ctx({ ...three, ordered: names }, likert, { settings: ordinalSettings }),
      ),
    ).toMatch(/continuous indicators; with ordinal indicators use catOne, catHB or DDDFI/);
    expect(card.blocked(opts('likertHB'), ctx(three, continuous))).toMatch(
      /integer-valued Likert-type items/,
    );
    expect(card.blocked(opts('likertHB'), ctx(three, matrix))).toMatch(/needs raw data/);
    expect(card.blocked(opts('nnorHB'), ctx(three, matrix))).toMatch(/needs raw data/);
    expect(card.blocked(opts('hier1HB'), ctx(three))).toMatch(
      /hierarchical \(second-order\) factor models/,
    );
    expect(card.blocked(opts('DDDFI', { scale: 'categorical' }), ctx(three))).toMatch(
      /categorical scale needs raw data with every indicator declared ordinal/,
    );
    expect(card.blocked(opts('DDDFI', { scale: 'nonnormal' }), ctx(three, matrix))).toMatch(
      /non-normal scale needs raw data/,
    );
    expect(
      card.blocked(
        opts('DDDFI'),
        ctx({ ...three, ordered: names }, likert, { settings: ordinalSettings }),
      ),
    ).toMatch(/choose it/);
    expect(
      card.blocked(
        opts('catHB', { scale: 'categorical' }),
        ctx({ ...three, ordered: names }, likert, { settings: ordinalSettings }),
      ),
    ).toBeNull();
    expect(card.blocked(opts('equivTest'), ctx(three, matrix))).toBeNull();
    expect(
      card.blocked(
        opts('cfaHB'),
        ctx(three, continuous, { settings: { ...settings, method: 'pls' } }),
      ),
    ).toMatch(/switch the model to CB-SEM/);
    expect(
      card.blocked(
        opts('cfaHB'),
        ctx(three, continuous, { settings: { ...settings, estimator: '2SLS' } }),
      ),
    ).toMatch(/not available with the 2SLS estimator/);
    expect(
      card.blocked(
        opts('cfaHB'),
        ctx(three, continuous, { settings: { ...settings, missing: 'mi' } }),
      ),
    ).toMatch(/multiple imputation/);
    expect(
      dfiBlocked(
        opts('cfaHB'),
        dfiShape(
          { ...three, multigroup: { column: 'g', invariance: 'configural', free: [] } },
          continuous,
        ),
      ),
    ).toMatch(/single group/);
  });

  it('parses options from files: unknown functions and values fall back, old options without the new fields are filled in', () => {
    expect(card.parseOptions({ fn: 'cfaOne', reps: 100 })).toEqual({
      fn: 'cfaOne',
      reps: 100,
      estimator: '',
      scale: 'normal',
      mad: [0.038, 0.05, 0.06],
    });
    expect(
      card.parseOptions({
        fn: 'multiFactor',
        reps: 1e9,
        estimator: 'PML',
        scale: 'weird',
        mad: [0.9, -1, 'x'],
      }),
    ).toEqual({
      fn: 'cfaHB',
      reps: 5000,
      estimator: '',
      scale: 'normal',
      mad: [0.038, 0.05, 0.06],
    });
    expect(
      card.parseOptions({
        fn: 'DDDFI',
        reps: 250,
        estimator: 'MLR',
        scale: 'nonnormal',
        mad: [0.02, 0.04],
      }),
    ).toEqual({ fn: 'DDDFI', reps: 250, estimator: 'MLR', scale: 'nonnormal', mad: [0.02, 0.04] });
    expect(card.parseOptions(null)).toBeNull();
    expect(card.summary(opts('cfaHB'))).toBe('dynamic::cfaHB, 500 replications');
    expect(card.summary(opts('equivTest'))).toBe('dynamic::equivTest');
  });

  it('is stale when the function, its replications or the model change', () => {
    const a = card.fingerprint(opts('cfaHB'), ctx(three));
    expect(a).toBeTruthy();
    expect(card.fingerprint(opts('cfaHB'), ctx(three))).toBe(a);
    expect(card.fingerprint(opts('cfaOne'), ctx(three))).not.toBe(a);
    expect(card.fingerprint(opts('cfaHB', { reps: 100 }), ctx(three))).not.toBe(a);
    expect(card.fingerprint(opts('cfaHB'), ctx(one))).not.toBe(a);
    expect(
      card.fingerprint(
        opts('cfaHB'),
        ctx(three, continuous, { settings: { ...settings, estimator: 'MLR' } }),
      ),
    ).not.toBe(a);
    expect(
      card.fingerprint(
        opts('cfaHB'),
        ctx(three, continuous, { settings: { ...settings, method: 'pls' } }),
      ),
    ).toBeNull();
  });
});

// The tables as dynamic prints them (desktop R, the help-page examples).
const CFAHB: DfiTable = {
  rows: ['Level-0', 'Specificity', '', 'Level-1', 'Sensitivity', '', 'Level-2', 'Sensitivity'],
  columns: ['SRMR', 'RMSEA', 'CFI', 'Magnitude'],
  cells: [
    ['0.04', '0.042', '0.985', 'NONE'],
    ['95%', '95%', '95%', ''],
    ['', '', '', ''],
    ['0.041', '0.042', '0.985', '0.424'],
    ['85%', '90%', '87%', ''],
    ['', '', '', ''],
    ['0.06', '0.086', '0.957', '0.57'],
    ['95%', '95%', '95%', ''],
  ],
};
const FIT6: DfiTable = {
  rows: [''],
  columns: ['Chi-Square', 'df', 'p-value', 'SRMR', 'RMSEA', 'CFI'],
  cells: [['85.306', '24', '0', '0.065', '0.092', '0.931']],
};
const HIER: DfiTable = {
  rows: ['Level 1: 95/5', 'Level 1: 90/10', 'Level 2: 95/5', 'Level 2: 90/10'],
  columns: ['SRMR', 'RMSEA', 'CFI', 'Magnitude'],
  cells: [
    ['.039', 'NONE', 'NONE', '.424'],
    ['--', '.045', '.984', ''],
    ['.063', '.096', '.949', '.57'],
    ['--', '--', '--', ''],
  ],
};
const FIT7: DfiTable = {
  rows: [''],
  columns: ['Chi-Square', 'df', 'p-value', 'SRMR', 'RMSEA', 'CFI', 'NA'],
  cells: [['85.306', '24', '0', '0.065', '0.931', '0.092', '0.114']],
};
const EXACT: DfiTable = {
  rows: ['99th:', '95th:'],
  columns: ['Chi-Square', 'df', 'SRMR', 'RMSEA', 'CFI'],
  cells: [
    ['42.447', '24', '0.043', '0.051', '0.977'],
    ['36.553', '24', '0.04', '0.042', '0.985'],
  ],
};
const DDDFI: DfiTable = {
  rows: [
    'Consistent',
    'Specificity',
    '',
    'Close',
    'Sensitivity',
    '',
    'Fair',
    'Sensitivity',
    '',
    'Mediocre',
    'Sensitivity',
  ],
  columns: ['MAD', 'Sim. MAD', 'CFI', 'RMSEA', '90% CI'],
  cells: [
    ['0.00', '0.00', '0.989', '0.036', '0.063'],
    ['', '', '95%', '95%', ''],
    ['', '', '', '', ''],
    ['0.038', '0.032', '0.989', '0.036', '0.063'],
    ['', '', '88%', '87%', ''],
    ['', '', '', '', ''],
    ['0.05', '0.047', '0.967', '0.067', '0.09'],
    ['', '', '95%', '95%', ''],
    ['', '', '', '', ''],
    ['0.06', '0.054', '0.955', '0.072', '0.095'],
    ['', '', '95%', '95%', ''],
  ],
};
const engine = { package: 'dynamic', version: '1.1.0', lavaan: '0.7-3' };
const result = (over: Partial<DfiResult>): DfiResult => ({
  fn: 'cfaHB',
  reps: 500,
  n: 301,
  estimator: null,
  scale: null,
  cutoffs: CFAHB,
  fit: FIT6,
  data: null,
  equiv: null,
  printed: ['Your DFI cutoffs:'],
  warnings: [],
  engine,
  ...over,
});

describe('reading dynamic’s tables', () => {
  it('turns printed cells into numbers, NONE / -- / percentages into none', () => {
    expect(dfiNumber('.039')).toBe(0.039);
    expect(dfiNumber('0.04')).toBe(0.04);
    expect(dfiNumber('42.447')).toBe(42.447);
    for (const s of ['NONE', '--', '', '95%', undefined]) expect(dfiNumber(s)).toBeNull();
  });
  it('finds the levels in the three layouts', () => {
    const hb = dfiLevels(CFAHB);
    expect(hb.map((l) => [l.label, l.kind])).toEqual([
      ['Level 0 (correct model)', 'true'],
      ['Level 1', 'misspec'],
      ['Level 2', 'misspec'],
    ]);
    expect(hb[2]).toMatchObject({ srmr: 0.06, rmsea: 0.086, cfi: 0.957, magnitude: '0.57' });
    expect(dfiLevels(HIER).map((l) => l.label)).toEqual([
      'Level 1 (95/5)',
      'Level 1 (90/10)',
      'Level 2 (95/5)',
      'Level 2 (90/10)',
    ]);
    expect(dfiLevels(HIER)[0]).toMatchObject({ srmr: 0.039, rmsea: null, cfi: null });
    expect(dfiLevels(DDDFI).map((l) => [l.label, l.kind, l.rmsea, l.rmseaHigh])).toEqual([
      ['Consistent (correct model)', 'true', 0.036, 0.063],
      ['Close', 'misspec', 0.036, 0.063],
      ['Fair', 'misspec', 0.067, 0.09],
      ['Mediocre', 'misspec', 0.072, 0.095],
    ]);
    expect(dfiLevels(EXACT).map((l) => [l.label, l.kind, l.chisq])).toEqual([
      ['99th percentile', 'exact', 42.447],
      ['95th percentile', 'exact', 36.553],
    ]);
    expect(dfiLevels(null)).toEqual([]);
  });
  it('reads the model’s indices in the package’s column order, six or seven values', () => {
    expect(dfiEmpirical(FIT6)).toEqual({
      chisq: 85.306,
      df: 24,
      p: 0,
      srmr: 0.065,
      rmsea: 0.092,
      cfi: 0.931,
      rmseaHigh: null,
    });
    expect(dfiEmpirical(FIT7)).toEqual({
      chisq: 85.306,
      df: 24,
      p: 0,
      srmr: 0.065,
      cfi: 0.931,
      rmsea: 0.092,
      rmseaHigh: 0.114,
    });
    expect(dfiEmpirical(null)).toBeNull();
  });
});

describe('the verdicts', () => {
  it('say which level each index clears (Holzinger & Swineford clears none with cfaHB, as the vignette reads it)', () => {
    const v = dfiVerdicts(result({}));
    expect(v.map((x) => x.index)).toEqual(['SRMR', 'RMSEA', 'CFI']);
    expect(v[0]).toMatchObject({ value: 0.065, ok: false });
    expect(v[0].verdict).toMatch(
      /^SRMR \.065 is above every cutoff \(Level 1 \.041, Level 2 \.060\): .*poor$/,
    );
    expect(v[0].short).toBe('clears no level');
    expect(dfiCutoffText(v[0])).toBe('L1 .041 · L2 .060');
    expect(v[2].verdict).toMatch(/^CFI .* is below every cutoff/);
    const good = dfiVerdicts(
      result({ fit: { ...FIT6, cells: [['20', '24', '0.7', '0.03', '0.02', '0.995']] } }),
    );
    expect(good.map((x) => x.ok)).toEqual([true, true, true]);
    expect(good[0].verdict).toMatch(
      /on the good side of the Level 1 cutoff \(\.041\), the mildest misspecification tested: consistent with a correctly specified model/,
    );
    expect(good[0].short).toBe('clears Level 1');
    const middle = dfiVerdicts(
      result({ fit: { ...FIT6, cells: [['50', '24', '0.1', '0.05', '0.07', '0.97']] } }),
    );
    expect(middle[0].verdict).toBe(
      'SRMR .050 is on the good side of the Level 2 cutoff (.060) but above Level 1 .041: the fit is between those misspecifications',
    );
    expect(middle[0].short).toBe('clears Level 2, not Level 1');
    expect(middle[0].ok).toBeNull();
  });
  it('skips levels without a cutoff and says so', () => {
    const v = dfiVerdicts(result({ fn: 'hier1HB', cutoffs: HIER, fit: FIT7 }));
    const rmsea = v.find((x) => x.index === 'RMSEA')!;
    expect(rmsea.cutoffs.map((k) => k.value)).toEqual([null, 0.045, 0.096, null]);
    expect(rmsea.short).toBe('clears Level 2 (95/5), not Level 1 (90/10)');
    expect(rmsea.verdict).toBe(
      'RMSEA .092 is on the good side of the Level 2 (95/5) cutoff (.096) but above Level 1 (90/10) .045: the fit is between those misspecifications',
    );
    expect(v.find((x) => x.index === 'SRMR')!.verdict).toMatch(
      /is above every cutoff .*: the fit is worse than even the Level 2 \(90\/10\) misspecification tested gives/,
    );
    expect(dfiCutoffText(rmsea)).toBe('L1 NONE · L1 .045 · L2 .096 · L2 NONE');
    const none = dfiVerdicts(
      result({
        cutoffs: { ...CFAHB, cells: CFAHB.cells.map((r) => r.map((x, j) => (j < 3 ? 'NONE' : x))) },
      }),
    );
    expect(none[0].verdict).toMatch(/no cutoff: the fit-index distributions/);
    expect(none[0].ok).toBeNull();
  });
  it('reads exactFit’s percentiles, DDDFI’s discrepancy levels and equivTest’s bins', () => {
    const ex = dfiVerdicts(result({ fn: 'exactFit', cutoffs: EXACT }));
    expect(ex.map((x) => x.index)).toEqual(['χ²', 'SRMR', 'RMSEA', 'CFI']);
    expect(ex[0]).toMatchObject({ value: 85.306, ok: false });
    expect(ex[0].verdict).toMatch(/beyond the 99th percentile/);
    expect(
      dfiVerdicts(
        result({
          fn: 'exactFit',
          cutoffs: EXACT,
          fit: { ...FIT6, cells: [['30', '24', '0.2', '0.03', '0.03', '0.99']] },
        }),
      )[0].verdict,
    ).toMatch(/within the 95th percentile/);
    const dd = dfiVerdicts(
      result({
        fn: 'DDDFI',
        cutoffs: DDDFI,
        fit: {
          ...FIT7,
          columns: ['Chi-Square', 'df', 'p-value', 'SRMR', 'CFI', 'RMSEA', 'RMSEA 90% CI'],
        },
      }),
    );
    expect(dd.map((x) => x.index)).toEqual(['RMSEA', 'CFI']);
    expect(dd[0].cutoffs.map((k) => k.label)).toEqual(['Close', 'Fair', 'Mediocre']);
    expect(dd[0].verdict).toMatch(
      /^RMSEA \.092 is above every cutoff \(Close .*, Fair .*, Mediocre .*\): the fit is worse than even the Mediocre misspecification tested gives, so by this method the fit is poor$/,
    );
    expect(dd[0].short).toBe('clears no level');
    const eq = dfiVerdicts(
      result({
        fn: 'equivTest',
        cutoffs: null,
        equiv: {
          rmsea: '.114',
          cfi: '.87',
          rmseaBins: [
            'Excellent: .048 or below',
            'Close: .048 to .075',
            'Fair: .075 to .103',
            'Mediocre: .103 to .122',
            'Poor: .122 or above',
          ],
          cfiBins: [
            'Excellent: .965 or above',
            'Close: .906 to .965',
            'Fair: .864 to .906',
            'Mediocre: .837 to .864',
            'Poor: .837 or below',
          ],
        },
      }),
    );
    expect(eq[0]).toMatchObject({ index: 'RMSEA', value: 0.114, ok: false });
    expect(eq[0].verdict).toMatch(/^mediocre fit/);
    expect(eq[1].verdict).toMatch(/^mediocre fit/);
    expect(
      dfiVerdicts(
        result({
          fn: 'equivTest',
          cutoffs: null,
          equiv: {
            rmsea: '.04',
            cfi: '.97',
            rmseaBins: [
              'Excellent: .048 or below',
              'Close: .048 to .075',
              'Fair: .075 to .103',
              'Mediocre: .103 to .122',
              'Poor: .122 or above',
            ],
            cfiBins: [
              'Excellent: .965 or above',
              'Close: .906 to .965',
              'Fair: .864 to .906',
              'Mediocre: .837 to .864',
              'Poor: .837 or below',
            ],
          },
        }),
      ).map((x) => [x.ok, x.verdict.split(' ')[0]]),
    ).toEqual([
      [true, 'excellent'],
      [true, 'excellent'],
    ]);
  });
});

describe('the view', () => {
  it('shows the package’s table, the model against it, the distributions and the printed output', () => {
    const data = {
      names: [
        'SRMR_L0',
        'SRMR_L1',
        'SRMR_L2',
        'RMSEA_L0',
        'RMSEA_L1',
        'RMSEA_L2',
        'CFI_L0',
        'CFI_L1',
        'CFI_L2',
      ],
      cols: Array.from({ length: 9 }, (_, k) =>
        Array.from({ length: 50 }, (_, i) => 0.02 + 0.001 * i + 0.01 * k),
      ),
    };
    const html = renderToStaticMarkup(
      <DfiView r={result({ data, printed: ['Your DFI cutoffs:', 'Level-0 0.04'] })} />,
    );
    expect(html).toContain('Dynamic fit index cutoffs: dynamic::cfaHB');
    for (const s of [
      'Level-1',
      '0.424',
      'Sensitivity',
      '85%',
      'This model against the dynamic cutoffs',
      'L1 .041 · L2 .060',
      'clears no level',
      'Distributions of the fit indices (2 levels)',
      'As printed by dynamic',
      '500 replications per level, N = 301',
      'dynamic 1.1.0',
    ])
      expect(html).toContain(s);
    expect(html.match(/role="img"/g)?.length).toBe(6);
    const eq = renderToStaticMarkup(
      <DfiView
        r={result({
          fn: 'equivTest',
          reps: null,
          cutoffs: null,
          data: null,
          equiv: {
            rmsea: '.114',
            cfi: '.87',
            rmseaBins: [
              'Excellent: .048 or below',
              'Close: .048 to .075',
              'Fair: .075 to .103',
              'Mediocre: .103 to .122',
              'Poor: .122 or above',
            ],
            cfiBins: [
              'Excellent: .965 or above',
              'Close: .906 to .965',
              'Fair: .864 to .906',
              'Mediocre: .837 to .864',
              'Poor: .837 or below',
            ],
          },
        })}
      />,
    );
    for (const s of [
      'T-size RMSEA and CFI',
      '.114',
      '.906 to .965',
      'mediocre fit',
      'Equivalence testing, N = 301',
    ])
      expect(eq).toContain(s);
    const ex = renderToStaticMarkup(
      <DfiView
        r={result({
          fn: 'exactFit',
          cutoffs: EXACT,
          data: {
            names: ['chisq', 'df', 'srmr', 'rmsea', 'cfi'],
            cols: Array.from({ length: 5 }, () => Array.from({ length: 30 }, (_, i) => 20 + i)),
          },
        })}
      />,
    );
    expect(ex).toContain('95th percentile');
    expect(ex.match(/role="img"/g)?.length).toBe(4);
  });
  it('renders its options form for a model, with the functions that do not fit disabled', () => {
    const html = renderToStaticMarkup(
      <card.Options options={opts('cfaHB')} set={() => {}} ctx={ctx(three)} disabled={false} />,
    );
    expect(html).toContain('Suggested function: cfaHB');
    expect(html).toMatch(
      /<option value="cfaOne" disabled=""[^>]*>cfaOne — one-factor CFA \(does not fit this model\)/,
    );
    expect(html).toMatch(/<option value="cfaHB"[^>]*>cfaHB — multi-factor CFA \(suggested\)/);
    expect(html).toContain('Replications per level');
    expect(
      renderToStaticMarkup(
        <card.Options options={opts('DDDFI')} set={() => {}} ctx={ctx(three)} disabled={false} />,
      ),
    ).toContain('Mean absolute discrepancies');
    expect(
      renderToStaticMarkup(
        <card.Options
          options={opts('equivTest')}
          set={() => {}}
          ctx={ctx(three)}
          disabled={false}
        />,
      ),
    ).not.toContain('Replications per level');
  });
});
