// Necessary condition analysis in webR against the NCA package in desktop R
// (scripts/validation/nca.R; NCA itself cannot load in the browser's R):
// effect sizes, permutation p-values, accuracy, the CR-FDH line and the
// bottleneck tables on NCA's own example. Run with npm run test:webr.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { parseCsv } from '../engine/dataset';
import { same } from '../validation/record';
import { bottleneckText, ncaR, ncaScriptR } from './nca';
import { startTestRuntime, stopTestRuntime } from './webrTestRuntime';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const ref = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'nca', 'reference.json'), 'utf8'));
const outliersRef = JSON.parse(readFileSync(join(__dirname, '..', 'engine', '__fixtures__', 'nca', 'outliers.json'), 'utf8'));
const data = parseCsv(readFileSync(join(__dirname, '..', '..', 'public', 'examples', 'nca', 'nca_example.csv'), 'utf8')).dataset;

it('equals the NCA package (CE-FDH, CR-FDH, permutation test, bottlenecks)', async () => {
  const r = await ncaR(data, ['Individualism', 'Risk taking'], 'Innovation performance', 100);
  ref.conditions.forEach((c: any, j: number) => {
    const o = r.conditions[j];
    expect(o.x).toBe(c.x);
    expect(o.ceFdh).toBeCloseTo(c.ce, 6);
    expect(o.crFdh).toBeCloseTo(c.cr, 6);
    expect(o.p!.ce_fdh).toBeCloseTo(c.pce, 10);
    expect(o.p!.cr_fdh).toBeCloseTo(c.pcr, 10);
    expect(o.accuracy!).toBeCloseTo(c.accuracy, 6);
    expect(o.slope!).toBeCloseTo(c.slope, 5);
    expect(o.intercept!).toBeCloseTo(c.intercept, 5);
    expect(o.bottleneck.map((b) => bottleneckText(b.crFdh))).toEqual(c.bottleneckCr);
    expect(o.bottleneck.map((b) => bottleneckText(b.ceFdh))).toEqual(c.bottleneckCe);
  });
  expect(await ncaScriptR(data, ['Individualism'], 'Innovation performance', 100)).toContain('nca_peers <- function(x, y)');
}, 900_000);

// scripts/validation/nca-outliers.R: the lists from nca_outliers() (NCA 5), the
// effect sizes and p-values without a case from nca_analysis() (NCA 4.0.2, whose
// reproducible permutation test the card follows; effect sizes agree in both).
it('robustness: potential outliers and effects without them equal the NCA package', async () => {
  const r = await ncaR(data, ['Individualism', 'Risk taking'], 'Innovation performance', 100, true);
  r.conditions.forEach((k, j) => {
    const lists = outliersRef.lists[j];
    const effects = outliersRef.effects[j];
    same(`${k.x}: condition`, k.x, lists.x);
    const rob = k.robustness!;
    const pairs = [
      [rob.outliers.ceFdh, lists.outliers.ce_fdh],
      [rob.outliers.crFdh, lists.outliers.cr_fdh],
    ] as const;
    pairs.forEach(([got, want], c) => {
      const name = `${k.x} ${c === 0 ? 'CE-FDH' : 'CR-FDH'}`;
      same(`${name}: outlier cases`, got.map((o) => o.case).join(' '), want.map((o: any) => o.case).join(' '));
      got.forEach((o, i) => {
        const w = want[i];
        same(`${name} case ${o.case}: ceiling zone`, String(o.ceiling), String(w.ceiling));
        same(`${name} case ${o.case}: scope`, String(o.scope), String(w.scope));
        // (nca_outliers prints 2 decimals, 1 for the percentage)
        expect(o.d!, `${name} case ${o.case}: d without`).toBeCloseTo(w.d, 2);
        expect(o.percent!, `${name} case ${o.case}: change (%)`).toBeCloseTo(w.percent, 1);
        // The exact effect size without the case, from nca_analysis on the reduced data.
        const exact = effects.removed.find((e: any) => e.case === o.case);
        const d = c === 0 ? exact.ce : exact.cr;
        expect(o.d!, `${name} case ${o.case}: d without (exact)`).toBeCloseTo(d, 8);
      });
    });
    // The most influential outlier of each ceiling: d and p of both ceilings without it.
    same(`${k.x}: cases removed`, rob.without.map((w) => w.case).join(' '),
      [...new Set([lists.outliers.ce_fdh[0].case, lists.outliers.cr_fdh[0].case])].join(' '));
    rob.without.forEach((w) => {
      const e = effects.removed.find((x: any) => x.case === w.case);
      same(`${k.x} without ${w.case}: n`, w.n, e.n);
      expect(w.ceFdh!, `${k.x} without ${w.case}: d CE-FDH`).toBeCloseTo(e.ce, 8);
      expect(w.crFdh!, `${k.x} without ${w.case}: d CR-FDH`).toBeCloseTo(e.cr, 8);
      expect(w.p!.ce_fdh, `${k.x} without ${w.case}: p CE-FDH`).toBeCloseTo(e.pce, 10);
      expect(w.p!.cr_fdh, `${k.x} without ${w.case}: p CR-FDH`).toBeCloseTo(e.pcr, 10);
    });
    // All cases: the same as without the robustness checks (reference.json, NCA 4.0.2).
    expect(k.ceFdh, `${k.x}: d CE-FDH (all)`).toBeCloseTo(effects.all.ce, 8);
    expect(k.p!.cr_fdh, `${k.x}: p CR-FDH (all)`).toBeCloseTo(effects.all.pcr, 10);
  });
  const script = await ncaScriptR(data, ['Individualism'], 'Innovation performance', 100, true);
  expect(script).toContain('nca_outliers_one <- function(x, y, r, ceiling)');
}, 900_000);

it('runs as an analysis card: same result, saved with the project, stale when the data change', async () => {
  const { useStore } = await import('../store');
  const { addAnalysis, cardStatus, currentCtx, loadCards, runCard, unpackCard, useAnalyses } = await import('../analyses/store');
  const { parseCards } = await import('../analyses/persist');
  const { parseProject, serializeProject } = await import('../model/project');
  const s = () => useStore.getState();
  s().newProject();
  s().setData(data, { fileName: 'nca_example.csv', rows: data.cols[0].length, missingCells: 0, excluded: [] });
  loadCards([]);
  const id = addAnalysis('nca', { source: 'data', x: ['Individualism', 'Risk taking'], y: 'Innovation performance', permutations: 100 })!;
  await runCard(id);
  expect(useAnalyses.getState().errors[id]).toBeUndefined();
  const r = useAnalyses.getState().results[id] as Awaited<ReturnType<typeof ncaR>>;
  expect(r.conditions[0].ceFdh).toBeCloseTo(ref.conditions[0].ce, 6);
  expect(r.conditions[1].p!.cr_fdh).toBeCloseTo(ref.conditions[1].pcr, 10);

  const text = serializeProject(s().model, s().settings, s().data, s().dataInfo, null, useAnalyses.getState().cards);
  useAnalyses.setState({ results: {} });
  loadCards(parseCards(parseProject(text).analyses));
  await unpackCard(id);
  const back = useAnalyses.getState().results[id] as typeof r;
  expect(back.conditions[0].bottleneck).toEqual(r.conditions[0].bottleneck);
  const card = useAnalyses.getState().cards[0] as Extract<ReturnType<typeof useAnalyses.getState>['cards'][number], { kind: 'analysis' }>;
  expect(cardStatus(card, currentCtx(), false, true).state).toBe('current');

  const k = data.names.indexOf('Individualism');
  s().setData({ ...data, cols: data.cols.map((c, j) => (j === k ? c.map((v, i) => (i === 0 ? v + 1 : v)) : c)) }, s().dataInfo!);
  expect(cardStatus(card, currentCtx(), false, true).state).toBe('stale');
}, 900_000);
