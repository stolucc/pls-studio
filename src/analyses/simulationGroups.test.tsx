// @vitest-environment happy-dom
// The second group of a two-group design lists only the paths that differ from the first group's, so a path
// left alone follows the first group (McDesign.groups).
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { McDesign } from '../engine/montecarlo';
import { DEFAULT_SETTINGS, type ModelState } from '../model/project';
import { mcAnalysis as t } from './simulation';
import type { AnalysisCtx } from './types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const K = (id: string) => ({
  id,
  name: id,
  type: 'factor' as const,
  mode: 'A' as const,
  indicators: [1, 2, 3].map((i) => `${id.toLowerCase()}${i}`),
  x: 0,
  y: 0,
  side: 'left' as const,
});
const model: ModelState = {
  constructs: [K('A'), K('B'), K('C')],
  paths: [
    { id: 'p', from: 'A', to: 'C' },
    { id: 'q', from: 'B', to: 'C' },
  ],
  moderations: [],
};
const ctx: AnalysisCtx = {
  data: null,
  info: null,
  settings: { ...DEFAULT_SETTINGS, engine: 'r' },
  pls: null,
  projectName: 'p',
  model,
};

function mount(options: McDesign, set: (d: McDesign) => void) {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(<t.Options options={options} set={set} ctx={ctx} disabled={false} />));
  return { host, unmount: () => act(() => root.unmount()) };
}

/** The second group's value field of a path (the row reading "A → C … second"). */
const secondField = (host: HTMLElement, path: string) =>
  [...host.querySelectorAll('.mc-misspec-row')]
    .find((row) => row.textContent?.startsWith(path))!
    .querySelector('input') as HTMLInputElement;

const type = (input: HTMLInputElement, text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });

describe('two groups: the second group’s paths', () => {
  it('start the same as the first group’s and store only the ones changed', () => {
    const d = t.defaults(ctx);
    const first = d.population.paths.find((x) => x.from === 'A')!.value;
    let saved: McDesign | null = null;
    const off = mount(d, (next) => (saved = next));
    const box = [...off.host.querySelectorAll('label.check')]
      .find((l) => l.textContent?.includes('Compare two groups'))!
      .querySelector('input') as HTMLInputElement;
    act(() => box.click());
    expect(saved!.groups).toEqual({ paths: [] });
    off.unmount();

    const on = mount(saved!, (next) => (saved = next));
    expect(Number(secondField(on.host, 'A → C').value)).toBe(first);
    type(secondField(on.host, 'A → C'), '0.6');
    expect(saved!.groups).toEqual({ paths: [{ from: 'A', to: 'C', value: 0.6 }] });
    on.unmount();

    // Set back to the first group's value: listed no more.
    const again = mount(saved!, (next) => (saved = next));
    type(secondField(again.host, 'A → C'), String(first));
    expect(saved!.groups).toEqual({ paths: [] });
    again.unmount();
  });
});
