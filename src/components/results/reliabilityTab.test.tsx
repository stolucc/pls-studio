// @vitest-environment happy-dom
// The Reliability tab assesses a composite with Mode A weights like a reflective construct (α,
// ρA, ρC, AVE, as the checklist does: reporting/thresholds.ts rhoADefined) and leaves Mode B
// composites blank. Frozen results do not record the modes, so their composites stay blank.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SnapshotView, type SnapshotResult } from '../../analyses/snapshot';
import { plsModel, plsResult } from '../../reporting/fixtures';
import { useStore } from '../../store';

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

// Image drawn as a composite with Mode A weights; Satisfaction is the Mode B composite.
const model = {
  ...plsModel,
  constructs: plsModel.constructs.map((k) =>
    k.name === 'Image' ? { ...k, type: 'composite' as const, mode: 'A' as const } : k,
  ),
};

const result: SnapshotResult = {
  method: 'pls',
  description: 'PLS-SEM, 250 observations',
  diagram: null,
  pls: plsResult({ types: ['composite', 'composite', 'factor'] }),
  boot: null,
  level: 0.95,
};

function rowOf(frozen: boolean, name: string): string {
  act(() => root.render(<SnapshotView r={result} frozen={frozen} />));
  const tab = [...host.querySelectorAll('[role="tab"]')].find(
    (b) => b.textContent === 'Reliability',
  );
  act(() => (tab as HTMLButtonElement).click());
  const row = [...host.querySelectorAll('tr')].find((tr) => tr.textContent?.startsWith(name));
  return row?.textContent ?? '';
}

it('shows α, ρA, ρC and the AVE of a Mode A composite, nothing for a Mode B one', () => {
  useStore.setState({ model });
  const image = rowOf(false, 'Image');
  expect(image).toContain('composite (Mode A)');
  // The fixture's Image: α 0.72, ρA 0.74, ρC 0.81, AVE 0.58.
  for (const v of ['0.720', '0.740', '0.810', '0.580']) expect(image).toContain(v);
  const satisfaction = rowOf(false, 'Satisfaction');
  expect(satisfaction).toContain('composite');
  expect(satisfaction).not.toContain('0.750');
});

it('shows ρA as not applicable for a Mode A composite with predefined weights', () => {
  const fixed = {
    ...model,
    constructs: model.constructs.map((k) =>
      k.name === 'Image' ? { ...k, predefinedWeights: { im1: 1, im2: 1, im3: 1 } } : k,
    ),
  };
  useStore.setState({ model: fixed });
  const image = rowOf(false, 'Image');
  expect(image).toContain('0.810');
  expect(image).not.toContain('0.740');
});

it('leaves the composites of a frozen result blank (it records no modes)', () => {
  useStore.setState({ model });
  const image = rowOf(true, 'Image');
  expect(image).toContain('composite');
  expect(image).not.toContain('Mode A');
  expect(image).not.toContain('0.810');
});
