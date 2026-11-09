// The Bayesian multilevel / DSEM card: its options, what it refuses and why, and how its syntax becomes the
// specification R writes the Stan program from (Mplus's defaults). The examples' models are checked against Mplus's
// parameter lists in examples/mplus/dsem.test.ts.

import { describe, expect, it } from 'vitest';
import { useCompute } from '../rengine/compute';
import { DESKTOP_ONLY } from '../rengine/bridge';
import { dsemRequest } from '../rengine/dsem';
import { dsemAnalysis } from './dsem';
import { dsemColumns, DsemSyntaxError, parseDsem } from './dsemSyntax';
import type { AnalysisCtx } from './types';

const n = 40;
const data = { names: ['y', 'x', 'w', 'id', 'u', 'time'], cols: [
  Float64Array.from({ length: n }, (_, i) => Math.sin(i)), Float64Array.from({ length: n }, (_, i) => Math.cos(i)), Float64Array.from({ length: n }, (_, i) => Math.floor(i / 4) / 10),
  Float64Array.from({ length: n }, (_, i) => Math.floor(i / 4)), Float64Array.from({ length: n }, (_, i) => i % 2), Float64Array.from({ length: n }, (_, i) => i % 4)] };
const ctx = { data, info: null, settings: { seed: 1, confidence: 0.95 }, pls: null, projectName: 'p' } as unknown as AnalysisCtx;
const twoLevel = 'WITHIN = x;\nBETWEEN = w;\nCLUSTER = id;\nLAGGED = y(1);\nTYPE = TWOLEVEL RANDOM;\nMODEL:\n%WITHIN%\ns | y ON y&1;\nsx | y ON x;\nlogv | y;\n%BETWEEN%\ny s sx logv ON w;\ny s WITH y s;';

describe('the card’s options', () => {
  it('defaults and options from a file, bounded (2 chains × 1,000 after 1,000)', () => {
    expect(dsemAnalysis.defaults(ctx)).toEqual({ syntax: '', chains: 2, warmup: 1000, draws: 1000 });
    expect(dsemAnalysis.parseOptions({ syntax: 'MODEL: y ON x;', chains: 99, warmup: 5, draws: 2500 })).toEqual({ syntax: 'MODEL: y ON x;', chains: 8, warmup: 100, draws: 2500 });
    expect(dsemAnalysis.parseOptions(null)).toBeNull();
  });
  it('random effects standardised on every level on request (a different run); anything else is the default', () => {
    const o = { syntax: twoLevel, chains: 2, warmup: 1000, draws: 1000 };
    const nc = dsemAnalysis.parseOptions({ ...o, parametrization: 'noncentred' })!;
    expect(nc).toEqual({ ...o, parametrization: 'noncentred' });
    expect(dsemAnalysis.parseOptions({ ...o, parametrization: 'centred; system("x")' })).toEqual(o);
    expect(dsemAnalysis.fingerprint(nc, ctx)).not.toBe(dsemAnalysis.fingerprint(o, ctx));
    expect(dsemAnalysis.summary!(nc)).toMatch(/non-centred/);
    const { spec } = parseDsem(twoLevel, data);
    expect(dsemRequest(data, spec, nc, 1, 0.95)).toMatchObject({ parametrization: 'noncentred' });
    expect(dsemRequest(data, spec, o, 1, 0.95)).not.toHaveProperty('parametrization');
  });
  it('runs in desktop R only, and says what is missing first', () => {
    expect(DESKTOP_ONLY.has('rstan')).toBe(true);
    useCompute.setState({ backend: 'browser' } as never);
    expect(dsemAnalysis.blocked({ syntax: '', chains: 2, warmup: 1000, draws: 1000 }, ctx)).toMatch(/Write the model/);
    expect(dsemAnalysis.blocked({ syntax: twoLevel, chains: 2, warmup: 1000, draws: 1000 }, ctx)).toMatch(/desktop R/);
    useCompute.setState({ backend: 'helper' } as never);
    expect(dsemAnalysis.blocked({ syntax: twoLevel, chains: 2, warmup: 1000, draws: 1000 }, ctx)).toBeNull();
    expect(dsemAnalysis.blocked({ syntax: 'MODEL: y ON nope;', chains: 2, warmup: 1000, draws: 1000 }, ctx)).toMatch(/nope/);
  });
  it('a different seed or model is a different run', () => {
    const o = { syntax: twoLevel, chains: 2, warmup: 1000, draws: 1000 };
    const f = dsemAnalysis.fingerprint(o, ctx);
    expect(f).toBeTruthy();
    expect(dsemAnalysis.fingerprint({ ...o, draws: 2000 }, ctx)).not.toBe(f);
    expect(dsemAnalysis.fingerprint(o, { ...ctx, settings: { ...ctx.settings, seed: 2 } } as AnalysisCtx)).not.toBe(f);
    expect(dsemAnalysis.summary!(o)).toMatch(/two-level DSEM/);
  });
});

describe('the syntax, with Mplus’s defaults', () => {
  it('a two-level DSEM: random effects with between-level parts, a block where WITH covers every pair, the rest uncorrelated', () => {
    const { spec } = parseDsem(twoLevel, data);
    expect(spec.levels).toEqual([{ column: 'id', nested: false }]);
    expect(spec.series.level).toBe(1);
    expect(spec.nodes.map((x) => x.kind)).toEqual(['y', 'x']);
    expect(spec.re).toHaveLength(4); // s, sx, logv, and y's random intercept
    expect(spec.bblocks.map((b) => b.members.length).sort()).toEqual([1, 1, 2]);
    expect(spec.report.filter((r) => r.block === 'Between Level' && r.op === '~1').map((r) => r.lhs).sort()).toEqual(['logv', 's', 'sx', 'y']);
    // the residual variance is random (exp(logv)): no within-level variance
    expect(spec.report.some((r) => r.block === 'Within Level')).toBe(false);
  });
  it('an N = 1 series: intercepts and residual variances on one level; a factor scaled by its variance has a positive first loading starting at 1', () => {
    const { spec } = parseDsem('CATEGORICAL = u;\nMODEL:\nf BY u* y x (&1);\nf@1;\nf ON f&1;', data);
    expect(spec.levels).toEqual([]);
    expect(spec.params[0]).toMatchObject({ type: 'pos', start: 1, prior: [0, 5] });
    expect(spec.report.find((r) => r.op === '|')!.lhs).toBe('u');
  });
  it('MODEL PRIORS on labels', () => {
    const { spec } = parseDsem('MODEL:\ny ON x (b1);\nMODEL PRIORS:\nb1 ~ N(0, 0.01);', data);
    expect(spec.params.find((p) => p.type !== 'block' && p.prior)).toMatchObject({ prior: [0, 0.01] });
    expect(() => parseDsem('MODEL:\ny ON x (b1);\nMODEL PRIORS:\nb2 ~ N(0, 1);', data)).toThrow(/b2 is not the label/);
  });
  it('refuses with a reason', () => {
    expect(() => parseDsem('CLUSTER = id;\nMODEL: y ON x;', data)).toThrow(DsemSyntaxError);
    expect(() => parseDsem('CLUSTER = id;\nMODEL: y ON x;', data)).toThrow(/TWOLEVEL/);
    expect(() => parseDsem('MODEL: y ON x&1;', data)).toThrow(/LAGGED/);
    expect(() => parseDsem('CLUSTER = id;\nTYPE = TWOLEVEL;\nMODEL:\n%WITHIN%\ny ON x;\n%BETWEEN%\ny WITH w;\nw WITH x;\n', data)).toThrow(/every pair/);
    expect(() => parseDsem('TYPE = MIXTURE;\nMODEL: y ON x;', data)).toThrow(/MIXTURE/);
  });
  it('the columns a syntax names (for listing an example’s columns): observed columns only, once, in the data’s spelling', () => {
    expect(dsemColumns(twoLevel).sort()).toEqual(['id', 'w', 'x', 'y']);
    // random loadings and the factor after | are not columns; a range of columns expands
    expect(dsemColumns('CLUSTER = clus;\nWITHIN = x1 x2;\nBETWEEN = w;\nTYPE = TWOLEVEL RANDOM;\nMODEL:\n%WITHIN%\ns1-s4 | f BY y1-y4;\nf@1;\nf ON x1 x2;\n%BETWEEN%\nfb BY y1-y4* (lam1-lam4);\nfb ON w;\n[s1-s4*1] (lam1-lam4);').sort())
      .toEqual(['clus', 'w', 'x1', 'x2', 'y1', 'y2', 'y3', 'y4']);
    // Mplus reads names without regard to case: Z and z are one column, listed as first written (or as the data spell it)
    const cc = 'CLUSTER = level2b level2a;\nWITHIN = x1 x2;\nBETWEEN = (level2a) w (level2b) z;\nTYPE = CROSSCLASSIFIED RANDOM;\nMODEL:\n%WITHIN%\ny ON x1;\ns | y ON x2;\n%BETWEEN level2a%\ny ON w;\ns ON w;\n%BETWEEN level2b%\ny ON z;\ns ON Z;';
    expect(dsemColumns(cc).sort()).toEqual(['level2a', 'level2b', 'w', 'x1', 'x2', 'y', 'z']);
    expect(dsemColumns(cc, ['Y', 'X1', 'X2', 'W', 'Z', 'LEVEL2A', 'LEVEL2B'])).toContain('Z');
    // DEFINE's new variables and (cluster) qualifiers are not columns; a random slope on a defined variable neither
    const def = 'CLUSTER = subject time;\nWITHIN = timescor (time) y1-y3;\nDEFINE:\ntimescor = (time-1)/100;\nCENTER X (GROUPMEAN);\nMODEL:\n%WITHIN%\ns1-s3 | f BY y1-y3;\nf@1;\ns | f ON timescor;\n%BETWEEN time%\ns1-s3; [s1-s3];';
    expect(dsemColumns(def).sort()).toEqual(['X', 'subject', 'time', 'y1', 'y2', 'y3']);
    expect(dsemColumns(def, ['y1', 'y2', 'y3', 'x', 'time', 'subject']).sort()).toEqual(['subject', 'time', 'x', 'y1', 'y2', 'y3']);
  });
});
