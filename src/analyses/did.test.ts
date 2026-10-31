import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { didRequest } from '../rengine/did';
import { didAnalysis, didInput, type DidOptions } from './did';
import type { AnalysisCtx } from './types';

const data = { names: ['y', 'id', 't', 'd', 'post', 'x', 'g'], cols: Array.from({ length: 7 }, (_, k) => Float64Array.from([k, k + 1, k === 5 ? NaN : k + 2])) };
const ctx = (): AnalysisCtx => ({ data, info: null, settings: DEFAULT_SETTINGS, pls: null, projectName: 'p' });
const o = (p: Partial<DidOptions>): DidOptions => ({ ...didAnalysis.defaults(ctx()), ...p });

describe('difference-in-differences card', () => {
  it('says what it needs and takes seed and confidence from the settings', () => {
    expect(didAnalysis.blocked(o({}), ctx())).toMatch(/Choose the outcome/);
    expect(didAnalysis.blocked(o({ outcome: 'y', unit: 'id', time: 't', treated: 'y' }), ctx())).toMatch(/different columns/);
    expect(didAnalysis.blocked(o({ outcome: 'y', unit: 'id', time: 't', treated: 'd' }), ctx())).toMatch(/post-period indicator, or the first treated period/);
    expect(didAnalysis.blocked(o({ outcome: 'y', unit: 'id', time: 't', treated: 'd', post: 'post' }), ctx())).toBeNull();
    expect(didAnalysis.blocked(o({ outcome: 'y', unit: 'id', time: 't', treated: 'd', firstPeriod: 3 }), ctx())).toBeNull();
    expect(didAnalysis.blocked(o({ design: 'staggered', outcome: 'y', unit: 'id', time: 't', treated: 'g' }), ctx())).toBeNull();
    expect(didAnalysis.blocked(o({ outcome: 'y', unit: 'id', time: 't', treated: 'd', post: 'nope' }), ctx())).toMatch(/nope/);
    const input = didInput(o({ outcome: 'y', unit: 'id', time: 't', treated: 'd', post: 'post' }), { settings: { ...DEFAULT_SETTINGS, seed: 7, confidence: 0.9 } });
    expect(input).toMatchObject({ seed: 7, confidence: 0.9, design: 'twfe' });
    expect(didAnalysis.parseOptions({ design: 'cs', firstPeriod: 'x', covariates: ['x', 'x'], control: 'notyettreated', eventStudy: true }))
      .toEqual({ design: 'twfe', outcome: '', unit: '', time: '', treated: '', post: '', firstPeriod: null, covariates: ['x'], control: 'notyettreated', eventStudy: true });
    expect(didAnalysis.summary(o({ design: 'staggered', outcome: 'y', treated: 'g' }))).toBe('staggered (Callaway & Sant’Anna) · y on g · event study');
    expect(didAnalysis.fingerprint(o({ outcome: 'y', unit: 'id', time: 't', treated: 'd', post: 'post' }), ctx())).not.toBe(didAnalysis.fingerprint(o({ outcome: 'y', unit: 'id', time: 't', treated: 'd', post: 'post', eventStudy: false }), ctx()));
  });
  it('sends only the chosen columns, missing values as null, and refuses a covariance matrix', () => {
    const r = didRequest(data, didInput(o({ outcome: 'y', unit: 'id', time: 't', treated: 'd', post: 'post', covariates: ['x'] }), ctx()));
    expect(r.data.names).toEqual(['y', 'id', 't', 'd', 'post', 'x']);
    expect(r.data.cols[5]).toEqual([5, 6, null]);
    expect(r.firstPeriod).toBeUndefined();
    expect(() => didRequest({ names: ['a'], cols: [], moments: { S: [[1]], n: 5 } }, didInput(o({}), ctx()))).toThrow(/covariance matrix/);
  });
});
