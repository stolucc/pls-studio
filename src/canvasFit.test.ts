import { describe, expect, it } from 'vitest';
import { fitPadding, overlayBottom } from './canvasFit';

const box = (top: number, bottom: number) => ({ getBoundingClientRect: () => ({ top, bottom }) });

describe('fitting the diagram below the floating bars', () => {
  it('pads the top by how far the bars reach, the other sides by the fraction', () => {
    expect(fitPadding(0.2, 120)).toEqual({ top: '136px', right: 0.2, bottom: 0.2, left: 0.2 });
    expect(fitPadding(0.35, 0)).toEqual({ top: '16px', right: 0.35, bottom: 0.35, left: 0.35 });
    expect(fitPadding(0.2, -5, 0).top).toBe('0px');
    expect(fitPadding(0.2, 10.6, 0).top).toBe('11px');
  });
  it('measures the lowest bar relative to the canvas', () => {
    expect(overlayBottom(null)).toBe(0);
    const wrap = { ...box(100, 900), querySelectorAll: (sel: string) => (expect(sel).toBe('.tool-dock, .process-bar'), [box(112, 156), box(160, 240)]) };
    expect(overlayBottom(wrap as unknown as HTMLElement)).toBe(140);
    const none = { ...box(100, 900), querySelectorAll: () => [] };
    expect(overlayBottom(none as unknown as HTMLElement)).toBe(0);
  });
});
