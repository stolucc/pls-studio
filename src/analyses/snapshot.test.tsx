// Model snapshots: frozen cards of the model's results. (The session report built from the log: src/report.)
import { beforeEach, describe, expect, it } from 'vitest';
import { parseProject, serializeProject } from '../model/project';
import { useStore } from '../store';
import { parseCards } from './persist';
import { addFrozenCard, cardStatus, currentCtx, loadCards, useAnalyses } from './store';
import { ANALYSIS_TYPES } from './registry';
import type { AnalysisCard } from './types';

beforeEach(() => {
  useStore.getState().newProject();
  useStore.setState({ cloud: null });
  loadCards([]);
  useAnalyses.setState({ results: {}, errors: {} });
});

describe('model snapshots', () => {
  it('are frozen cards: current, never run, not in the Add menu, saved with the project', async () => {
    const id = await addFrozenCard(
      'snapshot',
      { label: 'PLS-SEM model, snapshot 1' },
      { method: 'pls', description: 'cSEM', diagram: '<svg/>', level: 0.95 },
    );
    const card = useAnalyses.getState().cards.find((c) => c.id === id) as AnalysisCard;
    expect(cardStatus(card, currentCtx(), false, true)).toEqual({ state: 'current' });
    expect(
      cardStatus({ ...card, options: { label: 'renamed' } }, currentCtx(), false, true).state,
    ).toBe('current');
    expect(ANALYSIS_TYPES.find((t) => t.id === 'snapshot')!.frozen).toBe(true);
    const s = useStore.getState();
    const back = parseCards(
      parseProject(
        serializeProject(s.model, s.settings, null, null, null, useAnalyses.getState().cards),
      ).analyses,
    );
    expect((back[0] as AnalysisCard).run?.packed).toBeTruthy();
    expect((back[0] as AnalysisCard).options).toEqual({ label: 'PLS-SEM model, snapshot 1' });
  });

  it('are refused to viewers of a shared project', async () => {
    useStore.setState({ cloud: { projectId: 'p', role: 'viewer', status: 'online' } });
    expect(await addFrozenCard('snapshot', { label: 'x' }, { method: 'pls' })).toBeNull();
  });
});
