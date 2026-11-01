// Opening a built-in example resets the estimation settings to the example's
// documented ones (the previous project's bootstrap count, missing-value
// treatment and so on must not leak into it).

import { beforeEach, expect, it } from 'vitest';
import { loadSample } from './io';
import { DEFAULT_SETTINGS } from './model/project';
import { useStore } from './store';

beforeEach(() => {
  useStore.getState().newProject();
  useStore.setState({ toasts: [] });
  useStore.getState().setSettings({ bootSamples: 50_000, missing: 'mi', consistent: true, seed: 7, engine: 'builtin', figure: { ...DEFAULT_SETTINGS.figure, fontSize: 19 } });
});

it('the customer experience example opens as a PLS project with the default bootstrap and missing-value settings', async () => {
  await loadSample('customer');
  const s = useStore.getState().settings;
  expect(s.method).toBe('pls');
  expect(s.bootSamples).toBe(DEFAULT_SETTINGS.bootSamples);
  expect(s.missing).toBe(DEFAULT_SETTINGS.missing);
  expect(s.consistent).toBe(DEFAULT_SETTINGS.consistent);
  expect(s.seed).toBe(DEFAULT_SETTINGS.seed);
  expect(s.engine).toBe('r');
  expect(s.figure.fontSize).toBe(19);
});

it('the Stol et al. (2022) example opens with MLM, the political democracy example with ML, both from the defaults', async () => {
  await loadSample('emse');
  expect(useStore.getState().settings).toMatchObject({ method: 'cbsem', estimator: 'MLM', consistent: false, bootSamples: DEFAULT_SETTINGS.bootSamples, missing: DEFAULT_SETTINGS.missing, engine: 'r' });
  useStore.getState().newProject();
  useStore.getState().setSettings({ bootSamples: 50_000, missing: 'mi' });
  await loadSample('poldem');
  expect(useStore.getState().settings).toMatchObject({ method: 'cbsem', estimator: 'ML', bootSamples: DEFAULT_SETTINGS.bootSamples, missing: DEFAULT_SETTINGS.missing, engine: 'r' });
});

it('the textbook matrix examples open as CB-SEM projects with maximum likelihood, from the defaults', async () => {
  for (const id of ['wheaton', 'thurstone', 'kerckhoff', 'hayduk', 'hayduk-stacked', 'hayduk-revised', 'dhp'] as const) {
    useStore.getState().newProject();
    useStore.getState().setSettings({ bootSamples: 50_000, missing: 'mi', consistent: true });
    await loadSample(id);
    const s = useStore.getState();
    expect(s.settings, id).toMatchObject({ method: 'cbsem', estimator: 'ML', consistent: false, bootSamples: DEFAULT_SETTINGS.bootSamples, missing: DEFAULT_SETTINGS.missing });
    expect(s.example, id).toBe(id);
    expect(s.data?.moments?.n, id).toBeGreaterThan(200);
    if (id !== 'dhp') expect(s.settings.engine, id).toBe('r');
  }
});
