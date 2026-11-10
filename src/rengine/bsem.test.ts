// Bayesian SEM runs in desktop R only: without the helper the bridge refuses
// with advice and never starts R in the browser; the card says the same before
// a run. The native check (scripts/validation/blavaan.R) found the app's result
// equal to a direct blavaan call; its record is checked here.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bsemAnalysis } from '../analyses/bsem';
import type { AnalysisCtx } from '../analyses/types';
import { DEFAULT_SETTINGS, makeCovariancesExplicit, newId, toSpec, type ModelState } from '../model/project';
import { DESKTOP_ONLY, DesktopOnly, R_PACKAGES } from './bridge';
import { bsemPackage, bsemR, bsemRequest, bsemResult, bsemScriptR, type BsemOptions } from './bsem';
import { INLA_PRIOR_DEFAULTS, INLA_PRIOR_TYPES, inlaPrior, parsePriors, printPriors } from '../analyses/bsem';
import { useCompute } from './compute';
import * as runtime from './runtime';

const F = (name: string, indicators: string[]) => ({ id: newId('c'), name, type: 'factor' as const, mode: 'A' as const, indicators, x: 0, y: 0, side: 'left' as const });
const model: ModelState = makeCovariancesExplicit({ constructs: [F('A', ['a1', 'a2', 'a3']), F('B', ['b1', 'b2', 'b3'])], paths: [], moderations: [] });
const data = { names: ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'], cols: Array.from({ length: 6 }, (_, j) => Float64Array.from({ length: 40 }, (_, i) => Math.cos(i * (j + 2)) + (i % 5) / 4)) };
const settings = { ...DEFAULT_SETTINGS, method: 'cbsem' as const };
const ctx = { data, info: null, settings, pls: null, projectName: 'p', model } as unknown as AnalysisCtx;
const opts = { identification: 'unit' as const, chains: 3, burnin: 500, sample: 1000 };

describe('Bayesian SEM in the browser', () => {
  beforeEach(() => useCompute.setState({ backend: 'browser' } as never));
  it('is a desktop-only package, also installed by the helper', () => {
    expect(DESKTOP_ONLY.has('blavaan')).toBe(true);
    expect(R_PACKAGES.blavaan).toContain('blavaan');
    expect(readFileSync(join(__dirname, '..', '..', 'helper', 'r', 'packages.txt'), 'utf8').split('\n')).toContain('blavaan');
  });
  it('is refused with advice, and R in the browser is never started', async () => {
    const spy = vi.spyOn(runtime, 'withR');
    await expect(bsemR(data, toSpec(model), 'casewise', opts, 1234, 0.95)).rejects.toThrow(DesktopOnly);
    await expect(bsemR(data, toSpec(model), 'casewise', opts, 1234, 0.95)).rejects.toThrow(/desktop R.*Choose Desktop R \(helper\)/);
    await expect(bsemScriptR(data, toSpec(model), 'casewise', opts, 1234, 0.95)).rejects.toThrow(/desktop R/);
    expect(spy).not.toHaveBeenCalled();
  });
  it('the card says so before a run, and what else it needs', () => {
    expect(bsemAnalysis.blocked(opts, ctx)).toMatch(/runs in desktop R/);
    useCompute.setState({ backend: 'helper' } as never);
    expect(bsemAnalysis.blocked(opts, ctx)).toBeNull();
    expect(bsemAnalysis.blocked(opts, { ...ctx, settings: { ...settings, method: 'pls' } })).toMatch(/CB-SEM/);
    expect(bsemAnalysis.blocked(opts, { ...ctx, model: { ...model, multilevel: { column: 'a1', between: 'same' } } })).toMatch(/without clusters/);
    expect(bsemAnalysis.blocked(opts, { ...ctx, model: { ...model, constant: { x: 0, y: 0 } } })).toMatch(/marker/);
    expect(bsemAnalysis.blocked({ ...opts, identification: 'marker' }, { ...ctx, model: { ...model, constant: { x: 0, y: 0 } } })).toBeNull();
  });
  it('options from a file: blavaan’s defaults, bounded; a new card in the browser starts with INLAvaan, with desktop R with blavaan', () => {
    expect(bsemAnalysis.defaults(ctx)).toEqual({ engine: 'inlavaan', identification: 'unit', chains: 3, burnin: 500, sample: 1000 });
    useCompute.setState({ backend: 'helper' } as never);
    expect(bsemAnalysis.defaults(ctx)).toEqual({ identification: 'unit', chains: 3, burnin: 500, sample: 1000 });
    useCompute.setState({ backend: 'browser' } as never);
    expect(bsemAnalysis.parseOptions({ identification: 'reference', chains: 99, burnin: 5, sample: 2000 })).toEqual({ identification: 'unit', chains: 8, burnin: 100, sample: 2000 });
    expect(bsemAnalysis.parseOptions(null)).toBeNull();
    const f = bsemAnalysis.fingerprint(opts, ctx);
    expect(bsemAnalysis.fingerprint({ ...opts, chains: 4 }, ctx)).not.toBe(f);
    expect(bsemAnalysis.fingerprint(opts, { ...ctx, settings: { ...settings, seed: 7 } })).not.toBe(f);
  });
});

describe('native check of the help page’s model (desktop R)', () => {
  const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'blavaan', 'reference.json'), 'utf8')) as Record<string, any>;
  it.each(['marker', 'unit'])('%s identification: the app equals blavaan, and converged', (k) => {
    expect(ref[k].identical).toBe(true);
    expect(ref[k].converged).toBe(true);
    expect(ref[k].maxRhat).toBeLessThan(1.01);
    expect(ref[k].parameters).toHaveLength(21);
  });
  it('the two identifications describe the same model (unit loadings = marker loadings × the factor SD)', () => {
    const get = (k: string, lhs: string, op: string, rhs: string) => (ref[k].parameters as { lhs: string; op: string; rhs: string; mean: number }[]).find((p) => p.lhs === lhs && p.op === op && p.rhs === rhs)!.mean;
    const sd = Math.sqrt(get('marker', 'visual', '~~', 'visual'));
    expect(get('unit', 'visual', '=~', 'x2') / (get('marker', 'visual', '=~', 'x2') * sd)).toBeCloseTo(1, 1);
  });
});

describe('the card’s Bayesian options (Mplus’s priors, MODEL PRIORS, approximate invariance, LOOP, plausible values)', () => {
  beforeEach(() => useCompute.setState({ backend: 'helper' } as never));
  const labelled: ModelState = { ...model, constructs: model.constructs.map((k, i) => (i === 0 ? { ...k, loadingLabels: { a2: 'la2', a3: 'la3' } } : k)) };
  const lctx = { ...ctx, model: labelled } as AnalysisCtx;
  it('old saved options are read unchanged, and the new ones only when valid', () => {
    expect(bsemAnalysis.parseOptions({ identification: 'marker', chains: 3, burnin: 500, sample: 1000 })).toEqual({ identification: 'marker', chains: 3, burnin: 500, sample: 1000 });
    const full = { ...opts, priors: 'mplus', labelPriors: [{ labels: ['la2', 'la3'], mean: 0, variance: 0.01 }], wiggle: { what: ['loadings'], variance: 0.01 }, loop: { name: 'ind', expr: 'la2*m', variable: 'm', from: -1, to: 1, by: 0.5 }, plausible: 20 };
    expect(bsemAnalysis.parseOptions(full)).toEqual(full);
    expect(bsemAnalysis.parseOptions({ ...opts, priors: 'jeffreys', labelPriors: [{ labels: ['1x'], mean: 0, variance: 1 }, { labels: ['a'], mean: 0, variance: -1 }], wiggle: { what: ['residuals'], variance: 0.01 }, loop: { name: 'x', expr: 'a', variable: 'm', from: 0, to: 1, by: 0 }, plausible: -3 })).toEqual(opts);
  });
  it('priors written as Mplus’s MODEL PRIORS, with ranges of labels', () => {
    expect(parsePriors('xload1-xload3 ~ N(0, 0.01);\ndir1 dir5 ~ N(0.5,1)')).toEqual([{ labels: ['xload1', 'xload2', 'xload3'], mean: 0, variance: 0.01 }, { labels: ['dir1', 'dir5'], mean: 0.5, variance: 1 }]);
    expect(printPriors(parsePriors('a1-a2 ~ N(0, 0.01)'))).toBe('a1 a2 ~ N(0, 0.01);');
    expect(() => parsePriors('a ~ N(0, 0)')).toThrow(/positive/);
    expect(() => parsePriors('a ~ U(0, 1)')).toThrow(/labels ~ N/);
    expect(() => parsePriors('a3-b1 ~ N(0, 1)')).toThrow(/range/);
  });
  it('the card says what its options need', () => {
    expect(bsemAnalysis.blocked({ ...opts, labelPriors: [{ labels: ['la2', 'zz'], mean: 0, variance: 0.01 }] }, lctx)).toMatch(/zz is not a label/);
    expect(bsemAnalysis.blocked({ ...opts, labelPriors: [{ labels: ['la2'], mean: 0, variance: 0.01 }] }, lctx)).toBeNull();
    expect(bsemAnalysis.blocked({ ...opts, wiggle: { what: ['loadings'], variance: 0.01 } }, lctx)).toMatch(/several groups/);
    const loop = { name: 'ind', expr: 'la2*(1 + m)', variable: 'm', from: -2, to: 2, by: 0.1 };
    expect(bsemAnalysis.blocked({ ...opts, loop }, lctx)).toBeNull();
    expect(bsemAnalysis.blocked({ ...opts, loop: { ...loop, expr: 'la2*q' } }, lctx)).toMatch(/q is not a label/);
    expect(bsemAnalysis.blocked({ ...opts, loop: { ...loop, expr: 'exp(la2)' } }, lctx)).toMatch(/Functions/);
    expect(bsemAnalysis.blocked({ ...opts, loop: { ...loop, by: 0.001 } }, lctx)).toMatch(/1,000 steps/);
  });
  it('the request: the options as R reads them, the loop’s expression printed from its parsed form', () => {
    const req = bsemRequest(data, toSpec(labelled), 'casewise', { ...opts, priors: 'mplus', loop: { name: 'ind', expr: 'la2 *  (1+m)', variable: 'm', from: -2, to: 2, by: 0.1 }, plausible: 5 }, 1, 0.95) as Record<string, any>;
    expect(req.priors).toBe('mplus');
    expect(req.loop.expr).toBe('(la2 * (1 + m))');
    expect(req.plausible).toBe(5);
    expect(req.estimator).toBe('ML');
    const plain = bsemRequest(data, toSpec(model), 'casewise', opts, 1, 0.95) as Record<string, unknown>;
    for (const k of ['priors', 'labelPriors', 'wiggle', 'loop', 'plausible']) expect(plain, k).not.toHaveProperty(k);
  });
  it('the reply: R’s single values and empty lists read as arrays', () => {
    const r = bsemResult({ parameters: { lhs: 'A', op: '=~', rhs: 'a2', mean: 1 }, fit: [], warnings: 'w', defined: [], groups: '1',
      loop: { name: 'ind', variable: 'm', expr: 'a', x: 0, median: 1, mean: 1, sd: 0.1, low: 0.8, high: 1.2 },
      plausible: { draws: 20, cases: 40, factors: 'A', mean: 0.1, cov: [[1]], meanSd: 0.5 } });
    expect(r.parameters).toHaveLength(1);
    expect(r.groups).toEqual(['1']);
    expect(r.loop!.x).toEqual([0]);
    expect(r.plausible!.factors).toEqual(['A']);
    expect(r.plausible!.cov).toEqual([[1]]);
    expect(r.warnings).toEqual(['w']);
  });
});

describe('the INLAvaan engine (approximate Bayesian inference, also in the browser)', () => {
  beforeEach(() => useCompute.setState({ backend: 'browser' } as never));
  const inla = { ...opts, engine: 'inlavaan' as const };
  it('runs in webR: not desktop-only, in the browser’s package lock roots and the helper’s setup', () => {
    expect(DESKTOP_ONLY.has('INLAvaan')).toBe(false);
    expect(R_PACKAGES.INLAvaan).toEqual(['jsonlite', 'lavaan', 'INLAvaan']);
    expect(bsemPackage(inla)).toBe('INLAvaan'); expect(bsemPackage(opts as BsemOptions)).toBe('blavaan');
    expect(readFileSync(join(__dirname, '..', '..', 'helper', 'r', 'packages.txt'), 'utf8').split('\n')).toContain('INLAvaan');
    expect(readFileSync(join(__dirname, '..', '..', 'scripts', 'webr', 'fetch.mjs'), 'utf8')).toMatch(/const ROOTS = \[[^\]]*'INLAvaan'/);
  });
  it('the card runs it in the browser; blavaan there points to it; what INLAvaan does not offer is said before a run', () => {
    expect(bsemAnalysis.blocked(inla, ctx)).toBeNull();
    expect(bsemAnalysis.blocked(opts, ctx)).toMatch(/choose the INLAvaan engine/);
    const groups = { ...ctx, model: { ...model, multigroup: { column: 'a1', invariance: 'metric' as const } } } as AnalysisCtx;
    expect(bsemAnalysis.blocked({ ...inla, wiggle: { what: ['loadings'], variance: 0.01 } }, groups)).toMatch(/not available with INLAvaan/);
    expect(bsemAnalysis.blocked(inla, { ...ctx, settings: { ...settings, missing: 'pairwise' } })).toMatch(/casewise deletion, mean replacement or FIML/);
    expect(bsemAnalysis.blocked(inla, { ...ctx, settings: { ...settings, missing: 'fiml' } })).toBeNull();
    expect(bsemAnalysis.summary(inla)).toMatch(/INLAvaan, 1000 draws/);
  });
  it('default priors by parameter type: INLAvaan’s families, rewritten from their numbers; anything else refused', () => {
    expect(INLA_PRIOR_TYPES.map((t) => inlaPrior(t, INLA_PRIOR_DEFAULTS[t]))).toEqual(['normal(0,10)', 'normal(0,10)', 'normal(0,32)', 'normal(0,10)', 'normal(0,1.5)', 'gamma(1,0.5)[sd]', 'gamma(1,0.5)[sd]', 'beta(1,1)']);
    expect(inlaPrior('lambda', ' normal( -0.5 , 1e-1 ) ')).toBe('normal(-0.5,0.1)');
    expect(inlaPrior('theta', 'gamma(2, 1)[prec]')).toBe('gamma(2,1)[prec]');
    for (const [t, s] of [['lambda', 'gamma(1,1)'], ['rho', 'beta(1,1)[sd]'], ['lambda', 'normal(0,0)'], ['psi', 'gamma(-1,1)'], ['nu', 'normal(0,1); q()'], ['beta', 'normal(0,1)'.padEnd(70)], ['tau', 'normal(0,Inf)']] as const) expect(inlaPrior(t, s), `${t} ${s}`).toBeNull();
  });
  it('options from a file: the engine and default priors only when valid; Mplus’s priors win over priors by type', () => {
    expect(bsemAnalysis.parseOptions({ ...opts, engine: 'inlavaan', defaultPriors: { lambda: 'normal(0, 5)', rho: 'normal(0,1)', bogus: 'normal(0,1)' } })).toEqual({ ...inla, defaultPriors: { lambda: 'normal(0,5)' } });
    expect(bsemAnalysis.parseOptions({ ...opts, engine: 'stan', defaultPriors: { lambda: 'normal(0,5)' } })).toEqual(opts);
    expect(bsemAnalysis.parseOptions({ ...opts, engine: 'inlavaan', priors: 'mplus', defaultPriors: { lambda: 'normal(0,5)' } })).toEqual({ ...inla, priors: 'mplus' });
    const f = bsemAnalysis.fingerprint(opts, ctx);
    expect(bsemAnalysis.fingerprint(inla, ctx)).not.toBe(f);
    expect(bsemAnalysis.fingerprint({ ...inla, defaultPriors: { psi: 'gamma(1,1)' } }, ctx)).not.toBe(bsemAnalysis.fingerprint(inla, ctx));
  });
  it('the request: the engine and default priors go to R with INLAvaan only', () => {
    const req = bsemRequest(data, toSpec(model), 'casewise', { ...inla, defaultPriors: { lambda: 'normal(0,5)' } }, 1, 0.95) as Record<string, unknown>;
    expect(req.engine).toBe('inlavaan'); expect(req.defaultPriors).toEqual({ lambda: 'normal(0,5)' });
    const back = bsemRequest(data, toSpec(model), 'casewise', { ...opts, defaultPriors: { lambda: 'normal(0,5)' } }, 1, 0.95) as Record<string, unknown>;
    expect(back).not.toHaveProperty('engine'); expect(back).not.toHaveProperty('defaultPriors');
  });
  it('the reply: no R-hat, INLAvaan’s diagnostics', () => {
    const r = bsemResult({ parameters: [{ lhs: 'A', op: '=~', rhs: 'a2', mean: 1, nmad: 0.01, vbShift: 0.2 }], fit: { ppp: 0.5, waic: 10, bcfi: 0.9 }, maxRhat: null, minNeff: null, diagnostics: { nmadMax: 0.01 }, intervals: 'marginals', engine: { package: 'INLAvaan', version: '0.3.2' } });
    expect(r.maxRhat).toBeNull(); expect(r.parameters[0].nmad).toBe(0.01); expect(r.diagnostics!.nmadMax).toBe(0.01); expect(r.fit.bcfi).toBe(0.9);
  });
});

describe('native check of INLAvaan’s examples (desktop R, scripts/validation/inlavaan.R)', () => {
  const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'inlavaan', 'reference.json'), 'utf8')) as Record<string, any>;
  it.each(['acfa', 'asem', 'bcfa'])('%s: the app equals INLAvaan called directly, and the optimiser converged', (k) => {
    expect(ref[k].maxRelDiff).toBeLessThan(1e-10);
    expect(ref[k].converged).toBe(true);
    expect(ref[k].parameters.length).toBe(k === 'asem' ? 31 : 21);
  });
  it.each(['marker', 'unit'])('against blavaan’s MCMC (%s identification): means within 0.2 posterior SD, SDs within 20%', (k) => {
    expect(ref.vsMcmc[k].maxZ).toBeLessThan(0.2);
    expect(ref.vsMcmc[k].sdRatio[0]).toBeGreaterThan(0.8); expect(ref.vsMcmc[k].sdRatio[1]).toBeLessThan(1.2);
  });
  it('the card’s options: priors on labels used, Mplus’s priors, a 90% interval from draws, loop and plausible values as the direct call', () => {
    expect(ref.options.labelPriors.maxRelDiff).toBeLessThan(1e-10);
    expect(ref.options.labelPriors.l2.prior).toBe('normal(0.5,0.1)');
    expect(ref.options.mplus.l2.low).toBeCloseTo(ref.options.mplus.direct.low, 8);
    expect(ref.options.mplus.priors).toContain('gamma(2,1e-4)');
    expect(ref.options.mplus.plausible.draws).toBe(10);
  });
});
