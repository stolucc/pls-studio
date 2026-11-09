// @vitest-environment happy-dom
// The Model fit tab and the Dynamic fit cutoffs card: a link that opens the card for the model on the canvas, and,
// while a card's run is current for that model (the card's fingerprint against the model, settings and data now, as
// out-of-date cards are detected), the DFI cutoffs as a column beside the fixed ones, gone when the model changes.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { addAnalysis, currentCtx, loadCards, useAnalyses } from '../../analyses/store';
import { dfiAnalysis } from '../../analyses/dfi';
import { dfiForFit, openDfiCard } from '../../analyses/dfiFit';
import type { CbResult } from '../../engine/cbsem';
import type { DfiArgs, DfiResult } from '../../rengine/dfi';
import type { ModelState } from '../../model/project';
import { useStore } from '../../store';
import { CbTab } from './CbTabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(el: React.ReactElement) {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(el));
  const html = host.innerHTML;
  act(() => root.unmount());
  return html;
}

const K = (id: string, inds: string[]) => ({ id, name: id, type: 'factor' as const, mode: 'A' as const, indicators: inds, x: 0, y: 0, side: 'left' as const });
const model: ModelState = { constructs: [K('F1', ['x1', 'x2', 'x3']), K('F2', ['x4', 'x5', 'x6']), K('F3', ['x7', 'x8', 'x9'])], paths: [], moderations: [] };
const names = ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8', 'x9'];
const data = { names, cols: names.map((_, k) => Float64Array.from({ length: 40 }, (_, i) => Math.sin(i * (k + 1)) * 2)) };
const fit = { chisq: 85.306, df: 24, pvalue: 0, baselineChisq: 918.852, baselineDf: 36, cfi: 0.931, tli: 0.896, rmsea: 0.092, rmseaLow: 0.071, rmseaHigh: 0.114, rmseaP: 0.001, srmr: 0.065, aic: 7517.5, bic: 7595.3, logl: -3737.7, npar: 21 };
const cb = { fit, estimator: 'ML', n: 301, iterations: 35, warnings: [], constructs: ['F1', 'F2', 'F3'], estimates: [], moderations: [] } as unknown as CbResult;
const options: DfiArgs = { fn: 'cfaHB', reps: 500, estimator: '', scale: 'normal', mad: [0.038, 0.05, 0.06] };
const result: DfiResult = {
  fn: 'cfaHB', reps: 500, n: 301, estimator: null, scale: null, data: null, equiv: null, printed: [], warnings: [], engine: { package: 'dynamic', version: '1.1.0' },
  cutoffs: { rows: ['Level-0', 'Specificity', '', 'Level-1', 'Sensitivity', '', 'Level-2', 'Sensitivity'], columns: ['SRMR', 'RMSEA', 'CFI', 'Magnitude'],
    cells: [['0.04', '0.042', '0.985', 'NONE'], ['95%', '95%', '95%', ''], ['', '', '', ''], ['0.041', '0.042', '0.985', '0.424'], ['85%', '90%', '87%', ''], ['', '', '', ''], ['0.06', '0.086', '0.957', '0.57'], ['95%', '95%', '95%', '']] },
  fit: { rows: [''], columns: ['Chi-Square', 'df', 'p-value', 'SRMR', 'RMSEA', 'CFI'], cells: [['85.306', '24', '0', '0.065', '0.092', '0.931']] },
};

const html = () => render(<CbTab tab="fit" cb={cb} boot={null} />);

describe('the Model fit tab and the Dynamic fit cutoffs card', () => {
  beforeEach(() => {
    const s = useStore.getState();
    s.newProject();
    s.setData(data, { fileName: 'hs.csv', rows: 40, missingCells: 0, excluded: [] });
    useStore.setState({ model, settings: { ...s.settings, method: 'cbsem', engine: 'r', estimator: 'ML' } });
    loadCards([]);
    useAnalyses.setState({ results: {}, running: {}, selected: null });
  });

  it('offers a link to the card and no cutoff column without a run', () => {
    const out = html();
    expect(out).toContain('Dynamic cutoffs for this model…');
    expect(out).not.toContain('Dynamic cutoffs (dynamic::');
    expect(out).toContain('Hu &amp; Bentler (1999) cutoffs');
    expect(dfiForFit(currentCtx(), useAnalyses.getState().cards, {}, {})).toBeNull();
  });

  it('the link adds a card preset for the model (or focuses the existing one) and opens the Analyses tab', () => {
    openDfiCard();
    const cards = useAnalyses.getState().cards;
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: 'analysis', type: 'dynamicfit', options: { fn: 'cfaHB', reps: 500 } });
    expect(useStore.getState().workspace).toBe('analyses');
    useAnalyses.setState({ selected: null });
    openDfiCard();
    expect(useAnalyses.getState().cards).toHaveLength(1);
    expect(useAnalyses.getState().selected).toBe(cards[0].id);
  });

  it('shows a current run’s cutoffs beside the fixed ones, naming the card, and drops them when the model changes', () => {
    const id = addAnalysis('dynamicfit', options)!;
    const fingerprint = dfiAnalysis.fingerprint(options, currentCtx())!;
    useAnalyses.setState((st) => ({ cards: st.cards.map((k) => (k.id === id && k.kind === 'analysis' ? { ...k, run: { at: 1700000000000, fingerprint, options: JSON.stringify(options) } } : k)), results: { [id]: result } }));
    expect(dfiForFit(currentCtx(), useAnalyses.getState().cards, useAnalyses.getState().results, {})?.card.id).toBe(id);
    const out = html();
    expect(out).toContain('Dynamic cutoffs (dynamic::cfaHB)');
    expect(out).toContain('L1 .041 · L2 .060 — clears no level');
    expect(out).toContain('L1 .985 · L2 .957 — clears no level');
    expect(out).toContain('Dynamic fit index cutoffs from the card “Dynamic fit cutoffs” (dynamic::cfaHB, 500 replications');
    expect(out).toContain('disappear when the model, its settings or the data change');
    // A running card is not current; neither is one whose model changed.
    useAnalyses.setState({ running: { [id]: true } });
    expect(dfiForFit(currentCtx(), useAnalyses.getState().cards, useAnalyses.getState().results, useAnalyses.getState().running)).toBeNull();
    useAnalyses.setState({ running: {} });
    useStore.setState({ model: { ...model, constructs: model.constructs.slice(0, 2) } });
    const changed = html();
    expect(changed).not.toContain('Dynamic cutoffs (dynamic::');
    expect(changed).toContain('Dynamic cutoffs for this model…');
    useStore.setState({ model });
    expect(html()).toContain('Dynamic cutoffs (dynamic::cfaHB)');
    useStore.setState({ settings: { ...useStore.getState().settings, estimator: 'MLR' } });
    expect(html()).not.toContain('Dynamic cutoffs (dynamic::');
  });

  it('prefers the latest current run when several cards have one', () => {
    const a = addAnalysis('dynamicfit', options)!, b = addAnalysis('dynamicfit', { ...options, fn: 'exactFit' })!;
    const fp = (o: typeof options) => dfiAnalysis.fingerprint(o, currentCtx())!;
    const exact: DfiResult = { ...result, fn: 'exactFit', cutoffs: { rows: ['99th:', '95th:'], columns: ['Chi-Square', 'df', 'SRMR', 'RMSEA', 'CFI'], cells: [['42.447', '24', '0.043', '0.051', '0.977'], ['36.553', '24', '0.04', '0.042', '0.985']] } };
    useAnalyses.setState((st) => ({
      cards: st.cards.map((k) => (k.kind !== 'analysis' ? k : k.id === a ? { ...k, run: { at: 1, fingerprint: fp(options), options: JSON.stringify(options) } } : { ...k, run: { at: 2, fingerprint: fp({ ...options, fn: 'exactFit' }), options: JSON.stringify({ ...options, fn: 'exactFit' }) } })),
      results: { [a]: result, [b]: exact },
    }));
    const out = html();
    expect(out).toContain('Dynamic cutoffs (dynamic::exactFit)');
    expect(out).toContain('99th 42.447 · 95th 36.553 — beyond the 99th percentile of exact fit');
  });
});
