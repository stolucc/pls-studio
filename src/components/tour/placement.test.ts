// Where the tour's card goes: beside the target with room, on screen, not over the target.

import { describe, expect, it } from 'vitest';
import { GAP, MARGIN, placeCard, spotlightBox, type Box } from './placement';

const view = { w: 1280, h: 800 };
const card = { w: 380, h: 260 };
const overlaps = (a: Box, b: Box) =>
  !(a.x >= b.x + b.w || a.x + a.w <= b.x || a.y >= b.y + b.h || a.y + a.h <= b.y);
const onScreen = (p: { x: number; y: number }, v = view) =>
  p.x >= MARGIN && p.y >= MARGIN && p.x + card.w <= v.w - MARGIN && p.y + card.h <= v.h - MARGIN;

describe('placeCard', () => {
  it('centres the card without a target', () => {
    const p = placeCard(null, card, view);
    expect(p.side).toBe('centre');
    expect(p.x).toBe((view.w - card.w) / 2);
    expect(p.y).toBe((view.h - card.h) / 2);
  });

  it('puts the card on the preferred side when it fits there', () => {
    const t = { x: 600, y: 10, w: 120, h: 30 };
    const p = placeCard(t, card, view, 'bottom');
    expect(p.side).toBe('bottom');
    expect(p.y).toBe(t.y + t.h + GAP);
    expect(onScreen(p)).toBe(true);
    expect(overlaps({ ...p, ...card }, t)).toBe(false);
  });

  it('flips to another side when the preferred one has no room', () => {
    // A button at the top right: no room above, nor to its right.
    const t = { x: 1180, y: 10, w: 90, h: 30 };
    for (const preferred of ['top', 'right'] as const) {
      const p = placeCard(t, card, view, preferred);
      expect(p.side, preferred).not.toBe(preferred);
      expect(onScreen(p), preferred).toBe(true);
      expect(overlaps({ ...p, ...card }, t), preferred).toBe(false);
    }
  });

  it('keeps the card beside a tall side panel, level with it as far as the window allows', () => {
    const t = { x: 980, y: 52, w: 300, h: 748 };
    const p = placeCard(t, card, view);
    expect(p.side).toBe('left');
    expect(onScreen(p)).toBe(true);
    expect(overlaps({ ...p, ...card }, t)).toBe(false);
  });

  it('overlaps a wide panel at the bottom of a short window as little as it can', () => {
    const small = { w: 1024, h: 700 };
    const t = { x: 260, y: 372, w: 520, h: 328 };
    const tall = { w: 380, h: 420 };
    const p = placeCard(t, tall, small);
    expect(p.side).toBe('top');
    expect(p.y).toBe(MARGIN);
    // (covering only the panel's top: 12 + 420 − 372 = 60 px)
    expect(p.y + tall.h - t.y).toBe(60);
  });

  it('puts the card inside a target that covers most of the window', () => {
    const t = { x: 264, y: 52, w: 734, h: 748 };
    const p = placeCard(t, card, view);
    expect(p.side).toBe('over');
    expect(onScreen(p)).toBe(true);
    expect(p.x + card.w).toBeLessThanOrEqual(t.x + t.w);
  });

  it('stays on screen in a window smaller than the card', () => {
    const tiny = { w: 300, h: 200 };
    const p = placeCard({ x: 10, y: 10, w: 20, h: 20 }, card, tiny);
    expect(p.x).toBeGreaterThanOrEqual(MARGIN);
    expect(p.y).toBeGreaterThanOrEqual(MARGIN);
  });
});

describe('spotlightBox', () => {
  it('pads the target and keeps the hole inside the window', () => {
    expect(spotlightBox({ x: 100, y: 100, w: 50, h: 20 }, view)).toEqual({
      x: 94,
      y: 94,
      w: 62,
      h: 32,
    });
    const edge = spotlightBox({ x: -10, y: 790, w: 50, h: 40 }, view);
    expect(edge.x).toBe(0);
    expect(edge.y + edge.h).toBe(800);
  });
});
