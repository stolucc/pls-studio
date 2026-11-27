// The Troubleshoot checks (troubleshoot.ts) on small simulated datasets: each common cause of nonconvergence
// is flagged, with the variables involved, and a clean two-factor model passes every check.
import { describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import { DEFAULT_SETTINGS, type Construct, type ModelState, type Settings } from './project';
import type { CbEstimate } from '../engine/cbsem';
import { cbResult } from '../reporting/fixtures';
import { makeEmseExample } from '../examples/emse';
import { validateModel } from './validate';
import {
  applyRemedy,
  findings,
  rescaleDivisor,
  rescaleMoments,
  swapRescaled,
  triedOptions,
  troubleshoot,
  type Remedy,
  type TroubleCheck,
} from './troubleshoot';

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
  correlations: [{ kind: 'construct', a: 'F1', b: 'F2' }] as ModelState['correlations'],
  ...extra,
});
const CB: Settings = { ...DEFAULT_SETTINGS, method: 'cbsem', estimator: 'ML', missing: 'fiml' };

/** A seeded standard normal generator (LCG + Box–Muller), so the datasets are the same every run. */
function normals(seed: number) {
  let s = seed;
  const u = () => ((s = (s * 1664525 + 1013904223) % 4294967296) + 0.5) / 4294967296;
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

/** Two correlated factors with three indicators each (loadings .7), n cases. */
function twoFactors(n: number, seed = 1): Dataset {
  const z = normals(seed);
  const names = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'];
  const cols = names.map(() => new Float64Array(n));
  for (let k = 0; k < n; k++) {
    const f1 = z(),
      f2 = 0.4 * f1 + Math.sqrt(1 - 0.16) * z();
    for (let i = 0; i < 6; i++) cols[i][k] = 0.7 * (i < 3 ? f1 : f2) + Math.sqrt(1 - 0.49) * z();
  }
  return { names, cols };
}
const TWO = model([C('F1', ['a1', 'a2', 'a3']), C('F2', ['b1', 'b2', 'b3'])]);
const byId = (checks: TroubleCheck[], id: string) => checks.find((c) => c.id === id)!;

describe('troubleshoot', () => {
  it('a clean two-factor model with 300 cases: nothing to act on', () => {
    const checks = troubleshoot(TWO, twoFactors(300), CB);
    expect(findings(checks)).toEqual([]);
    expect(checks.map((c) => c.id)).toEqual([
      'identification',
      'fixed-values',
      'scale',
      'constant',
      'collinearity',
      'sample-size',
      'coverage',
      'ordinal',
      'weak-items',
    ]);
    expect(byId(checks, 'ordinal').status).toBe('skipped');
  });

  it('applies to CB-SEM only, not to PLS or MIIV-2SLS', () => {
    expect(troubleshoot(TWO, twoFactors(50), { ...CB, method: 'pls' })).toEqual([]);
    expect(troubleshoot(TWO, twoFactors(50), { ...CB, estimator: '2SLS' })).toEqual([]);
  });

  it('without data: the specification checks only', () => {
    expect(troubleshoot(TWO, null, CB).map((c) => c.id)).toEqual([
      'identification',
      'fixed-values',
    ]);
  });

  it('variances 1000 times apart are a problem, naming the largest and smallest', () => {
    const d = twoFactors(300);
    d.cols[1] = d.cols[1].map((x) => x * 100);
    const scale = byId(troubleshoot(TWO, d, CB), 'scale');
    expect(scale.status).toBe('problem');
    expect(scale.variables?.[0]).toBe('a2');
    d.cols[1] = d.cols[1].map((x) => x / 20);
    expect(byId(troubleshoot(TWO, d, CB), 'scale').status).toBe('check');
  });

  it('an indicator entered twice makes the matrix singular, and both copies are named', () => {
    const d = twoFactors(300);
    d.names.push('a1copy');
    d.cols.push(d.cols[0].slice());
    const m = model([C('F1', ['a1', 'a2', 'a3', 'a1copy']), C('F2', ['b1', 'b2', 'b3'])]);
    const col = byId(troubleshoot(m, d, CB), 'collinearity');
    expect(col.status).toBe('problem');
    expect(col.variables).toEqual(expect.arrayContaining(['a1', 'a1copy']));
    expect(col.variables).not.toContain('b1');
  });

  it('a sum score next to its own items is linearly dependent', () => {
    const d = twoFactors(300);
    d.names.push('asum');
    d.cols.push(d.cols[0].map((x, k) => x + d.cols[1][k] + d.cols[2][k]));
    const m = model([C('F1', ['a1', 'a2', 'a3', 'asum']), C('F2', ['b1', 'b2', 'b3'])]);
    const col = byId(troubleshoot(m, d, CB), 'collinearity');
    expect(col.status).toBe('problem');
    expect(col.finding).toMatch(/not positive definite/);
    expect(col.variables).toEqual(expect.arrayContaining(['a1', 'a2', 'a3', 'asum']));
  });

  it('a constant indicator is a problem; one value in 95% of cases is a check', () => {
    const d = twoFactors(200);
    d.cols[2] = new Float64Array(200).fill(3);
    expect(byId(troubleshoot(TWO, d, CB), 'constant')).toMatchObject({
      status: 'problem',
      variables: ['a3'],
    });
    d.cols[2] = Float64Array.from({ length: 200 }, (_, k) => (k < 195 ? 3 : 4));
    expect(byId(troubleshoot(TWO, d, CB), 'constant').status).toBe('check');
  });

  it('cases per free parameter: 30 cases for 13 parameters is a problem, 100 a check, 300 clear', () => {
    expect(byId(troubleshoot(TWO, twoFactors(30), CB), 'sample-size')).toMatchObject({
      status: 'problem',
      finding: expect.stringMatching(/30 cases for 13 free parameters/),
    });
    expect(byId(troubleshoot(TWO, twoFactors(100), CB), 'sample-size').status).toBe('check');
    expect(byId(troubleshoot(TWO, twoFactors(300), CB), 'sample-size').status).toBe('clear');
  });

  it('missing data: a pair observed together in under 10% of cases under FIML; listwise keeping under half is a check', () => {
    const d = twoFactors(300);
    // (a1 asked of the first half, b1 of the second, but for 10 cases)
    for (let k = 0; k < 300; k++) {
      if (k >= 150) d.cols[0][k] = NaN;
      if (k < 140) d.cols[3][k] = NaN;
    }
    expect(byId(troubleshoot(TWO, d, CB), 'coverage')).toMatchObject({
      status: 'problem',
      variables: ['a1', 'b1'],
    });
    expect(byId(troubleshoot(TWO, d, { ...CB, missing: 'casewise' }), 'coverage').status).toBe(
      'check',
    );
    // (the cases per parameter then count complete cases only)
    expect(
      byId(troubleshoot(TWO, d, { ...CB, missing: 'casewise' }), 'sample-size').finding,
    ).toMatch(/^10 complete cases/);
  });

  it('an indicator unrelated to its factor is weak; a factor of unrelated indicators is a problem', () => {
    const d = twoFactors(2000);
    const z = normals(7);
    d.cols[2] = Float64Array.from({ length: 2000 }, () => z());
    const weak = byId(troubleshoot(TWO, d, CB), 'weak-items');
    expect(weak).toMatchObject({ status: 'check', variables: ['a3 (F1)'] });
    for (const i of [0, 1]) d.cols[i] = Float64Array.from({ length: 2000 }, () => z());
    expect(byId(troubleshoot(TWO, d, CB), 'weak-items')).toMatchObject({
      status: 'problem',
      variables: ['F1'],
    });
  });

  it('ordinal indicators: rare categories and empty cells of two-way tables', () => {
    const d = twoFactors(300);
    const cut = (x: number) => (x < -2.5 ? 1 : x < 0 ? 2 : 3);
    for (const i of [0, 1, 2]) d.cols[i] = d.cols[i].map(cut);
    const ord = byId(troubleshoot(TWO, d, { ...CB, estimator: 'WLSMV' } as Settings), 'ordinal');
    expect(ord.status).toBe('skipped');
    const m = { ...TWO, ordered: ['a1', 'a2', 'a3'] };
    const checked = byId(troubleshoot(m, d, CB), 'ordinal');
    expect(checked.status).toBe('check');
    expect(checked.finding).toMatch(/fewer than 5 cases/);
  });

  it('identification: an isolated factor with two indicators is a problem, named, with the rule’s message', () => {
    const m = model([C('F1', ['a1', 'a2', 'a3']), C('F2', ['b1', 'b2'])], {
      correlations: [
        { kind: 'construct', a: 'F1', b: 'F2', zero: true },
      ] as ModelState['correlations'],
    });
    const id = byId(troubleshoot(m, twoFactors(300), CB), 'identification');
    expect(id).toMatchObject({ status: 'problem', variables: ['F2'] });
    expect(id.finding).toMatch(/"F2" has two indicators and no path or correlation/);
  });

  it('fixed loadings and paths are listed as a note', () => {
    const m = model([
      C('F1', ['a1', 'a2', 'a3'], { fixedLoadings: { a2: 0.5 } }),
      C('F2', ['b1', 'b2', 'b3']),
    ]);
    m.paths = [{ id: 'p', from: 'F1', to: 'F2', fixed: 2 }];
    const fixed = byId(troubleshoot(m, null, CB), 'fixed-values');
    expect(fixed.status).toBe('note');
    expect(fixed.finding).toMatch(/F1 → a2 = 0\.5.*F1 → F2 = 2/);
  });

  it('a group with fewer cases than indicators is a problem', () => {
    const d = twoFactors(300);
    d.names.push('g');
    d.cols.push(Float64Array.from({ length: 300 }, (_, k) => (k < 5 ? 2 : 1)));
    const m = {
      ...TWO,
      multigroup: { column: 'g', invariance: 'configural', free: [] },
    } as ModelState;
    expect(byId(troubleshoot(m, d, CB), 'groups')).toMatchObject({
      status: 'problem',
      variables: ['2'],
    });
  });

  it('a covariance-matrix dataset: the checks that need raw data are skipped', () => {
    const S = [
      [1, 0.5, 0.5],
      [0.5, 1, 0.5],
      [0.5, 0.5, 1],
    ];
    const d: Dataset = { names: ['a1', 'a2', 'a3'], cols: [], moments: { S, n: 200 } };
    const m = model([C('F1', ['a1', 'a2', 'a3'])], { correlations: [] });
    // (FIML needs raw data: the model checks would say so)
    const checks = troubleshoot(m, d, { ...CB, missing: 'casewise' });
    expect(byId(checks, 'constant').status).toBe('skipped');
    expect(byId(checks, 'coverage').status).toBe('skipped');
    expect(byId(checks, 'collinearity').status).toBe('clear');
    expect(findings(checks)).toEqual([]);
  });
});

describe('remedies: changes the user can choose, applied only when they do', () => {
  const kinds = (c: TroubleCheck) => (c.remedies ?? []).map((r) => r.remedy.kind);

  it('rescaling: a power of ten that brings a variance near the others, as a new computed column', () => {
    expect(rescaleDivisor(10000, 1)).toBe(100);
    expect(rescaleDivisor(500, 1)).toBe(10);
    expect(rescaleDivisor(5, 1)).toBeNull();
    const d = twoFactors(300);
    d.cols[1] = d.cols[1].map((x) => x * 100);
    const scale = byId(troubleshoot(TWO, d, CB), 'scale');
    expect(scale.remedies?.map((r) => r.remedy)).toEqual([
      { kind: 'rescale', variable: 'a2', divisor: 100, name: 'a2_div100' },
    ]);
    // (not offered once that column exists, nor for a covariance matrix)
    d.names.push('a2_div100');
    d.cols.push(d.cols[1].map((x) => x / 100));
    expect(byId(troubleshoot(TWO, d, CB), 'scale').remedies).toBeUndefined();
  });

  it('a duplicated indicator: removing the copy from its factor; nothing for the data checks that found nothing', () => {
    const d = twoFactors(300);
    d.names.push('a1copy');
    d.cols.push(d.cols[0].slice());
    const m = model([C('F1', ['a1', 'a2', 'a3', 'a1copy']), C('F2', ['b1', 'b2', 'b3'])]);
    const checks = troubleshoot(m, d, CB);
    const drop = byId(checks, 'collinearity').remedies!;
    expect(drop.map((r) => r.remedy)).toEqual([
      { kind: 'drop-indicator', constructId: 'F1', indicator: 'a1copy' },
    ]);
    expect(drop[0].label).toBe('Remove a1copy from F1');
    const out = applyRemedy(drop[0].remedy as Exclude<Remedy, { kind: 'rescale' }>, m);
    expect(out.model.constructs[0].indicators).toEqual(['a1', 'a2', 'a3']);
    expect(checks.filter((c) => c.status === 'clear').every((c) => !c.remedies)).toBe(true);
  });

  it('missing data: FIML for listwise deletion that keeps under half the cases, as a settings change', () => {
    const d = twoFactors(300);
    for (let k = 0; k < 200; k++) d.cols[k % 6][k] = NaN;
    const cov = byId(troubleshoot(TWO, d, { ...CB, missing: 'casewise' }), 'coverage');
    expect(kinds(cov)).toEqual(['fiml']);
    expect(applyRemedy({ kind: 'fiml' }, TWO)).toEqual({
      model: TWO,
      settings: { missing: 'fiml' },
    });
  });

  it('a weak marker: scaling its factor by the variance instead', () => {
    const d = twoFactors(2000);
    const z = normals(9);
    d.cols[0] = Float64Array.from({ length: 2000 }, () => z());
    const weak = byId(troubleshoot(TWO, d, CB), 'weak-items');
    expect(weak.remedies?.map((r) => r.remedy)).toEqual([
      { kind: 'variance-scaling', constructId: 'F1' },
    ]);
    const out = applyRemedy({ kind: 'variance-scaling', constructId: 'F1' }, TWO);
    expect(out.model.constructs[0].scaling).toBe('variance');
    // (a weak item that is not the marker leaves the scaling alone)
    const d2 = twoFactors(2000);
    d2.cols[2] = Float64Array.from({ length: 2000 }, () => z());
    expect(byId(troubleshoot(TWO, d2, CB), 'weak-items').remedies).toBeUndefined();
  });

  it('a fit that did not converge: lavaan’s simple starting values and the BFGS optimiser, each until switched on', () => {
    const failed = { ...cbResult(), converged: false, iterations: 1000 };
    const fit = byId(troubleshoot(TWO, twoFactors(300), CB, failed), 'convergence');
    expect(fit.status).toBe('problem');
    expect(kinds(fit)).toEqual(['start-simple', 'optimizer']);
    const started = applyRemedy({ kind: 'start-simple' }, TWO).model;
    expect(started.startValues).toBe('simple');
    expect(kinds(byId(troubleshoot(started, twoFactors(300), CB, failed), 'convergence'))).toEqual([
      'optimizer',
    ]);
    expect(applyRemedy({ kind: 'optimizer' }, started).model.optimizer).toBe('BFGS');
    // (the built-in engine has neither: the advice says to calculate with lavaan)
    const builtin = byId(
      troubleshoot(TWO, twoFactors(300), { ...CB, engine: 'builtin' }, failed),
      'convergence',
    );
    expect(builtin.remedies).toBeUndefined();
    expect(builtin.advice).toMatch(/lavaan/);
    // (no result: no convergence check at all)
    expect(troubleshoot(TWO, twoFactors(300), CB).some((c) => c.id === 'convergence')).toBe(false);
  });

  it('a converged fit with a negative variance: keeping variances at zero or above', () => {
    const base = cbResult();
    const v = base.estimates.find((e) => e.op === '~~' && e.lhs === e.rhs)!;
    const negative: CbEstimate = { ...v, est: -0.3, se: 0.05 };
    const cb = {
      ...base,
      estimates: base.estimates.map((e) => (e === v ? negative : e)),
    };
    const fit = byId(troubleshoot(TWO, twoFactors(300), CB, cb), 'convergence');
    expect(fit).toMatchObject({ status: 'check', variables: [v.lhs] });
    expect(kinds(fit)).toEqual(['positive-variances']);
    expect(byId(troubleshoot(TWO, twoFactors(300), CB, base), 'convergence').status).toBe('clear');
  });

  it('the options switched on are listed, and the built-in engine is told it ignores lavaan’s', () => {
    const m = { ...TWO, startValues: 'simple' as const, optimizer: 'BFGS' as const };
    expect(triedOptions(m).map((t) => t.key)).toEqual(['startValues', 'optimizer']);
    expect(triedOptions(TWO)).toEqual([]);
    const issues = validateModel(m, twoFactors(300), { ...CB, engine: 'builtin' });
    expect(issues.some((i) => /Troubleshoot tab are lavaan’s/.test(i.message))).toBe(true);
    expect(
      validateModel(m, twoFactors(300), CB).some((i) => /Troubleshoot tab/.test(i.message)),
    ).toBe(false);
  });
});

describe('rescaling a covariance-matrix dataset', () => {
  /** S (N − 1) and the NACOV of the covariances (column-major vech; the mean of products of centred products). */
  function momentsOf(cols: Float64Array[]) {
    const p = cols.length,
      n = cols[0].length;
    const mean = cols.map((c) => c.reduce((t, x) => t + x, 0) / n);
    const S = cols.map((a, i) =>
      cols.map((b, j) => a.reduce((t, x, k) => t + (x - mean[i]) * (b[k] - mean[j]), 0) / (n - 1)),
    );
    const pairs: [number, number][] = [];
    for (let j = 0; j < p; j++) for (let i = j; i < p; i++) pairs.push([i, j]);
    const d = pairs.map(([i, j]) =>
      Array.from({ length: n }, (_, k) => (cols[i][k] - mean[i]) * (cols[j][k] - mean[j])),
    );
    const dm = d.map((x) => x.reduce((t, v) => t + v, 0) / n);
    const nacov = d.map((a, x) =>
      d.map((b, y) => a.reduce((t, v, k) => t + (v - dm[x]) * (b[k] - dm[y]), 0) / n),
    );
    return { S, n, nacov, means: mean };
  }

  it('adds the rescaled variable as computing it from raw data would: S, means and the NACOV', () => {
    const raw = twoFactors(200).cols.slice(0, 3);
    raw[1] = raw[1].map((x) => 50 * x + 3);
    const before: Dataset = { names: ['a1', 'a2', 'a3'], cols: [], moments: momentsOf(raw) };
    const after = rescaleMoments(before, 'a2', 10, 'a2_div10');
    // (the original variables first, unchanged, then the new one: a computed column of the four)
    const want = momentsOf([...raw, raw[1].map((x) => x / 10)]);
    expect(after.names).toEqual(['a1', 'a2', 'a3', 'a2_div10']);
    const close = (a: number[][], b: number[][]) => {
      expect(a.length).toBe(b.length);
      // (relative: NACOV entries run into the millions)
      a.forEach((row, i) =>
        row.forEach((x, j) =>
          expect(Math.abs(x - b[i][j])).toBeLessThanOrEqual(1e-10 * Math.max(1, Math.abs(b[i][j]))),
        ),
      );
    };
    close(after.moments!.S, want.S);
    close(after.moments!.nacov!, want.nacov);
    after.moments!.means!.forEach((x, i) => expect(x).toBeCloseTo(want.means[i], 10));
    expect(() => rescaleMoments(before, 'zz', 10, 'zz_div10')).toThrow(/not a variable/);
    expect(() => rescaleMoments(after, 'a2', 10, 'a2_div10')).toThrow(/already a variable/);
  });

  it('the gamification example (Stol et al. 2022): rescaling offered for the matrix, the covariate renamed with its column', () => {
    const e = makeEmseExample(DEFAULT_SETTINGS);
    const scale = byId(troubleshoot(e.model, e.data, e.settings), 'scale');
    expect(scale.status).toBe('problem');
    const offered = scale.remedies!.map((r) => r.remedy);
    expect(offered).toContainEqual({
      kind: 'rescale',
      variable: 'num_challenges_solved',
      divisor: 10,
      name: 'num_challenges_solved_div10',
    });
    expect(scale.remedies![0].detail).toMatch(/to the covariance matrix and its NACOV/);
    // (applied: the matrix rescaled, the factor measured by the new variable, the covariate age renamed with its column)
    const data = rescaleMoments(e.data, 'num_challenges_solved', 10, 'num_challenges_solved_div10');
    const model = swapRescaled(e.model, 'num_challenges_solved', 'num_challenges_solved_div10');
    const part = model.constructs.find((c) => c.name === 'Gamification participation')!;
    expect(part.indicators).toContain('num_challenges_solved_div10');
    const aged = swapRescaled(e.model, 'age', 'age_div10');
    expect(aged.constructs.find((c) => c.indicators[0] === 'age_div10')!.name).toBe('age_div10');
    expect(byId(troubleshoot(model, data, e.settings), 'scale').finding).not.toMatch(
      /num_challenges_solved,/,
    );
  });
});
