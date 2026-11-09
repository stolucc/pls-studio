// @vitest-environment happy-dom
// The Factor scores card (id 'scoreweights', once "Factor score weights"): its view has a Scores tab (saving the
// factor scores as data columns, moved here from the CB-SEM Model fit tab) and a Weights tab; the Model fit tab no
// longer offers the scores. Saved projects with the old id and options still load.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CbResult } from '../engine/cbsem';
import { DEFAULT_SETTINGS } from '../model/project';
import type { ScoreWeightsResult } from '../rengine/cbExtras';
import { useStore } from '../store';
import { CbTab } from '../components/results/CbTabs';
import { factorScoresUnavailable } from '../components/results/SaveScores';
import { scoreWeightsAnalysis as card, ScoreWeightsView } from './cbModel';
import { ANALYSIS_TYPES } from './registry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const names = ['a1', 'a2', 'a3'];
const raw = { names, cols: names.map((_, k) => Float64Array.from({ length: 20 }, (_, i) => Math.sin(i * (k + 1)))) };
const info = { fileName: 'd.csv', rows: 20, missingCells: 0, excluded: [] };
const result: ScoreWeightsResult = { method: 'Bartlett', factors: ['F'], variables: names, weights: [[0.1, 0.2, 0.3]] } as ScoreWeightsResult;

let host: HTMLDivElement;
beforeEach(() => {
  useStore.getState().newProject();
  useStore.getState().setData(raw, info);
  useStore.getState().setSettings({ ...DEFAULT_SETTINGS, method: 'cbsem', engine: 'r', estimator: 'ML', missing: 'casewise' });
  host = document.createElement('div');
  document.body.appendChild(host);
});
afterEach(() => host.remove());

describe('the Factor scores card', () => {
  it('keeps its id and old options, under the new title', () => {
    expect(card.id).toBe('scoreweights');
    expect(card.title).toBe('Factor scores');
    expect(ANALYSIS_TYPES.find((t) => t.id === 'scoreweights')?.title).toBe('Factor scores');
    expect(card.parseOptions({ method: 'Bartlett' })).toEqual({ method: 'Bartlett' });
    expect(card.parseOptions({})).toEqual({ method: 'regression' });
  });

  it('shows a Scores tab (save as data columns, the card’s method preselected) and a Weights tab', () => {
    const root = createRoot(host);
    act(() => root.render(<ScoreWeightsView r={result} />));
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('button[role="tab"]')];
    expect(tabs.map((b) => b.textContent)).toEqual(['Scores', 'Weights']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(host.textContent).toContain('Save as data columns');
    expect(host.textContent).toContain('Plausible values');
    expect(host.querySelector('.segmented:not(.efa-tabs) button.on')?.textContent).toBe('Bartlett');
    expect(host.textContent).not.toContain('Factor score weights (Bartlett)');
    act(() => tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(host.textContent).toContain('Factor score weights (Bartlett)');
    expect(host.textContent).not.toContain('Save as data columns');
    act(() => root.unmount());
  });

  it('says why scores cannot be saved for a covariance matrix, robust ML or multiple imputation', () => {
    expect(factorScoresUnavailable(raw, { estimator: 'ML', missing: 'casewise' })).toBeNull();
    expect(factorScoresUnavailable({ names, cols: [], moments: { S: [[1]], n: 10 } }, { estimator: 'ML' })).toMatch(/raw data/);
    expect(factorScoresUnavailable(raw, { estimator: 'RML' })).toMatch(/robust ML/);
    expect(factorScoresUnavailable(raw, { estimator: 'ML', missing: 'mi' })).toMatch(/multiple imputation/);
    useStore.getState().setSettings({ estimator: 'RML' });
    const root = createRoot(host);
    act(() => root.render(<ScoreWeightsView r={result} />));
    expect(host.textContent).toContain('not available with robust ML');
    expect(host.textContent).not.toContain('Save as data columns');
    act(() => root.unmount());
  });
});

describe('the CB-SEM Model fit tab', () => {
  it('no longer offers to save factor scores', () => {
    const cb = {
      estimator: 'ML', n: 20, iterations: 10, converged: true, constructs: ['F'], indicators: names.map((name) => ({ name, construct: 0 })), estimates: [],
      fit: { chisq: 1, df: 1, pvalue: 0.3, cfi: 1, tli: 1, rmsea: 0, rmseaLow: 0, rmseaHigh: 0.1, rmseaP: 0.5, srmr: 0.01, npar: 6, baselineChisq: 50, baselineDf: 3, logl: -1, aic: 2, bic: 3 },
      moderations: [], warnings: [], droppedRows: 0, engine: { package: 'lavaan', version: '0.6' },
    } as unknown as CbResult;
    const root = createRoot(host);  // a client render: it sees the raw data in the store, which the save block needed
    act(() => root.render(<CbTab tab="fit" cb={cb} boot={null} />));
    expect(host.textContent).toContain('Fit statistics');
    expect(host.textContent).not.toContain('Save as data columns');
    expect(host.textContent).not.toContain('Plausible values');
    act(() => root.unmount());
  });
});

describe('the scores themselves (the card shows them, not only a save button)', () => {
  // (column-major, as cbScoresR returns it: one array per factor over the scored rows 1, 2, 4, 5)
  const scores = { method: 'regression' as const, names: ['F1', 'F2'], rows: [1, 2, 4, 5], scores: [[1, 3, -1, 1], [2, 1, 0, 1]], warnings: [], engine: { package: 'lavaan', version: '0.7.3' } };
  const withScores = { ...result, method: 'regression' as const, factors: ['F1', 'F2'], scores };

  it('summarises them, shows the first cases and offers all as CSV', () => {
    const root = createRoot(host);
    act(() => root.render(<ScoreWeightsView r={withScores} />));
    const text = host.textContent ?? '';
    expect(text).toContain('Factor scores (regression): summary');
    expect(text).toContain('Correlations among the scores');
    expect(text).toContain('Scores of the first 4 of 4 cases');
    expect(text).toContain('rows left out of the analysis');  // row 3 has no score
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === 'Download all scores (CSV)')).toBe(true);
    expect(text).toContain('Save as data columns');
    act(() => root.unmount());
  });

  it('many more cases than factors (the shape the app gets), after being packed and unpacked as cards are stored', async () => {
    const { packResult, unpackResult } = await import('./codec');
    const n = 301, big = { ...scores, names: ['F1', 'F2', 'F3'], rows: Array.from({ length: n }, (_, i) => i + 1), scores: [0, 1, 2].map((j) => Array.from({ length: n }, (_, i) => Math.sin(i + j))) };
    const stored = (await unpackResult((await packResult({ ...withScores, factors: big.names, scores: big }))!)) as typeof withScores;
    const root = createRoot(host);
    act(() => root.render(<ScoreWeightsView r={stored} />));
    expect(host.textContent).toContain('Scores of the first 20 of 301 cases');
    const firstRow = [...host.querySelectorAll('table')].find((t) => t.textContent?.includes('Row'))!.querySelectorAll('tbody tr')[0].textContent;
    expect(firstRow).toContain(Math.sin(0).toFixed(3)); expect(firstRow).toContain(Math.sin(1).toFixed(3)); expect(firstRow).toContain(Math.sin(2).toFixed(3));
    act(() => root.unmount());
  });

  it('a result saved before the card computed scores asks for a rerun', () => {
    const root = createRoot(host);
    act(() => root.render(<ScoreWeightsView r={result} />));
    expect(host.textContent).toContain('Run the card again to compute the scores.');
    act(() => root.unmount());
  });

  it('summary statistics and CSV', async () => {
    const { scoreSummary, scoresCsv } = await import('./cbModel');
    const { stats, cor } = scoreSummary(scores);
    expect(stats[0]).toMatchObject({ name: 'F1', n: 4, mean: 1, min: -1, max: 3 });
    expect(stats[0].sd).toBeCloseTo(Math.sqrt(8 / 3), 12);
    expect(cor[0][1]).toBeCloseTo(0.5, 12);  // deviations (0, 2, −2, 0) and (1, 0, −1, 0): 2 / √(8 × 2)
    expect(scoresCsv(scores).split('\n').slice(0, 3)).toEqual(['row,F1,F2', '1,1,2', '2,3,1']);
  });

  it('Run computes the weights and the scores of every case, with the card’s method', async () => {
    const { vi } = await import('vitest');
    const cbExtras = await import('../rengine/cbExtras');
    const lavaan = await import('../rengine/lavaan');
    const w = vi.spyOn(cbExtras, 'scoreWeightsR').mockResolvedValue({ ...result, method: 'regression', warnings: ['w'] } as ScoreWeightsResult);
    const s = vi.spyOn(lavaan, 'cbScoresR').mockResolvedValue({ ...scores, warnings: ['w', 's'] });
    const st = useStore.getState();
    const ctx = { data: st.data, info: st.dataInfo, settings: st.settings, pls: null, projectName: 'p', model: { constructs: [{ id: 'f', name: 'F', type: 'factor', mode: 'A', indicators: names, x: 0, y: 0, side: 'left' }], paths: [], moderations: [] } } as never;
    const r = await card.run({ method: 'regression' }, ctx, () => {});
    expect(w).toHaveBeenCalledOnce();
    expect(s.mock.calls[0][4]).toBe('regression');
    expect(r.scores?.rows).toEqual([1, 2, 4, 5]);
    expect(r.warnings).toEqual(['w', 's']);
    const m = await card.run({ method: 'regression' }, { ...(ctx as object), settings: { ...st.settings, missing: 'mi' } } as never, () => {});
    expect(m.scores).toBeNull();
    expect(m.scoresUnavailable).toMatch(/multiple imputation/);
    w.mockRestore(); s.mockRestore();
  });
});
