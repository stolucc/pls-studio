// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useCompute } from '../../rengine/compute';
import { useHelper } from '../../rengine/helper';
import { useStore } from '../../store';
import { helperLine, RunWhere } from './RunWhere';

const engine = useStore.getState().settings.engine;
// (setSettings refuses while no project of one's own is open)
const setEngine = (e: 'r' | 'builtin') =>
  useStore.setState((s) => ({ settings: { ...s.settings, engine: e } }));
const backend = useCompute.getState().backend;
/** The rendered markup (a client render: the stores' current state, not their initial one). */
function html(el: React.ReactElement): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(el));
  const out = host.innerHTML;
  act(() => root.unmount());
  return out;
}

afterEach(() => {
  setEngine(engine);
  useCompute.getState().set({ backend });
  useHelper.setState({ state: 'unknown', info: null });
});

describe('where a card calculates, above Run', () => {
  it('a card with the engine choice shows it; the built-in engine needs no R choice', () => {
    setEngine('builtin');
    const out = html(<RunWhere engineChoice />);
    expect(out).toContain('Calculated by');
    expect(out).toContain('the model on the Model tab uses it too');
    expect(out).not.toContain('R runs in');
    setEngine('r');
    expect(html(<RunWhere engineChoice />)).toContain('R runs in');
  });

  it('other cards show only where R runs, with the helper’s state', () => {
    setEngine('builtin');
    useCompute.getState().set({ backend: 'helper' });
    useHelper.setState({
      state: 'ready',
      info: { helperVersion: '0.1.14', r: '4.6.0', workers: 8 },
    });
    const out = html(<RunWhere engineChoice={false} />);
    expect(out).not.toContain('Calculated by');
    expect(out).toContain('R runs in');
    expect(out).toContain('Desktop R 4.6.0 through helper 0.1.14 (8 processes).');
  });

  it('says why R falls back to the browser', () => {
    expect(helperLine('mismatch', null)).toMatch(/older R code than this site/);
    expect(helperLine('absent', null)).toMatch(/No helper found/);
    expect(helperLine('unpaired', null)).toMatch(/not connected/);
    expect(helperLine('checking', null)).toBe('Looking for the helper…');
  });
});
