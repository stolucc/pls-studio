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

it('latent growth curve and RI-CLPM (lavaan), growth mixture (lcmm)', async () => {
  const dir = join(__dirname, '..', 'engine', '__fixtures__', 'longitudinal');
  const ref = JSON.parse(readFileSync(join(dir, 'longitudinal.json'), 'utf8'));
  const load = (f: string) => parseCsv(readFileSync(join(dir, f), 'utf8')).dataset;
  const cb = () => useStore.getState().setSettings({ estimator: 'ML', missing: 'casewise' });
  const growth = await runAsCard<{ impliedMeans: number[]; input: { estimator: string } }>('growth', load('demo_growth.csv'), { measures: ['t1', 't2', 't3', 't4'], shape: 'linear' }, cb);
  growth.result.impliedMeans.forEach((m, i) => expect(m).toBeCloseTo(ref.impliedMeansLinear[i], 5));
  expect(growth.result.input.estimator).toBe('ML');
  expect(growth.html).toContain('Growth factors');
  const ri = await runAsCard<{ comparison: { chisqDiff: number } }>('riclpm', load('panel.csv'), { x: ['x1', 'x2', 'x3', 'x4'], y: ['y1', 'y2', 'y3', 'y4'] }, cb);
  expect(ri.result.comparison.chisqDiff).toBeCloseTo(ref.clpmVsRiclpm.chisqDiff, 3);
  expect(ri.html).toContain('Within-person lagged effects');

  const mdir = join(__dirname, '..', 'engine', '__fixtures__', 'mixed');
  const mref = JSON.parse(readFileSync(join(mdir, 'reference.json'), 'utf8'));
  const hlme = parseCsv(readFileSync(join(mdir, 'data_hlme.csv'), 'utf8')).dataset;
  const gmm = await runAsCard<{ models: { k: number; logLik: number }[] }>('gmm', hlme,
    { format: 'long', subject: 'ID', time: 'Time', outcome: 'Y', covariates: ['X1'], shape: 'linear', random: 'slope', to: 2, nrep: 50 },
    () => useStore.getState().setSettings({ seed: 1 }));
  for (const m of gmm.result.models) expect(m.logLik, `k = ${m.k}`).toBeCloseTo(mref.gmm.models[String(m.k)].logLik, 2);
  expect(gmm.html).toContain('Number of classes');
}, 1_800_000);

it('PLS-SEM model comparison against a saved alternative (cSEM)', async () => {
  const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'plsx', 'reference.json'), 'utf8'));
  const { rCall } = await import('../rengine/bridge');
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'cSEM', name: 'satisfaction', na: [] }, 'cSEM');
  const data = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  const items = (p: string, k: number) => Array.from({ length: k }, (_, i) => `${p}${i + 1}`);
  const K = (name: string, ind: string[], composite: boolean) => ({ id: name, name, type: composite ? 'composite' as const : 'factor' as const, mode: composite ? 'B' as const : 'A' as const, indicators: ind, x: 0, y: 0, side: 'left' as const });
  const paths: [string, string][] = [['IMAG', 'EXPE'], ['EXPE', 'QUAL'], ['EXPE', 'VAL'], ['QUAL', 'VAL'], ['IMAG', 'SAT'], ['EXPE', 'SAT'], ['QUAL', 'SAT'], ['VAL', 'SAT'], ['IMAG', 'LOY'], ['SAT', 'LOY']];
  const alternative = { paths: paths.filter(([f, t]) => !(f === 'IMAG' && t === 'LOY')), savedAt: 1 };
  const { result, html } = await runAsCard<{ criteria: { criterion: string; byConstruct: Record<string, number> }[]; criteriaAlt: { criterion: string; byConstruct: Record<string, number> }[] }>(
    'compare', data, { alternative }, () => {
      useStore.setState({ model: {
        constructs: [K('IMAG', items('imag', 3), true), K('EXPE', items('expe', 3), true), K('QUAL', items('qual', 5), true), K('VAL', items('val', 3), true), K('SAT', items('sat', 4), false), K('LOY', items('loy', 4), false)],
        paths: paths.map(([from, to]) => ({ id: `${from}-${to}`, from, to })), moderations: [] } });
      useStore.getState().setSettings({ method: 'pls', engine: 'r', scheme: 'path', consistent: false, stopExp: 7, maxIter: 300, missing: 'casewise', seed: 1 });
    });
  const bic = result.criteria.find((c) => c.criterion === 'BIC')!.byConstruct, bicAlt = result.criteriaAlt.find((c) => c.criterion === 'BIC')!.byConstruct;
  for (const k of Object.keys(ref.msc.BIC)) { expect(bic[k], k).toBeCloseTo(ref.msc.BIC[k], 6); expect(bicAlt[k]).toBeCloseTo(ref.mscAlt.BIC[k], 6); }
  expect(html).toContain('CVPAT');
}, 900_000);

it('REBUS-PLS (plspm) on the model on the canvas', async () => {
  const dir = join(__dirname, '..', 'engine', '__fixtures__', 'rebus');
  const ref = JSON.parse(readFileSync(join(dir, 'reference.json'), 'utf8'));
  const mv = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `mv${a + i}`);
  const K = (name: string, ind: string[]) => ({ id: name, name, type: 'factor' as const, mode: 'A' as const, indicators: ind, x: 0, y: 0, side: 'left' as const });
  const { result, html } = await runAsCard<{ globalGof: number; models: { k: number; gqi: number }[] }>('rebus', parseCsv(readFileSync(join(dir, 'simdata.csv'), 'utf8')).dataset, { from: 2, to: 3 }, () => {
    useStore.setState({ model: { constructs: [K('Price', mv(1, 5)), K('Quality', mv(6, 10)), K('Satisfaction', mv(11, 13))],
      paths: [{ id: 'p1', from: 'Price', to: 'Satisfaction' }, { id: 'p2', from: 'Quality', to: 'Satisfaction' }], moderations: [] } });
    useStore.getState().setSettings({ method: 'pls', engine: 'r', scheme: 'centroid', stopExp: 6, maxIter: 100, missing: 'casewise', seed: 1 });
  });
  expect(result.globalGof).toBeCloseTo(ref.gof, 8);
  expect(result.models.find((m) => m.k === 2)!.gqi).toBeCloseTo(ref.k2.gqi, 8);
  expect(html).toContain('Save classes as a data column');
}, 900_000);

it('Monte Carlo simulation (R engine), with progress, equal to the same chunks run directly', async () => {
  const { runMcChunkR } = await import('../rengine/mc');
  const { summariseMc } = await import('../engine/montecarlo');
  const f = (name: string, p: string) => ({ name, type: 'factor' as const, indicators: [1, 2, 3].map((i) => `${p}${i}`), loadings: [0.8, 0.7, 0.75] });
  const design = {
    population: { constructs: [f('Price fairness', 'a'), f('Trust', 'b'), f('Loyalty', 'c')],
      paths: [{ from: 'Price fairness', to: 'Trust', value: 0.4 }, { from: 'Trust', to: 'Loyalty', value: 0.5 }, { from: 'Price fairness', to: 'Loyalty', value: 0 }], exoCor: [] },
    estimators: [{ id: 'PLSc', method: 'pls' as const, consistent: true }, { id: 'CB-ML', method: 'cb' as const, estimator: 'ML' as const }],
    sampleSizes: [300], replications: 20, seed: 5, alpha: 0.05, bootSamples: 0, mcDraws: 500,
  };
  const seen: number[] = [];
  const unsub = useAnalyses.subscribe((s) => { for (const p of Object.values(s.progress)) seen.push(p.done); });
  const { result, html } = await runAsCard<{ estimator: string; param: { key: string }; mean: number }[]>('mc', { names: ['x'], cols: [Float64Array.from([1])] }, design,
    () => useStore.getState().setSettings({ engine: 'r', method: 'pls' }));
  unsub();
  const direct = summariseMc(design, [await runMcChunkR(design, 300, 0, 10), await runMcChunkR(design, 300, 10, 20)]);
  for (const row of result) expect(row.mean, `${row.estimator} ${row.param.key}`).toBeCloseTo(direct.find((x) => x.estimator === row.estimator && x.param.key === row.param.key)!.mean, 10);
  expect(seen.length).toBeGreaterThan(0);
  expect(html).toContain('Power');
}, 900_000);

it('CB-SEM extras on the model on the canvas: parameter comparisons and factor score weights', async () => {
  const { rCall } = await import('../rengine/bridge');
  const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: 'lavaan', name: 'HolzingerSwineford1939', na: [] }, 'lavaan');
  const hs = { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  const K = (name: string, ind: string[]) => ({ id: name, name, type: 'factor' as const, mode: 'A' as const, indicators: ind, x: 0, y: 0, side: 'left' as const });
  const setup = () => {
    useStore.setState({ model: { constructs: [K('visual', ['x1', 'x2', 'x3']), K('textual', ['x4', 'x5', 'x6']), K('speed', ['x7', 'x8', 'x9'])],
      paths: [{ id: 'p1', from: 'visual', to: 'textual' }, { id: 'p2', from: 'visual', to: 'speed' }, { id: 'p3', from: 'textual', to: 'speed' }], moderations: [] } });
    useStore.getState().setSettings({ method: 'cbsem', engine: 'r', estimator: 'ML', missing: 'casewise' });
  };
  const cmp = await runAsCard<{ params: { label: string }[] }>('cbcompare', hs, { kinds: ['paths'] }, setup);
  expect(cmp.result.params.map((p) => p.label)).toEqual(['visual → textual', 'visual → speed', 'textual → speed']);
  expect(cmp.html).toContain('Critical ratios for differences');
  const w = await runAsCard<{ factors: string[] }>('scoreweights', hs, { method: 'regression' }, setup);
  expect(w.result.factors).toEqual(['visual', 'textual', 'speed']);
  expect(w.html).toContain('Factor score weights (regression)');
}, 900_000);

it('network analysis (bootnet) and EGA (EGAnet) as cards', async () => {
  const { rCall } = await import('../rengine/bridge');
  const load = async (pkg: 'psych' | 'EGAnet', name: string) => {
    const raw = await rCall<{ names: string[]; cols: (number | null)[][] }>('ps_dataset', { package: pkg, name, na: [] }, pkg);
    return { names: raw.names, cols: raw.cols.map((c) => Float64Array.from(c, (v) => (typeof v === 'number' ? v : NaN))) };
  };
  const net = await runAsCard<{ names: string[] }>('network', await load('psych', 'bfi'), { vars: ['A1', 'A2', 'A3', 'C1', 'C2', 'C3'], corMethod: 'cor' });
  expect(net.result.names).toHaveLength(6);
  expect(net.html).toContain('Centrality');
  const ega = await runAsCard<{ dims: number }>('ega', await load('EGAnet', 'wmt2'), { vars: Array.from({ length: 18 }, (_, i) => `wmt${i + 1}`) });
  expect(ega.result.dims).toBe(2);
  expect(ega.html).toContain('Dimensions: 2');
}, 900_000);
