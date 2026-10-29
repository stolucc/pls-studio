// A self-contained SVG of the path diagram, for export (PDF, PNG, SVG). Uses
// the same geometry as the on-screen diagram; numbers are formatted by the
// figure style. Only plain SVG primitives and standard font families, so
// svg2pdf.js can turn it into vector PDF without embedded fonts.

import { arrowHead, ERR_R, hexagonVertices, QUAD_RISE, type ConstructGeom, type ErrorTerm, type QuadraticLoop } from '../geometry';
import type { Construct } from '../model/project';
import { estimateText, FONT_FAMILY, pathStrokeWidth, type FigureStyle } from './style';

export interface FigureLabel { value: number; p: number | null; fixed?: boolean }

export interface FigureInput {
  /** `observed`: drawn as a rectangle (an observed variable) whatever the construct type. */
  constructs: { c: Construct; geom: ConstructGeom; r2: number | null; indicators: (FigureLabel | null)[]; observed?: boolean }[];
  /** `implied`: a moderator's main effect implied by its moderation (dashed). */
  paths: { x1: number; y1: number; x2: number; y2: number; label: FigureLabel | null; moderated: boolean; implied?: boolean }[];
  /** `loop`: a quadratic effect (Henseler 2021), X's own arrow curving onto its path, tagged X². */
  moderations: { x1: number; y1: number; x2: number; y2: number; label: FigureLabel | null; loop?: QuadraticLoop & { tag: string } }[];
  higherOrder: { x1: number; y1: number; x2: number; y2: number; label: FigureLabel | null }[];
  errors: { term: ErrorTerm; kind: 'indicator' | 'disturbance'; value: number | null }[];
  correlations: { d: string; heads: string[]; lx: number; ly: number; nx: number; ny: number; points: [number, number][]; label: FigureLabel | null }[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => Number(v.toFixed(2));

/** Approximate text width (no font metrics available outside the browser). */
const textWidth = (s: string, size: number) => s.length * size * 0.55;

export function renderFigureSvg(f: FigureInput, style: FigureStyle): { svg: string; width: number; height: number } {
  const fs = style.fontSize;
  const small = fs * 0.85;
  const out: string[] = [];
  const xs: number[] = [], ys: number[] = [];
  const extend = (x: number, y: number) => { xs.push(x); ys.push(y); };

  const label = (x: number, y: number, l: FigureLabel, color: string, anchor: 'middle' | 'start' = 'middle', dx = 0, dy = 0) => {
    const text = l.fixed && Math.abs(l.value - 1) < 1e-12 ? '1' : estimateText(style, l.value, l.p);
    const w = textWidth(text, small) + 8, h = small + 6;
    const left = anchor === 'middle' ? x - w / 2 + dx : x + dx;
    const top = y - h / 2 + dy;
    extend(left, top); extend(left + w, top + h);
    // Always mask the line behind the number; the outline is optional (fixed loadings: dashed).
    const outline = style.labelBoxes || l.fixed ? ` stroke="${l.fixed ? '#7f7f7f' : '#d0d5de'}" stroke-width="0.6"${l.fixed ? ' stroke-dasharray="2 2"' : ''}` : '';
    out.push(`<rect x="${n(left)}" y="${n(top)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 2)}" fill="#ffffff"${outline}/>`);
    out.push(`<text x="${n(left + w / 2)}" y="${n(top + h / 2 + small * 0.35)}" font-size="${n(small)}" text-anchor="middle" fill="${color}">${esc(text)}</text>`);
  };
  const tone = (p: number | null) => (p === null || p < 0.05 ? style.labelSignificant : style.labelNonSignificant);
  const line = (x1: number, y1: number, x2: number, y2: number, color: string, width: number, head: boolean, dash = '') => {
    extend(x1, y1); extend(x2, y2);
    out.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${color}" stroke-width="${n(width)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    if (head) out.push(`<path d="${arrowHead(x2, y2, x2 - x1, y2 - y1, 6 + width * 2, 2.5 + width)}" fill="${color}"/>`);
  };

  // Correlations and moderators first, so constructs draw over their ends.
  for (const k of f.correlations) {
    for (const [x, y] of k.points) extend(x, y);
    out.push(`<path d="${k.d}" fill="none" stroke="${style.correlationColor}" stroke-width="${n(style.pathWidth * 0.8)}"/>`);
    for (const h of k.heads) out.push(`<path d="${h}" fill="${style.correlationColor}"/>`);
  }
  for (const m of f.moderations) {
    const q = m.loop;
    if (q) {
      // The loop's apex is ¾ of the rise out; its tag sits just beyond.
      const tx = q.lx + q.nx * (small + 6), ty = q.ly + q.ny * (small + 6);
      extend(q.x1, q.y1); extend(q.x2, q.y2); extend(q.lx, q.ly); extend(tx - textWidth(q.tag, small) / 2, ty - small); extend(tx + textWidth(q.tag, small) / 2, ty + small);
      out.push(`<path d="${q.d}" fill="none" stroke="${style.moderationColor}" stroke-width="${n(style.pathWidth)}" stroke-dasharray="6 4"/>`);
      out.push(`<path d="${arrowHead(q.x2, q.y2, -q.nx * QUAD_RISE, -q.ny * QUAD_RISE, 6 + style.pathWidth * 2, 2.5 + style.pathWidth)}" fill="${style.moderationColor}"/>`);
      out.push(`<text x="${n(tx)}" y="${n(ty + small * 0.35)}" font-size="${n(small)}" font-style="italic" font-weight="bold" text-anchor="middle" fill="${style.moderationColor}">${esc(q.tag)}</text>`);
    } else line(m.x1, m.y1, m.x2, m.y2, style.moderationColor, style.pathWidth, true, '6 4');
    out.push(`<circle cx="${n(m.x2)}" cy="${n(m.y2)}" r="3" fill="${style.moderationColor}"/>`);
  }
  for (const p of f.paths) line(p.x1, p.y1, p.x2, p.y2, style.pathColor, pathStrokeWidth(style, p.label?.value ?? null), true, p.implied ? '5 4' : '');
  for (const h of f.higherOrder) line(h.x1, h.y1, h.x2, h.y2, style.pathColor, style.pathWidth * 0.9, true);

  // Error terms: circles with their (standardised) variance, or e / d.
  for (const e of f.errors) {
    const t = e.term;
    line(t.cx - t.nx * ERR_R, t.cy - t.ny * ERR_R, t.ax, t.ay, style.indicatorArrow, style.indicatorArrowWidth, true);
    extend(t.cx - ERR_R, t.cy - ERR_R); extend(t.cx + ERR_R, t.cy + ERR_R);
    out.push(`<circle cx="${n(t.cx)}" cy="${n(t.cy)}" r="${ERR_R}" fill="${style.indicatorFill}" stroke="${style.indicatorStroke}" stroke-width="${n(style.indicatorArrowWidth)}"/>`);
    const text = e.value !== null && style.showEstimates ? e.value.toFixed(Math.min(style.decimals, 2)).replace(/^0\./, '.').replace(/^-0\./, '-.') : e.kind === 'indicator' ? 'e' : 'd';
    out.push(`<text x="${n(t.cx)}" y="${n(t.cy + small * 0.35)}" font-size="${n(small * 0.85)}" text-anchor="middle" fill="${style.pathColor}"${e.value === null ? ' font-style="italic"' : ''}>${esc(text)}</text>`);
  }

  for (const { c, geom, r2, indicators, observed } of f.constructs) {
    const { rx, ry } = geom;
    const composite = c.type === 'composite';
    // An observed single-item variable is its own column: no separate indicator box.
    if (!(observed && c.indicators.length === 1)) geom.indicators.forEach((ind) => {
      const [x1, y1, x2, y2] = composite ? [ind.ax, ind.ay, ind.ex, ind.ey] : [ind.ex, ind.ey, ind.ax, ind.ay];
      line(c.x + x1, c.y + y1, c.x + x2, c.y + y2, style.indicatorArrow, style.indicatorArrowWidth, true);
      const bx = c.x + ind.x, by = c.y + ind.y;
      extend(bx, by); extend(bx + ind.w, by + ind.h);
      out.push(`<rect x="${n(bx)}" y="${n(by)}" width="${n(ind.w)}" height="${n(ind.h)}" rx="4" fill="${style.indicatorFill}" stroke="${style.indicatorStroke}" stroke-width="${n(style.indicatorArrowWidth)}"/>`);
      out.push(`<text x="${n(bx + ind.w / 2)}" y="${n(by + ind.h / 2 + small * 0.35)}" font-size="${n(small)}" text-anchor="middle" fill="#333333">${esc(ind.name)}</text>`);
    });
    const shape = c.covariate || observed
      ? `<rect x="${n(c.x - rx)}" y="${n(c.y - ry)}" width="${n(2 * rx)}" height="${n(2 * ry)}" rx="4"`
      : composite
        ? `<polygon points="${hexagonVertices(rx, ry).map(([x, y]) => `${n(c.x + x)},${n(c.y + y)}`).join(' ')}"`
        : `<ellipse cx="${n(c.x)}" cy="${n(c.y)}" rx="${n(rx)}" ry="${n(ry)}"`;
    out.push(`${shape} fill="${style.constructFill}" stroke="${style.constructStroke}" stroke-width="${n(style.constructStrokeWidth)}"/>`);
    extend(c.x - rx, c.y - ry); extend(c.x + rx, c.y + ry);
    const showR2 = style.showR2 && r2 !== null;
    out.push(`<text x="${n(c.x)}" y="${n(c.y + (showR2 ? -2 : fs * 0.35))}" font-size="${fs}" font-weight="bold" text-anchor="middle" fill="#1f2430">${esc(c.name)}</text>`);
    if (showR2) out.push(`<text x="${n(c.x)}" y="${n(c.y + fs + 1)}" font-size="${n(small)}" text-anchor="middle" fill="#444444">R² = ${r2!.toFixed(style.decimals)}</text>`);
    if (style.showEstimates) {
      geom.indicators.forEach((ind, i) => {
        const l = indicators[i];
        if (l) label(c.x + (ind.ex + ind.ax) / 2, c.y + (ind.ey + ind.ay) / 2, l, '#333333');
      });
    } else geom.indicators.forEach((ind, i) => { if (indicators[i]?.fixed) label(c.x + (ind.ex + ind.ax) / 2, c.y + (ind.ey + ind.ay) / 2, { value: 1, p: null, fixed: true }, '#333333'); });
  }

  if (style.showEstimates) {
    for (const p of f.paths) if (p.label) {
      const t = p.moderated ? 0.3 : 0.5;
      label(p.x1 + t * (p.x2 - p.x1), p.y1 + t * (p.y2 - p.y1), p.label, tone(p.label.p));
    }
    for (const m of f.moderations) if (m.label) {
      if (m.loop) label(m.loop.lx, m.loop.ly, m.label, tone(m.label.p));
      else label((m.x1 + m.x2) / 2, (m.y1 + m.y2) / 2, m.label, tone(m.label.p));
    }
    for (const h of f.higherOrder) if (h.label) label((h.x1 + h.x2) / 2, (h.y1 + h.y2) / 2, h.label, '#333333');
    for (const k of f.correlations) if (k.label) {
      // Hang the label off the outer side of the arc.
      const text = estimateText(style, k.label.value, k.label.p);
      const w = textWidth(text, small) + 8;
      label(k.lx + k.nx * w / 2, k.ly + k.ny * (small + 6) / 2, k.label, tone(k.label.p));
    }
  }

  const pad = 16;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  const width = Math.ceil(Math.max(...xs) + pad - minX), height = Math.ceil(Math.max(...ys) + pad - minY);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(minX)} ${n(minY)} ${width} ${height}" font-family='${FONT_FAMILY[style.font]}'>\n`
    + `<rect x="${n(minX)}" y="${n(minY)}" width="${width}" height="${height}" fill="#ffffff"/>\n${out.join('\n')}\n</svg>\n`;
  return { svg, width, height };
}
