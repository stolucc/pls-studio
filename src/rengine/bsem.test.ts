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
import { bsemR, bsemScriptR } from './bsem';
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
    expect(bsemAnalysis.blocked(opts, { ...ctx, model: { ...model, ordered: ['a1'] } })).toMatch(/continuous/);
    expect(bsemAnalysis.blocked(opts, { ...ctx, model: { ...model, constant: { x: 0, y: 0 } } })).toMatch(/marker/);
    expect(bsemAnalysis.blocked({ ...opts, identification: 'marker' }, { ...ctx, model: { ...model, constant: { x: 0, y: 0 } } })).toBeNull();
  });
  it('options from a file: blavaan’s defaults, bounded', () => {
    expect(bsemAnalysis.defaults(ctx)).toEqual({ identification: 'unit', chains: 3, burnin: 500, sample: 1000 });
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
