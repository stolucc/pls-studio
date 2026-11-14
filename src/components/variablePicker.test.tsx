// @vitest-environment happy-dom
// The checkbox list of many variables (VariablePicker): a click on a name or on its checkbox ticks it at
// once, exactly once, and the box shows the new state right away (it used to show it one click late when
// the box itself was clicked); shift-click chooses a range.

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { VariablePicker } from './VariablePicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COLUMNS = ['q1', 'q2', 'q3', 'q4', 'q5'];
let host: HTMLDivElement;
let root: Root;
let chosen: string[] = [];

function Harness() {
  const [value, setValue] = useState<string[]>([]);
  chosen = value;
  return <VariablePicker columns={COLUMNS} value={value} onChange={setValue} />;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const labels = () => [...host.querySelectorAll<HTMLLabelElement>('.var-check')];
const boxes = () => [...host.querySelectorAll<HTMLInputElement>('.var-check input')];
const ticks = () =>
  boxes()
    .map((b) => (b.checked ? 1 : 0))
    .join('');

describe('VariablePicker', () => {
  it('ticks a variable once when its name is clicked', () => {
    act(() => labels()[1].querySelector('span')!.click());
    expect(chosen).toEqual(['q2']);
    expect(ticks()).toBe('01000');
    act(() => labels()[1].querySelector('span')!.click());
    expect(chosen).toEqual([]);
    expect(ticks()).toBe('00000');
  });

  it('shows the tick at once when the checkbox itself is clicked, on and off', () => {
    act(() => boxes()[2].click());
    expect(chosen).toEqual(['q3']);
    expect(ticks()).toBe('00100');
    act(() => boxes()[3].click());
    expect(chosen).toEqual(['q3', 'q4']);
    expect(ticks()).toBe('00110');
    act(() => boxes()[2].click());
    expect(chosen).toEqual(['q4']);
    expect(ticks()).toBe('00010');
  });

  it('chooses a range with shift-click', () => {
    act(() => labels()[0].querySelector('span')!.click());
    // (on the checkbox: happy-dom's click forwarded by a label drops the shift key, browsers keep it —
    //  checked in Chromium for shift-clicks on the name and on the box)
    act(() => {
      boxes()[3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    });
    expect(chosen).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(ticks()).toBe('11110');
  });
});
