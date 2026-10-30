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
async function runAsCard<R>(type: string, data: Dataset, options: object): Promise<{ result: R; html: string }> {
  const s = useStore.getState();
  s.newProject();
  s.setData(data, { fileName: 'example.csv', rows: data.cols[0].length, missingCells: 0, excluded: [] });
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
