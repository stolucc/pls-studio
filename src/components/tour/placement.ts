// Where the tour's card goes: beside its target on the first side with room for it, kept on screen.

import type { Side } from './types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placed {
  x: number;
  y: number;
  /** The side of the target the card is on; 'over' when no side had room; 'centre' without a target. */
  side: Side | 'over' | 'centre';
}

/** Space kept between the card and the window's edge, and between the card and its target. */
export const MARGIN = 12;
export const GAP = 14;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The card's position on one side of the target, or null when it does not fit there. */
function onSide(
  side: Side,
  t: Box,
  card: { w: number; h: number },
  view: { w: number; h: number },
) {
  const maxX = view.w - MARGIN - card.w;
  const maxY = view.h - MARGIN - card.h;
  if (maxX < MARGIN || maxY < MARGIN) return null;
  if (side === 'right' || side === 'left') {
    const x = side === 'right' ? t.x + t.w + GAP : t.x - GAP - card.w;
    if (x < MARGIN || x > maxX) return null;
    // Level with the target's centre, as far as the window allows.
    return { x, y: clamp(t.y + t.h / 2 - card.h / 2, MARGIN, maxY) };
  }
  const y = side === 'bottom' ? t.y + t.h + GAP : t.y - GAP - card.h;
  if (y < MARGIN || y > maxY) return null;
  return { x: clamp(t.x + t.w / 2 - card.w / 2, MARGIN, maxX), y };
}

/**
 * The card's top-left corner. Tries the preferred side, then right, left, below and above. Without
 * room on any side, the card goes on the roomiest side, overlapping the target as little as it can;
 * a target covering most of the window (the diagram) gets the card inside its top-right corner.
 */
export function placeCard(
  target: Box | null,
  card: { w: number; h: number },
  view: { w: number; h: number },
  preferred?: Side,
): Placed {
  const centre = {
    x: Math.max(MARGIN, (view.w - card.w) / 2),
    y: Math.max(MARGIN, (view.h - card.h) / 2),
  };
  if (!target) return { ...centre, side: 'centre' };
  const order: Side[] = ['right', 'left', 'bottom', 'top'];
  const sides = preferred ? [preferred, ...order.filter((s) => s !== preferred)] : order;
  for (const side of sides) {
    const at = onSide(side, target, card, view);
    if (at) return { ...at, side };
  }
  const maxX = Math.max(MARGIN, view.w - MARGIN - card.w);
  const maxY = Math.max(MARGIN, view.h - MARGIN - card.h);
  // A target of moderate size (the results panel in a short window): the side with the most room,
  // the card covering as little of the target as it can.
  const visible = {
    w: Math.min(target.x + target.w, view.w) - Math.max(target.x, 0),
    h: Math.min(target.y + target.h, view.h) - Math.max(target.y, 0),
  };
  if (visible.w * visible.h < 0.5 * view.w * view.h) {
    const room: [Side, number][] = [
      ['top', target.y - card.h],
      ['bottom', view.h - (target.y + target.h) - card.h],
      ['left', target.x - card.w],
      ['right', view.w - (target.x + target.w) - card.w],
    ];
    const [side] = room.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (side === 'top' || side === 'bottom') {
      const y = side === 'top' ? MARGIN : maxY;
      return { x: clamp(target.x + target.w / 2 - card.w / 2, MARGIN, maxX), y, side };
    }
    const x = side === 'left' ? MARGIN : maxX;
    return { x, y: clamp(target.y + target.h / 2 - card.h / 2, MARGIN, maxY), side };
  }
  return {
    x: clamp(target.x + target.w - card.w - GAP, MARGIN, maxX),
    y: clamp(target.y + GAP, MARGIN, maxY),
    side: 'over',
  };
}

/** The spotlight's hole: the target with some padding, kept inside the window. */
export function spotlightBox(target: Box, view: { w: number; h: number }, pad = 6): Box {
  const x = clamp(target.x - pad, 0, view.w);
  const y = clamp(target.y - pad, 0, view.h);
  const right = clamp(target.x + target.w + pad, 0, view.w);
  const bottom = clamp(target.y + target.h + pad, 0, view.h);
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}
