// @vitest-environment happy-dom
// The figure the canvas places its labels on follows the "Implied" toggle: the moderators' implied main effects
// are in it exactly when they are shown (they used to be read from the store, so the toggle did not refresh it).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import type { Construct, ModelState } from '../../model/project';
import { placeModel } from '../../placement';
import { useStore } from '../../store';
import { useEstimateLabels } from './estimates';
import { useFlowGraph } from './useFlowGraph';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const C = (id: string, x: number, y = 0): Construct => ({
  id,
  name: id,
  type: 'factor',
  mode: 'A',
  indicators: [`${id}1`, `${id}2`],
  x,
  y,
  side: 'left',
});
const model: ModelState = {
  constructs: [C('X', 0), C('W', 0, 300), C('Y', 500)],
  paths: [{ id: 'p', from: 'X', to: 'Y' }],
  moderations: [{ id: 'm', moderator: 'W', path: 'p' }],
};

let implied = 0;
function Probe({ show }: { show: boolean }) {
  const settings = useStore((s) => s.settings);
  const estimates = useEstimateLabels(
    model,
    settings.method,
    settings.estimator,
    null,
    false,
    false,
  );
  const { figureInput } = useFlowGraph({
    model,
    placed: placeModel(model, false),
    selection: useStore.getState().selection,
    tool: 'select',
    picked: null,
    implied: [{ from: 'W', to: 'Y' }],
    showImplied: show,
    showErrors: false,
    showIntercepts: false,
    unstd: false,
    results: null,
    estimates,
  });
  implied = figureInput().paths.filter((p) => p.implied).length;
  return null;
}

it('puts the implied main effects in the figure exactly when they are shown', () => {
  useStore.setState({ model, showImpliedEffects: false } as never);
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<Probe show />));
  expect(implied).toBe(1);
  act(() => root.render(<Probe show={false} />));
  expect(implied).toBe(0);
  act(() => root.unmount());
});
