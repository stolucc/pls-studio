// @vitest-environment happy-dom
// Number fields give their value as text: typing into one must set the option, not reset it to its default.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { rebusAnalysis } from './segmentation';
import type { AnalysisCtx } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const names = ['a1', 'a2', 'b1', 'b2'];
const data = {
  names,
  cols: names.map((_, k) =>
    Float64Array.from({ length: 40 }, (_, i) => Math.sin(i * (k + 1.3)) + (i % (k + 2))),
  ),
};
const model: ModelState = {
  constructs: [
    {
      id: 'A',
      name: 'A',
      type: 'factor',
      mode: 'A',
      indicators: ['a1', 'a2'],
      x: 0,
      y: 0,
      side: 'left',
    },
    {
      id: 'B',
      name: 'B',
      type: 'factor',
      mode: 'A',
      indicators: ['b1', 'b2'],
      x: 300,
      y: 0,
      side: 'left',
    },
  ],
  paths: [{ id: 'p', from: 'A', to: 'B' }],
  moderations: [],
};
const ctx: AnalysisCtx = {
  data,
  info: null,
  settings: { ...DEFAULT_SETTINGS, method: 'pls' },
  pls: null,
  projectName: 'p',
  model,
} as AnalysisCtx;

it('sets the typed number, clamped to the field’s range', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const set = vi.fn();
  act(() =>
    root.render(
      <rebusAnalysis.Options
        options={rebusAnalysis.defaults(ctx)}
        set={set}
        ctx={ctx}
        disabled={false}
      />,
    ),
  );
  const type = (label: string, text: string) => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    return set.mock.lastCall![0];
  };
  expect(type('To', '5').to).toBe(5);
  expect(type('To', '9').to).toBe(6);
  expect(type('From', '3').from).toBe(3);
  act(() => root.unmount());
});
