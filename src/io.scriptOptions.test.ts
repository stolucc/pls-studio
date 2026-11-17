// The exported R script takes the same options as the calculation (runOptions.ts): a BCa or
// one-tailed bootstrap is exported as such, and a PLS script carries the multiple-imputation and
// higher-order settings — before, the export built its own options and left these out.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const seen: { analysis?: Record<string, unknown>; pls?: Record<string, unknown> } = {};
vi.mock('./rengine/analyses', () => ({
  analysisScript: async (_d: unknown, _s: unknown, a: Record<string, unknown>) => {
    seen.analysis = a;
    return '# script';
  },
}));
vi.mock('./rengine/pls', () => ({
  plsScriptR: async (_d: unknown, _s: unknown, options: Record<string, unknown>) => {
    seen.pls = options;
    return '# script';
  },
}));
vi.mock('./rengine/lavaan', () => ({ cbScriptLavaan: async () => '# script' }));

const { buildRScript } = await import('./io');
const { useStore } = await import('./store');
const { bootOptionsOf, plsOptionsOf } = await import('./runOptions');

beforeAll(async () => {
  const { loadSample } = await import('./io');
  await loadSample('customer');
});
beforeEach(() => {
  delete seen.analysis;
  delete seen.pls;
});

describe('buildRScript uses the calculation’s options', () => {
  it('exports a BCa, one-tailed bootstrap as such', async () => {
    const s = useStore.getState();
    s.setSettings({ method: 'pls', bootInterval: 'bca', bootTails: 'one', bootSamples: 300 });
    await buildRScript('bootstrap');
    expect(seen.analysis?.boot).toEqual(bootOptionsOf(useStore.getState().settings));
    expect(seen.analysis?.boot).toMatchObject({ interval: 'bca', tails: 1, samples: 300 });
  });

  it('passes inadmissible PLSc draws kept on to the bootstrap (dropped by default)', async () => {
    const s = useStore.getState();
    s.setSettings({ method: 'pls', consistent: true });
    await buildRScript('bootstrap');
    expect(seen.analysis?.boot).toMatchObject({ inadmissible: 'drop' });
    s.setSettings({ bootInadmissible: 'keep' });
    await buildRScript('bootstrap');
    expect(seen.analysis?.boot).toMatchObject({ inadmissible: 'keep' });
  });

  it('gives the PLS script the imputation and higher-order settings', async () => {
    const s = useStore.getState();
    s.setSettings({ method: 'pls', miImputations: 7, seed: 42, hocApproach: 'embedded' });
    await buildRScript('model');
    expect(seen.pls).toEqual(plsOptionsOf(useStore.getState().settings));
    expect(seen.pls).toMatchObject({ mi: { m: 7, seed: 42 }, hocApproach: 'embedded' });
  });
});
