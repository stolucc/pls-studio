// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CbResult } from '../../engine/cbsem';
import { MI_SIGNIFICANT, miAtLeast, miMinimum } from '../../reporting/modindices';
import { CbTab } from './CbTabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = (cb: Partial<CbResult>) =>
  renderToStaticMarkup(<CbTab tab="modindices" cb={cb as CbResult} boot={null} />);

const index = (rhs: string, mi: number) => ({ lhs: 'F', op: '=~', rhs, mi, epc: 0.3, sepc: 0.2 });
// (largest first, as the bridge sends them)
const all = [index('x4', 12.5), index('x5', 3.84), index('x6', 2.1), index('x7', 0.4)];

describe('modification indices tab', () => {
  it('tells apart: not computed, lavaan could not compute them, none at all, none reaching 3.84', () => {
    expect(html({})).toContain('computed by lavaan');
    expect(
      html({ modindices: [], modindicesError: 'not available for models with composites (<~)' }),
    ).toContain('not available for this model. lavaan: not available for models with composites');
    expect(html({ modindices: [] })).toContain('no fixed parameter could be freed');
    const small = html({ modindices: [index('x6', 2.1)] });
    expect(small).toContain('No modification index reaches 3.84');
    expect(small).toContain('The largest is 2.100');
  });

  it('shows the indices at or above 3.84 by default, with how many of all', () => {
    const out = html({ modindices: all });
    expect(out).toContain('F =~ x4');
    expect(out).toContain('F =~ x5');
    expect(out).not.toContain('F =~ x6');
    expect(out).toContain('2 of 4 shown');
  });
});

describe('the minimum', () => {
  it('reads any number from 0 up; empty or not a number gives 3.84', () => {
    expect(miMinimum('1.5')).toBe(1.5);
    expect(miMinimum('0')).toBe(0);
    expect(miMinimum('-2')).toBe(0);
    expect(miMinimum('')).toBe(MI_SIGNIFICANT);
    expect(miMinimum('abc')).toBe(MI_SIGNIFICANT);
    expect(miAtLeast(all, 3.84).map((m) => m.rhs)).toEqual(['x4', 'x5']);
    expect(miAtLeast(all, 0).map((m) => m.rhs)).toEqual(['x4', 'x5', 'x6', 'x7']);
  });
});

describe('typing a minimum into the field', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const type = (value: string) => {
    const input = host.querySelector<HTMLInputElement>('.mi-filter input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const shown = () => host.querySelectorAll('tbody tr').length;

  it('filters at once, respects a value below 3.84, and resets to 3.84', () => {
    act(() =>
      root.render(<CbTab tab="modindices" cb={{ modindices: all } as CbResult} boot={null} />),
    );
    expect(shown()).toBe(2);

    type('1');
    expect(shown()).toBe(3);
    expect(host.textContent).toContain('3 of 4 shown');
    expect(host.textContent).toContain('Below 3.84, freeing the parameter would not improve fit');

    type('0');
    expect(shown()).toBe(4);

    type('20');
    expect(shown()).toBe(0);
    expect(host.textContent).toContain('No modification index reaches 20');

    const reset = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Reset to 3.84'),
    )!;
    act(() => reset.click());
    expect(shown()).toBe(2);
  });
});
