// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { standaloneSvg } from './standalone';

describe('standaloneSvg', () => {
  it('inlines computed styles, drops classes, sizes the document and adds a white background', () => {
    const style = document.createElement('style');
    style.textContent = '.line { stroke: rgb(109, 40, 217); stroke-width: 2px; fill: none; }';
    document.head.appendChild(style);
    document.body.innerHTML =
      '<svg class="jn"><path class="line" d="M0 0 L10 10"/><text>x</text></svg>';
    const out = standaloneSvg(document.querySelector('svg')!, 320, 200);
    const doc = new DOMParser().parseFromString(out, 'image/svg+xml');
    const path = doc.querySelector('path')!;
    expect(path.getAttribute('stroke')).toBe('rgb(109, 40, 217)');
    expect(path.getAttribute('stroke-width')).toBe('2px');
    expect(path.getAttribute('class')).toBeNull();
    expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 320 200');
    expect(doc.querySelector('rect')!.getAttribute('fill')).toBe('#ffffff');
    // The original on screen is untouched.
    expect(document.querySelector('path')!.getAttribute('class')).toBe('line');
  });
});
