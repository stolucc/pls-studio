// A snapshot's diagram as an image: large models (well over 100 kB of SVG)
// encode too (spreading every byte into one call overflowed the stack).
import { describe, expect, it } from 'vitest';
import { diagramSrc } from './snapshot';

describe('diagramSrc', () => {
  it('encodes a large SVG with non-ASCII labels, and it decodes back', () => {
    const label = '<text>Zufriedenheit α–ω</text>';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">${label.repeat(8000)}</svg>`;
    expect(new TextEncoder().encode(svg).length).toBeGreaterThan(200_000);
    const src = diagramSrc(svg);
    expect(src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const b64 = src.slice('data:image/svg+xml;base64,'.length);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe(svg);
  });
});
