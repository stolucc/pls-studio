import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_EFA } from '../model/efa';
import { useStore } from '../store';
import { openEfa, useEfa } from './EfaPanel';

describe('openEfa (Analyses menu: factor analysis vs principal components)', () => {
  beforeEach(() => {
    useStore.getState().setSettings({ efa: { ...DEFAULT_EFA, vars: ['a', 'b', 'c'], nfactors: 2, method: 'ml' } });
    useEfa.setState({ open: false });
  });

  it('opens in PCA mode and keeps the rest of the design', () => {
    openEfa(true);
    const d = useStore.getState().settings.efa!;
    expect(d.method).toBe('pca');
    expect(d.vars).toEqual(['a', 'b', 'c']);
    expect(d.nfactors).toBe(2);
    expect(useEfa.getState().open).toBe(true);
  });

  it('keeps an existing factor extraction when opened as factor analysis', () => {
    openEfa(false);
    expect(useStore.getState().settings.efa!.method).toBe('ml');
  });

  it('switches PCA back to minres for factor analysis', () => {
    openEfa(true);
    openEfa(false);
    expect(useStore.getState().settings.efa!.method).toBe('minres');
  });
});
