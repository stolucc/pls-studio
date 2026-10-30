// Each analysis card run end to end in webR on its package example: the card's
// result equals the package (as the analysis' own webR test checks), survives
// saving and reopening the project, and renders. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import type { Dataset } from '../engine/types';
import { parseProject, serializeProject } from '../model/project';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import { useStore } from '../store';
import { parseCards } from './persist';
import { analysisType } from './registry';
import { addAnalysis, loadCards, runCard, unpackCard, useAnalyses } from './store';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const example = (file: string) => parseCsv(readFileSync(join(__dirname, '..', '..', 'public', 'examples', file), 'utf8')).dataset;

/** Run a card on a dataset; returns its result after a save and reopen, and the rendered card body. */
async function runAsCard<R>(type: string, data: Dataset, options: object, setup?: () => void): Promise<{ result: R; html: string }> {
  const s = useStore.getState();
  s.newProject();
  s.setData(data, { fileName: 'example.csv', rows: data.cols[0].length, missingCells: 0, excluded: [] });
  setup?.();
  loadCards([]);
  const id = addAnalysis(type, options)!;
  await runCard(id);
  expect(useAnalyses.getState().errors[id]).toBeUndefined();
  const st = useStore.getState();
  const text = serializeProject(st.model, st.settings, st.data, st.dataInfo, null, useAnalyses.getState().cards);
  useAnalyses.setState({ results: {} });
  loadCards(parseCards(parseProject(text).analyses));
  await unpackCard(id);
  const result = useAnalyses.getState().results[id] as R;
  expect(result).toBeTruthy();
  const card = useAnalyses.getState().cards.find((c) => c.id === id)!;
  const t = analysisType(type)!;
  const html = renderToStaticMarkup(<t.View result={result} options={card.kind === 'analysis' ? card.options : null} current />);
  return { result, html };
}

it('NCA', async () => {
  const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'nca', 'reference.json'), 'utf8'));
  const { result, html } = await runAsCard<{ conditions: { ceFdh: number }[] }>('nca', example('nca/nca_example.csv'),
    { x: ['Individualism', 'Risk taking'], y: 'Innovation performance', permutations: 50 });
  expect(result.conditions[0].ceFdh).toBeCloseTo(ref.conditions[0].ce, 6);
  expect(html).toContain('Bottleneck table');
}, 900_000);

it('polynomial regression (RSA)', async () => {
  const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'rsa', 'reference.json'), 'utf8'));
  const { result, html } = await runAsCard<{ fit: { r2: number }; confidence: number }>('rsa', example('rsa/motcon.csv'),
    { outcome: 'postVA', x: 'ePow', y: 'iPow', estimation: 'OLS', center: 'none' });
  expect(result.fit.r2).toBeCloseTo(ref.OLS.r2, 10);
  expect(result.confidence).toBe(0.95);
  expect(html).toContain('Response surface');
}, 900_000);

it('propensity score matching (MatchIt) and weighting (WeightIt)', async () => {
  const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'match', 'reference.json'), 'utf8'));
  const { rCall } = await import('../rengine/bridge');
  const { categoriesOf } = await import('../io');
  const raw = await rCall<{ names: string[]; cols: (number | null)[][]; levels?: Record<string, string[]> }>('ps_dataset', { package: 'MatchIt', name: 'lalonde', na: [] }, 'MatchIt');
  const data = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))), ...categoriesOf(raw.levels) };
  const preset = { treatment: 'treat', covariates: ['age', 'educ', 'race', 'married', 'nodegree', 're74', 're75'], outcome: 're78' };
  const { result, html } = await runAsCard<{ effect: { est: number }; input: { seed: number } }>('match', data, { ...preset, method: 'full', estimand: 'ATT' });
  expect(result.effect.est).toBeCloseTo(ref.full.effect.est, 4);
  expect(result.input.seed).toBe(useStore.getState().settings.seed);
  expect(html).toContain('Covariate balance');
}, 900_000);

it('endogeneity (higher-moment instruments, as REndo)', async () => {
  const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'endo', 'reference.json'), 'utf8'));
  const { result, html } = await runAsCard<{ coefficients: { term: string; est: number }[] }>('endo', example('rendo/dataHigherMoments.csv'),
    { method: 'hm', outcome: 'y', endogenous: ['P'], exogenous: ['X1', 'X2'], hetRegressors: ['X1', 'X2'], hmTypes: ['gp', 'yp'] });
  const c = ref.hm.coef.find((x: { term: string }) => x.term === 'P');
  expect(result.coefficients.find((x) => x.term === 'P')!.est).toBeCloseTo(c.est, 10);
  expect(html).toContain('OLS');
}, 900_000);

it('multilevel regression (lme4 on sleepstudy)', async () => {
  const dir = join(__dirname, '..', 'engine', '__fixtures__', 'mixed');
  const ref = JSON.parse(readFileSync(join(dir, 'reference.json'), 'utf8'));
  const sleep = parseCsv(readFileSync(join(dir, 'sleepstudy.csv'), 'utf8')).dataset;
  const { result, html } = await runAsCard<{ fixed: { term: string; est: number }[] }>('lmm', sleep,
    { outcome: 'Reaction', predictors: ['Days'], cluster: 'Subject', slopes: ['Days'], center: 'none', estimation: 'REML' });
  expect(result.fixed.find((x) => x.term === 'Days')!.est).toBeCloseTo(ref.lmm.fixed.find((f: { term: string }) => f.term === 'Days').est, 5);
  expect(html).toContain('Days');
}, 900_000);

it('exploratory factor analysis (psych on bfi)', async () => {
  const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'efa', 'reference.json'), 'utf8'));
  const { rCall } = await import('../rengine/bridge');
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'psych', name: 'bfi', na: [] }, 'psych');
  const data = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  const { result, html } = await runAsCard<{ kmo: { overall: number }; k: number }>('efa', data,
    { vars: data.names.slice(0, 25), criterion: 'fixed', nfactors: 5, method: 'minres', rotation: 'oblimin', parallel: 10 });
  expect(result.k).toBe(5);
  expect(result.kmo.overall).toBeCloseTo(ref.bfi.kmo, 6);
  expect(html).toContain('Build model from this solution');
}, 900_000);

it('data screening (psych) and influential cases (semfindr)', async () => {
  const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'screen', 'reference.json'), 'utf8'));
  const { rCall } = await import('../rengine/bridge');
  const load = async (pkg: 'lavaan' | 'semfindr', name: string) => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: pkg, name, na: [] }, pkg);
    return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  };
  const hs = await load('lavaan', 'HolzingerSwineford1939');
  const vars = Array.from({ length: 9 }, (_, i) => `x${i + 1}`);
  const screen = await runAsCard<{ mardia: { b2p: number } }>('screen', hs, { vars, alpha: 0.001 });
  // (the reference screens a copy with a value removed; the card must equal the engine on the same data)
  const { screenR } = await import('../rengine/screen');
  expect(screen.result.mardia.b2p).toBeCloseTo((await screenR(hs, vars, 0.001)).mardia.b2p, 10);
  expect(screen.html).toContain('Distributions');

  const C = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
  const inf = await runAsCard<{ rows: number[]; gcd: number[] }>('influence', await load('semfindr', 'cfa_dat2'), {}, () => {
    useStore.setState({ model: { constructs: [C('f1', ['x1', 'x2', 'x3']), C('f2', ['x4', 'x5', 'x6'])], paths: [], moderations: [], correlations: [{ id: 'k', kind: 'construct', a: 'f1', b: 'f2' }] } });
    useStore.getState().setSettings({ method: 'cbsem', engine: 'r', missing: 'casewise', estimator: 'ML' });
  });
  const top = inf.result.rows.map((row, i) => ({ row, i })).sort((a, b) => inf.result.gcd[b.i] - inf.result.gcd[a.i]).slice(0, 5);
  expect(top.map((x) => x.row)).toEqual(ref.influence.rows);
  expect(inf.html).toContain('Most influential cases');
}, 900_000);

it('item response theory (ltm) and latent classes (poLCA)', async () => {
  const dir = join(__dirname, '..', 'engine', '__fixtures__', 'items');
  const ref = JSON.parse(readFileSync(join(dir, 'items.json'), 'utf8'));
  const load = (f: string) => parseCsv(readFileSync(join(dir, f), 'utf8')).dataset;
  const lsat = load('lsat.csv');
  const irt = await runAsCard<{ logLik: number }>('irt', lsat, { items: lsat.names, model: 'twopl' });
  expect(irt.result.logLik).toBeCloseTo(ref.irt.twopl.logLik, 4);
  expect(irt.html).toContain('Discrimination');
  const lca = await runAsCard<{ models: { k: number; bic: number }[] }>('lca', load('values.csv'), { items: ['A', 'B', 'C', 'D'], from: 2, to: 3 },
    () => useStore.getState().setSettings({ seed: 20261029 }));
  lca.result.models.forEach((m, i) => expect(m.bic).toBeCloseTo(ref.lca[i].bic, 3));
  expect(lca.html).toContain('Number of classes');
}, 900_000);
