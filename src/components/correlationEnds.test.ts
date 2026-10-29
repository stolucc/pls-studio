// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { endAt } from './correlationEnds';

describe('correlation ends under the pointer', () => {
  it('finds error terms, disturbances, indicators and constructs', () => {
    document.body.innerHTML = `
      <svg><g data-cor-kind="indicator" data-cor-id="x1"><circle id="e"/></g>
      <g data-cor-kind="construct" data-cor-id="c2" data-cor-via="disturbance"><circle id="z"/></g></svg>
      <div class="react-flow__node" data-id="c1"><svg><g data-ind="x2"><rect id="i"/></g><ellipse id="n"/></svg></div>
      <div id="pane"></div>`;
    const at = (id: string) => endAt(document.getElementById(id));
    expect(at('e')).toEqual({ kind: 'indicator', id: 'x1' });
    expect(at('z')).toEqual({ kind: 'construct', id: 'c2', via: 'disturbance' });
    expect(at('i')).toEqual({ kind: 'indicator', id: 'x2' });
    expect(at('n')).toEqual({ kind: 'construct', id: 'c1' });
    expect(at('pane')).toBeNull();
    expect(endAt(null)).toBeNull();
  });

});
