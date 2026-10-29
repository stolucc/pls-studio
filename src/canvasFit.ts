// Fitting the diagram into view below the toolbars that float over the top of
// the canvas (the tool dock, and in CPA the PROCESS bar): React Flow's fitView
// frames the nodes in the whole canvas, so they could end up under the bars.

/** Padding for fitView: `side` (a fraction of the view) on three sides; at the top, below the bars. */
export function fitPadding(side: number, overlayBottom: number, gap = 16) {
  return { top: `${Math.round(Math.max(0, overlayBottom) + gap)}px` as const, right: side, bottom: side, left: side };
}

/** How far the floating bars reach into the canvas from its top (pixels; 0 without bars). */
export function overlayBottom(wrap: HTMLElement | null): number {
  if (!wrap) return 0;
  const top = wrap.getBoundingClientRect().top;
  let bottom = 0;
  for (const el of wrap.querySelectorAll<HTMLElement>('.tool-dock, .process-bar')) bottom = Math.max(bottom, el.getBoundingClientRect().bottom - top);
  return bottom;
}
