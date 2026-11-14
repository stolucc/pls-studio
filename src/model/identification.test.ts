import { describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import {
  betweenParameterCount,
  isolatedTwoIndicatorFactor,
  parameterCount,
} from './identification';
import {
  DEFAULT_SETTINGS,
  validateModel,
  type Construct,
  type ModelState,
  type Settings,
} from './project';

const C = (id: string, indicators: string[], extra: Partial<Construct> = {}): Construct => ({
  id,
  name: id,
  type: 'factor',
  mode: 'A',
  indicators,
  x: 0,
  y: 0,
  side: 'left',
  ...extra,
});
const model = (constructs: Construct[], extra: Partial<ModelState> = {}): ModelState => ({
  constructs,
  paths: [],
  moderations: [],
  ...extra,
});
const data = (names: string[], n = 200, f = (k: number, i: number) => Math.sin(i * (k + 1.3))) => ({
  names,
  cols: names.map((_, k) => Float64Array.from({ length: n }, (_, i) => f(k, i))),
});
const cb: Settings = { ...DEFAULT_SETTINGS, method: 'cbsem', engine: 'r', estimator: 'ML' };
const issues = (m: ModelState, d: Dataset | null, s: Settings = cb) =>
  validateModel(m, d, s).map((i) => `${i.level}: ${i.message}`);
const HS = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9'];
const corr = (a: string, b: string) => ({ id: `${a}${b}`, kind: 'construct' as const, a, b });

describe('two indicators per factor (Bollen 1989)', () => {
  it('an isolated two-indicator factor is not identified: an error', () => {
    const m = model([C('F', ['x1', 'x2', 'x3']), C('G', ['x4', 'x5'])], {
      correlations: [{ ...corr('F', 'G'), zero: true }],
    });
    expect(isolatedTwoIndicatorFactor(m, m.constructs[1])).toBe(true);
    const out = issues(m, data(HS));
    expect(
      out.some((t) => t.startsWith('error: "G" has two indicators and no path or correlation')),
    ).toBe(true);
  });

  it('correlated with another factor it is identified through that relation: the existing warning', () => {
    const m = model([C('F', ['x1', 'x2', 'x3']), C('G', ['x4', 'x5'])], {
      correlations: [corr('F', 'G')],
    });
    expect(isolatedTwoIndicatorFactor(m, m.constructs[1])).toBe(false);
    expect(issues(m, data(HS))).toContain(
      'warning: "G" has two indicators; it is only identified through its relations with other factors.',
    );
  });

  it('a path, equal loadings (one label) or an error correlation also count; a covariate does not apply', () => {
    const base = [C('F', ['x1', 'x2', 'x3']), C('G', ['x4', 'x5'])];
    const path = model(base, { paths: [{ id: 'p', from: 'F', to: 'G' }] });
    expect(isolatedTwoIndicatorFactor(path, path.constructs[1])).toBe(false);
    const equal = model([base[0], C('G', ['x4', 'x5'], { loadingLabels: { x4: 'a', x5: 'a' } })]);
    expect(isolatedTwoIndicatorFactor(equal, equal.constructs[1])).toBe(false);
    const errors = model(base, {
      correlations: [{ id: 'e', kind: 'indicator', a: 'x5', b: 'x1' }],
    });
    expect(isolatedTwoIndicatorFactor(errors, errors.constructs[1])).toBe(false);
    const three = model([C('F', ['x1', 'x2', 'x3'])]);
    expect(isolatedTwoIndicatorFactor(three, three.constructs[0])).toBe(false);
  });
});

describe('second-order factors (Rindskopf & Rose 1988)', () => {
  it('warns for two first-order factors, not for three', () => {
    const two = model([
      C('A', ['x1', 'x2', 'x3']),
      C('B', ['x4', 'x5', 'x6']),
      C('H', [], { components: ['A', 'B'] }),
    ]);
    expect(
      issues(two, data(HS)).some((t) => t.includes('"H" is a second-order factor on two')),
    ).toBe(true);
    const three = model([
      C('A', ['x1', 'x2', 'x3']),
      C('B', ['x4', 'x5', 'x6']),
      C('D', ['x7', 'x8', 'x9']),
      C('H', [], { components: ['A', 'B', 'D'] }),
    ]);
    expect(issues(three, data(HS)).some((t) => t.includes('second-order factor on two'))).toBe(
      false,
    );
  });
});

describe('degrees of freedom (the t-rule)', () => {
  it('counts lavaan’s free parameters: the ?cfa model has 21 for 45 moments (lavaan: npar 21, df 24)', () => {
    const m = model(
      [
        C('visual', ['x1', 'x2', 'x3']),
        C('textual', ['x4', 'x5', 'x6']),
        C('speed', ['x7', 'x8', 'x9']),
      ],
      {
        correlations: [
          corr('visual', 'textual'),
          corr('visual', 'speed'),
          corr('textual', 'speed'),
        ],
      },
    );
    expect(parameterCount(m)).toEqual({ free: 21, moments: 45 });
    expect(issues(m, data(HS)).filter((t) => t.includes('free parameters'))).toEqual([]);
  });

  it('more free parameters than moments is an error', () => {
    // One factor on three indicators with all three error covariances: 9 parameters for 6 moments.
    const m = model([C('F', ['x1', 'x2', 'x3'])], {
      correlations: [
        { id: 'a', kind: 'indicator', a: 'x1', b: 'x2' },
        { id: 'b', kind: 'indicator', a: 'x1', b: 'x3' },
        { id: 'c', kind: 'indicator', a: 'x2', b: 'x3' },
      ],
    });
    expect(parameterCount(m)).toEqual({ free: 9, moments: 6 });
    expect(issues(m, data(['x1', 'x2', 'x3']))).toContain(
      'error: The model has 9 free parameters but only 6 variances and covariances to estimate them from (df = -3): it is not identified (Bollen, 1989, the t-rule). Remove paths or correlations, or add indicators.',
    );
  });

  it('is not counted for models outside the plain case (groups, mean structure, labels)', () => {
    const m = model([C('F', ['x1', 'x2', 'x3'])], {
      multigroup: { column: 'g', invariance: 'configural', free: [] },
    });
    expect(parameterCount(m)).toBeNull();
  });
});

describe('two-level models: clusters against between-level parameters', () => {
  const twoLevel = (between: 'same' | 'saturated' | 'factors') =>
    model([C('F', ['x1', 'x2', 'x3'])], {
      multilevel: {
        column: 'cl',
        between,
        ...(between === 'factors' ? { betweenCovariates: ['w'] } : {}),
      },
    });
  it('counts the between level: saturated, the same factor model, the factors model', () => {
    // Saturated: 3·4/2 covariances + 3 intercepts.
    expect(betweenParameterCount(twoLevel('saturated'))).toBe(9);
    // The same one-factor model: 2 loadings + 3 residual variances + 1 factor variance + 3 intercepts.
    expect(betweenParameterCount(twoLevel('same'))).toBe(9);
    // The factors model: as 'same', plus the factor's regression on w.
    expect(betweenParameterCount(twoLevel('factors'))).toBe(10);
  });

  it('warns with fewer clusters than between-level parameters', () => {
    const names = ['x1', 'x2', 'x3', 'cl'];
    const few = data(names, 240, (k, i) =>
      k === 3 ? 1 + (i % 6) : Math.sin(i * (k + 1.3)) + (i % (k + 2)),
    );
    const out = issues(twoLevel('saturated'), few);
    expect(
      out.some((t) => t.startsWith('warning: 6 clusters for about 9 between-level parameters')),
    ).toBe(true);
    const many = data(names, 240, (k, i) =>
      k === 3 ? 1 + (i % 40) : Math.sin(i * (k + 1.3)) + (i % (k + 2)),
    );
    expect(
      issues(twoLevel('saturated'), many).some((t) => t.includes('between-level parameters')),
    ).toBe(false);
  });
});

describe('WLSMV without ordinal indicators', () => {
  it('warns (lavaan then fits the data as continuous), not when items are ordinal or the engine refuses WLSMV', () => {
    const m = model([C('F', ['x1', 'x2', 'x3'])]);
    const wlsmv: Settings = { ...cb, estimator: 'WLSMV' };
    expect(
      issues(m, data(['x1', 'x2', 'x3']), wlsmv).some((t) =>
        t.includes('no indicator is marked ordinal'),
      ),
    ).toBe(true);
    const ordinal = { ...m, ordered: ['x1', 'x2', 'x3'] };
    expect(
      issues(
        ordinal,
        data(['x1', 'x2', 'x3'], 200, (_k, i) => (i % 3) + 1),
        wlsmv,
      ).some((t) => t.includes('no indicator is marked ordinal')),
    ).toBe(false);
    expect(
      issues(m, data(['x1', 'x2', 'x3']), { ...wlsmv, engine: 'builtin' }).some((t) =>
        t.includes('no indicator is marked ordinal'),
      ),
    ).toBe(false);
  });
});
