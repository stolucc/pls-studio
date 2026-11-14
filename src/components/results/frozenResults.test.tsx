// @vitest-environment happy-dom
// Frozen results (a snapshot or an earlier model run) show only what they
// hold: no sections that read the current model or data, and no buttons that
// re-run or script the current model in their place.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SnapshotView, type SnapshotResult } from '../../analyses/snapshot';
import { cbResult, plsModel, plsResult } from '../../reporting/fixtures';
import { useStore } from '../../store';
import { FrozenResultContext, LiveOnly } from './frozen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useStore.getState().newProject();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const pls = (over: Partial<SnapshotResult> = {}): SnapshotResult => ({
  method: 'pls',
  description: 'PLS-SEM, 250 observations',
  diagram: null,
  pls: plsResult(),
  boot: null,
  level: 0.95,
  ...over,
});

function show(r: SnapshotResult, frozen: boolean, tab: string) {
  act(() => root.render(<SnapshotView r={r} frozen={frozen} />));
  const button = [...host.querySelectorAll('[role="tab"]')].find((b) => b.textContent === tab);
  act(() => (button as HTMLButtonElement).click());
}

const buttons = () => [...host.querySelectorAll('button')].map((b) => b.textContent ?? '');

describe('frozen results', () => {
  it('take the constructs’ types from the result, not from the current model', () => {
    // Satisfaction was a composite when the result was frozen; the model has changed since.
    useStore.setState({
      model: {
        ...plsModel,
        constructs: plsModel.constructs.map((k) => ({ ...k, type: 'factor' as const })),
      },
    });
    show(pls(), true, 'Reliability');
    const row = [...host.querySelectorAll('tr')].find((tr) =>
      tr.textContent?.startsWith('Satisfaction'),
    );
    expect(row?.textContent).toContain('composite');

    show(pls(), false, 'Reliability');
    const live = [...host.querySelectorAll('tr')].find((tr) =>
      tr.textContent?.startsWith('Satisfaction'),
    );
    expect(live?.textContent).toContain('common factor');
  });

  it('offer no re-run or R script of the current model', () => {
    useStore.setState((s) => ({ settings: { ...s.settings, engine: 'r' } }));
    show(pls(), true, 'Bootstrapping');
    expect(host.textContent).toContain('No bootstrap results yet.');
    expect(buttons().some((b) => b.includes('Run bootstrapping'))).toBe(false);
    show(pls(), true, 'Model fit');
    expect(buttons().some((b) => b.includes('bootstrap test'))).toBe(false);
    expect(buttons()).not.toContain('R script');

    show(pls(), false, 'Model fit');
    expect(buttons().some((b) => b.includes('bootstrap test'))).toBe(true);
    expect(buttons()).toContain('R script');
  });

  it('show no invariance run of the current model’s groups (CB-SEM)', () => {
    useStore.setState((s) => ({
      model: { ...s.model, multigroup: { column: 'grp', invariance: 'configural', free: [] } },
    }));
    const r: SnapshotResult = {
      method: 'cbsem',
      description: 'CB-SEM',
      diagram: null,
      cb: cbResult(),
      level: 0.95,
    };
    show(r, true, 'Measurement invariance');
    expect(buttons().some((b) => b.includes('Compare configural'))).toBe(false);
    expect(host.textContent).toContain('not of a multigroup model');

    show(r, false, 'Measurement invariance');
    expect(buttons().some((b) => b.includes('Compare configural'))).toBe(true);
  });

  it('LiveOnly leaves its children out under the frozen context', () => {
    act(() =>
      root.render(
        <>
          <LiveOnly>live</LiveOnly>
          <FrozenResultContext.Provider value>
            <LiveOnly>hidden</LiveOnly>
          </FrozenResultContext.Provider>
        </>,
      ),
    );
    expect(host.textContent).toBe('live');
  });
});
