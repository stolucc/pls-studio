// The robust, bootstrap and permutation alternatives (analyses/resampling.tsx): options survive a
// project file, bad values are clamped, the cards carry them (blocked where they do not apply,
// sent with the project's seed) and their tables render. (Numbers: rengine/robust.webr.test.ts.)

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { regressionRequest } from '../rengine/regression';
import { RESAMPLING_DEFAULTS, resamplingField } from '../rengine/resampling';
import { anovaRequest, correlationRequest, ttestRequest } from '../rengine/tests';
import { regressionAnalysis, regressionInput } from './regression';
import {
  AnovaResamplingView,
  parseResampling,
  permP,
  ResamplingFields,
  resamplingFingerprint,
  resamplingPart,
  withResampling,
} from './resampling';
import { anovaAnalysis, correlationAnalysis, ttestAnalysis } from './tests';
import type { AnalysisCtx } from './types';

const data = {
  names: ['y', 'g', 'h', 'x', 'w'],
  cols: [
    new Float64Array([1, 2, 3, 4, 5, 6]),
    new Float64Array([1, 1, 1, 2, 2, 2]),
    new Float64Array([1, 2, 3, 1, 2, 3]),
    new Float64Array([2, 1, 4, 3, 6, 5]),
    new Float64Array([1, 1, 1, 1, 1, 2]),
  ],
};
const ctx = {
  data,
  info: null,
  settings: { ...DEFAULT_SETTINGS, seed: 77 },
  pls: null,
  projectName: 'x',
} as unknown as AnalysisCtx;
/** The fields of a request the tests read. */
type Req = { resampling: Record<string, unknown> } & Record<string, unknown>;
const ON = { ...RESAMPLING_DEFAULTS, trimmed: true, bootstrap: true, permutation: true };

describe('the resampling options', () => {
  it('survive a project file; bad values are clamped, nothing on is none', () => {
    expect(parseResampling(JSON.parse(JSON.stringify(ON)))).toEqual(ON);
    expect(parseResampling({ trimmed: false })).toBeNull();
    expect(parseResampling('x')).toBeNull();
    const bad = parseResampling({ trimmed: true, trim: 0.9, resamples: 1e9, bootstrap: 'yes' })!;
    expect(bad.trim).toBe(0.45);
    expect(bad.resamples).toBe(100000);
    expect(bad.bootstrap).toBe(false);
    expect(parseResampling({ permutation: true, resamples: 'many' })!.resamples).toBe(5000);
    expect(resamplingPart({ resampling: { bootstrap: true } })).toEqual({
      resampling: { ...RESAMPLING_DEFAULTS, bootstrap: true },
    });
    expect(resamplingPart({})).toEqual({});
  });

  it('a card drops the key when none is on; the request carries the seed', () => {
    const card: { a: number; resampling?: typeof ON } = { a: 1, resampling: ON };
    expect(withResampling(card, RESAMPLING_DEFAULTS)).toEqual({ a: 1 });
    expect(withResampling({ ...card, resampling: undefined }, ON)).toEqual({
      a: 1,
      resampling: ON,
    });
    expect(resamplingField(ON, 9)).toEqual({ resampling: { ...ON, seed: 9 } });
    expect(resamplingField(RESAMPLING_DEFAULTS, 9)).toEqual({});
    expect(resamplingFingerprint(null, 1)).toEqual([]);
    expect(resamplingFingerprint(ON, 1)).not.toEqual(resamplingFingerprint(ON, 2));
  });

  it('a permutation p of zero reads as below one over the resamples', () => {
    expect(permP({ z: 3, p: 0 }, 5000).v).toBe('< 0.0002');
    expect(permP(null, 5000).v).toBeNull();
  });
});

describe('the cards carry them', () => {
  it('t-test: parsed, fingerprinted with the seed, sent with it', async () => {
    const o = ttestAnalysis.parseOptions({
      type: 'independent',
      vars: ['y'],
      group: 'g',
      resampling: ON,
    })!;
    expect(o.resampling).toEqual(ON);
    expect(ttestAnalysis.blocked!(o, ctx)).toBeNull();
    const other = { ...ctx, settings: { ...ctx.settings, seed: 78 } };
    expect(ttestAnalysis.fingerprint(o, ctx)).not.toBe(ttestAnalysis.fingerprint(o, other));
    const req = ttestRequest(data, {
      ...o,
      confidence: 0.95,
      seed: 77,
    }) as unknown as Req;
    expect(req.resampling.seed).toBe(77);
    expect(req).not.toHaveProperty('seed');
    // (an older card's request is unchanged)
    const plain = ttestRequest(data, {
      ...withResampling(o, RESAMPLING_DEFAULTS),
      confidence: 0.95,
    });
    expect(plain).not.toHaveProperty('resampling');
  });

  it('ANOVA: robust for one or two factors, permutation for one, neither with covariates', () => {
    const o = anovaAnalysis.parseOptions({
      dependent: 'y',
      factors: ['g'],
      covariates: [],
      resampling: { ...ON, bootstrap: false },
    })!;
    expect(anovaAnalysis.blocked!(o, ctx)).toBeNull();
    expect(anovaAnalysis.blocked!({ ...o, covariates: ['x'] }, ctx)).toMatch(/no covariates/);
    expect(anovaAnalysis.blocked!({ ...o, factors: ['g', 'h'] }, ctx)).toMatch(/one factor/);
    const three = { ...o, factors: ['g', 'h', 'w'], resampling: { ...ON, permutation: false } };
    expect(anovaAnalysis.blocked!(three, ctx)).toMatch(/one or two factors/);
    const req = anovaRequest(data, { ...o, confidence: 0.95, seed: 5 }) as unknown as Req;
    expect(req.resampling.seed).toBe(5);
  });

  it('correlation: no resampling for polychoric, no permutation for Kendall', () => {
    const o = correlationAnalysis.parseOptions({
      vars: ['y', 'x'],
      method: 'kendall',
      resampling: { ...ON, trimmed: false },
    })!;
    expect(correlationAnalysis.blocked!(o, ctx)).toMatch(/Pearson and Spearman/);
    const boot = { ...o, resampling: { ...o.resampling!, permutation: false } };
    expect(correlationAnalysis.blocked!(boot, ctx)).toBeNull();
    expect(correlationAnalysis.blocked!({ ...boot, method: 'polychoric' }, ctx)).toMatch(
      /Bootstrap/,
    );
    const req = correlationRequest(data, {
      ...boot,
      confidence: 0.95,
      seed: 3,
    }) as unknown as Req;
    expect(req.resampling.bootstrap).toBe(true);
  });

  it('regression: bootstrap for linear models without weights or a random slope', () => {
    const o = regressionAnalysis.parseOptions({
      outcome: 'y',
      predictors: ['x'],
      family: 'gaussian',
      resampling: { ...RESAMPLING_DEFAULTS, bootstrap: true },
    })!;
    expect(regressionAnalysis.blocked!(o, ctx)).toBeNull();
    expect(regressionAnalysis.blocked!({ ...o, family: 'poisson' }, ctx)).toMatch(/Bootstrap/);
    expect(regressionAnalysis.blocked!({ ...o, weights: 'w' }, ctx)).toMatch(/Bootstrap/);
    const input = regressionInput(o, ctx);
    expect(input.seed).toBe(77);
    const req = regressionRequest(data, input) as unknown as Req;
    expect(req.resampling).toMatchObject({ bootstrap: true, seed: 77 });
    expect(req).not.toHaveProperty('seed');
  });
});

describe('the forms and tables render', () => {
  it('the form offers what the card offers; trimming and resamples once on', () => {
    const off = renderToStaticMarkup(
      <ResamplingFields value={null} set={() => {}} offer={['bootstrap']} />,
    );
    expect(off).toContain('Bootstrap intervals');
    expect(off).not.toContain('Permutation');
    expect(off).not.toContain('Resamples');
    const on = renderToStaticMarkup(
      <ResamplingFields
        value={ON}
        set={() => {}}
        offer={['trimmed', 'bootstrap', 'permutation']}
      />,
    );
    for (const text of ['Trimmed from each end', 'Resamples', 'seed']) expect(on).toContain(text);
  });

  it('robust one-way and two-way ANOVA tables, and the permutation test', () => {
    const one = renderToStaticMarkup(
      <AnovaResamplingView
        conf={0.95}
        r={{
          trim: 0.2,
          resamples: 2000,
          seed: 1,
          robust: [{ term: 'g', stat: 3, df1: 2, df2: 4, p: 0.16, effsize: 0.79, effsizeLow: 0.4 }],
          permutation: { term: 'g', stat: 7.7, p: 0 },
        }}
      />,
    );
    expect(one).toContain('t1way');
    expect(one).toContain('Effect size ξ');
    expect(one).toContain('&lt; 0.0005');
    const two = renderToStaticMarkup(
      <AnovaResamplingView
        conf={0.95}
        r={{
          trim: 0.2,
          resamples: 2000,
          seed: 1,
          robust: [
            { term: 'a', stat: 1, p: 0.2 },
            { term: 'b', stat: 2, p: 0.1 },
            { term: 'a × b', stat: 3, p: 0.05 },
          ],
          permutation: null,
        }}
      />,
    );
    expect(two).toContain('t2way');
    expect(two).not.toContain('Permutation test');
  });
});
