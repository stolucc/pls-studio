// A self-contained SVG of the path diagram, for export (PDF, PNG, SVG). Uses
// the same geometry as the on-screen diagram; numbers are formatted by the
// figure style. Only plain SVG primitives and standard font families, so
// svg2pdf.js can turn it into vector PDF without embedded fonts.

import { arrowHead, besideLine, BOX_RX, clearPointOnCurve, ERR_R, octagonVertices, pathCurve, selfLoop, hexagonVertices, QUAD_RISE, type ConstructGeom, type ErrorTerm, type QuadraticLoop, CONSTANT_R } from '../geometry';
import { COPULA_R } from '../components/copulaGeometry';
import { noLeadingZero } from '../format';
import { placeFigureLabels } from './labels';
import type { Construct, Method } from '../model/project';
import { estimateText, figureForMethod, FONT_FAMILY, formatEstimate, GRADIENT_CONSTRUCT, GRADIENT_INDICATOR, isPlainFigure, pathStrokeWidth, PLS_STYLE_ERROR, semplotEdge, type FigureStyle } from './style';

export interface FigureLabel { value: number; p: number | null; fixed?: boolean }

export interface FigureInput {
  /** The kind of model: some styles draw PLS and CB-SEM differently. */
  method?: Method;
  /** `observed`: drawn as a rectangle (an observed variable) whatever the construct type. */
  constructs: { c: Construct; geom: ConstructGeom; r2: number | null; indicators: (FigureLabel | null)[]; observed?: boolean }[];
  /**
   * `key` identifies the arrow for label placement (placeFigureLabels), shared with the canvas;
   * `implied`: a moderator's main effect implied by its moderation (dashed).
   */
  paths: { key?: string; x1: number; y1: number; x2: number; y2: number; label: FigureLabel | null; moderated: boolean; implied?: boolean; line?: 'dashed' | 'dotted'; curved?: boolean }[];
  /** Comments on the diagram. */
  notes?: { x: number; y: number; text: string }[];
  /** `loop`: a quadratic effect (Henseler 2021), X's own arrow curving onto its path, tagged X². */
  moderations: { key?: string; x1: number; y1: number; x2: number; y2: number; label: FigureLabel | null; loop?: QuadraticLoop & { tag: string } }[];
  /** Gaussian copula terms: one circle per predictor, a dotted arrow onto each of its paths with a term. */
  copulas?: { cx: number; cy: number; targets: { x1: number; y1: number; x2: number; y2: number; label: FigureLabel | null }[] }[];
  higherOrder: { key?: string; x1: number; y1: number; x2: number; y2: number; label: FigureLabel | null }[];
  /** `name`, `r2`: the indicator, and the reliability in the standardised view (Amos: R² above the box, not the variance). */
  errors: { term: ErrorTerm; kind: 'indicator' | 'disturbance'; value: number | null; name?: string; r2?: number | null }[];
  correlations: { d: string; heads: string[]; lx: number; ly: number; nx: number; ny: number; points: [number, number][]; label: FigureLabel | null }[];
  /** The constant (triangle, "1") and its arrows: latent means and intercepts. */
  constant?: { x: number; y: number };
  means?: { key?: string; x1: number; y1: number; x2: number; y2: number; label: FigureLabel | null }[];
  /** The intercepts the constant implies (dashed arrows to the indicator boxes). */
  intercepts?: { key?: string; x1: number; y1: number; x2: number; y2: number; label: FigureLabel | null }[];
}

/** Amos notation: the type size of an indicator's R² above its box. */
export const R2_ABOVE_BOX_SIZE = 8.5;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => Number(v.toFixed(2));

/** Approximate text width (no font metrics available outside the browser). */
const textWidth = (s: string, size: number) => s.length * size * 0.55;

type Seg = { x1: number; y1: number; x2: number; y2: number };

/** What every layer draws with: the style and what follows from it, the output, its extent, and the shared marks. */
interface Pen {
  style: FigureStyle; fs: number; small: number; amos: boolean; plsStyle: boolean; semplot: boolean;
  constructPaint: string; indicatorPaint: string;
  out: string[]; xs: number[]; ys: number[];
  /** Set for the estimates on the arrows (PLS style: bold in a PLS model). */
  labelWeight: string;
  ink: (c: string) => string;
  extend: (x: number, y: number) => void;
  labelText: (l: FigureLabel) => string;
  label: (x: number, y: number, l: FigureLabel, color: string, anchor?: 'middle' | 'start', dx?: number, dy?: number) => void;
  /** A label at (x, y) on this line: on it, or beside it in Amos notation. */
  labelOn: (x: number, y: number, s: Seg, l: FigureLabel, color: string) => void;
  plainText: (x: number, y: number, text: string, size?: number) => void;
  tone: (p: number | null) => string;
  line: (x1: number, y1: number, x2: number, y2: number, color: string, width: number, head: boolean, dash?: string) => void;
}

function makePen(style: FigureStyle): Pen {
  const fs = style.fontSize;
  const small = fs * 0.85;
  const amos = style.notation === 'amos', plsStyle = style.notation === 'pls';
  // A plain figure has one ink: the lines' colour, for text and outlines too.
  const semplot = style.notation === 'semplot';
  const ink = (c: string) => (semplot ? '#000000' : isPlainFigure(style) ? style.pathColor : c);
  const out: string[] = [];
  const xs: number[] = [], ys: number[] = [];
  const extend = (x: number, y: number) => { xs.push(x); ys.push(y); };

  const labelText = (l: FigureLabel) => (l.fixed && Math.abs(l.value - 1) < 1e-12 ? '1' : estimateText(style, l.value, l.p));
  const label = (x: number, y: number, l: FigureLabel, color: string, anchor: 'middle' | 'start' = 'middle', dx = 0, dy = 0) => {
    const text = labelText(l);
    const w = textWidth(text, small) + 8, h = small + 6;
    const left = anchor === 'middle' ? x - w / 2 + dx : x + dx;
    const top = y - h / 2 + dy;
    extend(left, top); extend(left + w, top + h);
    // Always mask the line behind the number; the outline is optional (fixed loadings: dashed).
    const outline = style.labelBoxes || (l.fixed && style.notation === 'standard') ? ` stroke="${ink(l.fixed ? '#7f7f7f' : '#d0d5de')}" stroke-width="0.6"${l.fixed ? ' stroke-dasharray="2 2"' : ''}` : '';
    // Amos writes the number beside the line (labelOn), so there is nothing to mask.
    if (!amos) out.push(`<rect x="${n(left)}" y="${n(top)}" width="${n(w)}" height="${n(h)}" rx="${n(h / 2)}" fill="#ffffff"${outline}/>`);
    out.push(`<text x="${n(left + w / 2)}" y="${n(top + h / 2 + small * 0.35)}" font-size="${n(small)}" text-anchor="middle"${pen.labelWeight} fill="${color}">${esc(text)}</text>`);
  };
  const labelOn = (x: number, y: number, s: Seg, l: FigureLabel, color: string) => {
    const off = amos ? besideLine(s.x1, s.y1, s.x2, s.y2, textWidth(labelText(l), small) / 2, small / 2) : { dx: 0, dy: 0 };
    label(x, y, l, color, 'middle', off.dx, off.dy);
  };
  const plainText = (x: number, y: number, text: string, size = small) => {
    const w = textWidth(text, size);
    extend(x - w / 2, y - size); extend(x + w / 2, y);
    out.push(`<text x="${n(x)}" y="${n(y)}" font-size="${n(size)}" text-anchor="middle" fill="${ink('#444444')}">${esc(text)}</text>`);
  };
  const tone = (p: number | null) => (p === null || p < 0.05 ? style.labelSignificant : style.labelNonSignificant);
  const line = (x1: number, y1: number, x2: number, y2: number, color: string, width: number, head: boolean, dash = '') => {
    extend(x1, y1); extend(x2, y2);
    out.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${color}" stroke-width="${n(width)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    if (head) out.push(`<path d="${arrowHead(x2, y2, x2 - x1, y2 - y1, 6 + width * 2, 2.5 + width)}" fill="${color}"/>`);
  };
  const pen: Pen = {
    style, fs, small, amos, plsStyle, semplot,
    constructPaint: style.gradientFill ? `url(#${GRADIENT_CONSTRUCT})` : style.constructFill,
    indicatorPaint: style.gradientFill ? `url(#${GRADIENT_INDICATOR})` : style.indicatorFill,
    out, xs, ys, labelWeight: '', ink, extend, labelText, label, labelOn, plainText, tone, line,
  };
  return pen;
}

function drawCorrelations({ style, semplot, plsStyle, out, extend }: Pen, f: FigureInput) {
  for (const k of f.correlations) {
    for (const [x, y] of k.points) extend(x, y);
    const corEdge = semplot ? semplotEdge(k.label?.value ?? null) : null;
    out.push(`<path d="${k.d}" fill="none" stroke="${corEdge?.color ?? style.correlationColor}" stroke-width="${n(corEdge?.width ?? (plsStyle ? 1 : style.pathWidth * 0.8))}"${plsStyle ? ' stroke-dasharray="4 3"' : ''}/>`);
    for (const h of k.heads) out.push(`<path d="${h}" fill="${corEdge?.color ?? style.correlationColor}"/>`);
  }
}

function drawModerations({ style, small, out, extend, line }: Pen, f: FigureInput) {
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
}

function drawPaths({ style, semplot, out, extend, line }: Pen, f: FigureInput) {
  for (const p of f.paths) {
    const edge = semplot ? semplotEdge(p.label?.value ?? null) : null;
    const pathInk = edge?.color ?? style.pathColor;
    const width = edge?.width ?? pathStrokeWidth(style, p.label?.value ?? null), dash = p.implied ? '5 4' : p.line === 'dashed' ? '7 4' : p.line === 'dotted' ? '1.5 4' : '';
    if (!p.curved) { line(p.x1, p.y1, p.x2, p.y2, pathInk, width, true, dash); continue; }
    const k = pathCurve(p);
    extend(p.x1, p.y1); extend(p.x2, p.y2); extend(k.mx, k.my);
    out.push(`<path d="M ${n(p.x1)} ${n(p.y1)} Q ${n(k.kx)} ${n(k.ky)} ${n(p.x2)} ${n(p.y2)}" fill="none" stroke="${pathInk}" stroke-width="${n(width)}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`);
    out.push(`<path d="${arrowHead(p.x2, p.y2, p.x2 - k.kx, p.y2 - k.ky, 6 + width * 2, 2.5 + width)}" fill="${pathInk}"/>`);
  }
}

function drawHigherOrder({ style, semplot, line }: Pen, f: FigureInput) {
  for (const h of f.higherOrder) { const e = semplot && h.label ? semplotEdge(h.label.value) : null; line(h.x1, h.y1, h.x2, h.y2, e?.color ?? style.pathColor, e?.width ?? style.pathWidth * 0.9, true); }
}

/** The constant (a triangle, "1") and its arrows: latent means and intercepts. */
function drawConstant({ style, indicatorPaint, ink, out, extend, line }: Pen, f: FigureInput) {
  if (!f.constant) return;
  const { x, y } = f.constant, r = CONSTANT_R;
  extend(x - r, y - r); extend(x + r, y + r);
  out.push(`<path d="M ${n(x)} ${n(y - r)} L ${n(x + r * 0.95)} ${n(y + r * 0.7)} L ${n(x - r * 0.95)} ${n(y + r * 0.7)} Z" fill="${indicatorPaint}" stroke="${style.constructStroke}" stroke-width="${n(style.constructStrokeWidth)}"/>`);
  out.push(`<text x="${n(x)}" y="${n(y + r * 0.35)}" font-size="${n(style.fontSize)}" font-weight="bold" text-anchor="middle" fill="${ink('#333333')}">1</text>`);
  for (const t of f.means ?? []) line(t.x1, t.y1, t.x2, t.y2, style.pathColor, style.pathWidth * 0.9, true);
  for (const t of f.intercepts ?? []) line(t.x1, t.y1, t.x2, t.y2, style.pathColor, style.pathWidth * 0.7, true, '5 4');
}

function drawCopulas({ style, small, ink, out, extend, line }: Pen, f: FigureInput) {
  for (const g of f.copulas ?? []) {
    for (const t of g.targets) {
      extend(t.x2, t.y2);
      line(t.x1, t.y1, t.x2, t.y2, style.copulaArrow, 1, false, '3 3');
      const len = Math.hypot(t.x2 - t.x1, t.y2 - t.y1) || 1, ux = (t.x2 - t.x1) / len, uy = (t.y2 - t.y1) / len;
      out.push(`<path d="M ${n(t.x2 - ux * 7 - uy * 3.5)} ${n(t.y2 - uy * 7 + ux * 3.5)} L ${n(t.x2)} ${n(t.y2)} L ${n(t.x2 - ux * 7 + uy * 3.5)} ${n(t.y2 - uy * 7 - ux * 3.5)}" fill="none" stroke="${style.copulaArrow}" stroke-width="1"/>`);
      out.push(`<circle cx="${n(t.x2)}" cy="${n(t.y2)}" r="2.5" fill="#9a9a9a"/>`);
    }
    extend(g.cx - COPULA_R, g.cy - COPULA_R); extend(g.cx + COPULA_R, g.cy + COPULA_R);
    out.push(`<circle cx="${n(g.cx)}" cy="${n(g.cy)}" r="${COPULA_R}" fill="${style.copulaFill}" stroke="${style.copulaStroke}" stroke-width="1"/>`);
    out.push(`<text x="${n(g.cx)}" y="${n(g.cy + small * 0.35)}" font-size="${n(small)}" font-weight="bold" text-anchor="middle" fill="${ink('#333333')}">GC</text>`);
  }
}

/** Error terms: circles with their (standardised) variance, or e / d; semPlot's self-loops. */
function drawErrors({ style, small, amos, plsStyle, semplot, indicatorPaint, ink, out, extend, line, labelOn, plainText }: Pen, f: FigureInput) {
  const numbered = { indicator: 0, disturbance: 0 };
  for (const e of f.errors) {
    const t = e.term;
    numbered[e.kind]++;
    if (semplot) {
      const l = selfLoop(t), edge = semplotEdge(e.value);
      extend(l.lx, l.ly); extend(l.x1, l.y1); extend(l.x2, l.y2);
      out.push(`<path d="M ${n(l.x1)} ${n(l.y1)} C ${n(l.c1x)} ${n(l.c1y)} ${n(l.c2x)} ${n(l.c2y)} ${n(l.x2)} ${n(l.y2)}" fill="none" stroke="${edge.color}" stroke-width="${n(edge.width)}"/>`);
      out.push(`<path d="${arrowHead(l.x1, l.y1, l.x1 - l.c1x, l.y1 - l.c1y, 5 + edge.width, 2 + edge.width / 2)}" fill="${edge.color}"/>`);
      out.push(`<path d="${arrowHead(l.x2, l.y2, l.x2 - l.c2x, l.y2 - l.c2y, 5 + edge.width, 2 + edge.width / 2)}" fill="${edge.color}"/>`);
      if (e.value !== null && style.showEstimates) out.push(`<text x="${n(l.lx)}" y="${n(l.ly + small * 0.35)}" font-size="${n(small * 0.85)}" text-anchor="middle" fill="${edge.color}">${esc(formatEstimate(style, e.value))}</text>`);
      continue;
    }
    line(t.cx - t.nx * ERR_R, t.cy - t.ny * ERR_R, t.ax, t.ay, plsStyle ? PLS_STYLE_ERROR : style.indicatorArrow, style.indicatorArrowWidth, !plsStyle);
    if (plsStyle) out.push(`<polygon points="${n(t.ax)},${n(t.ay - 4)} ${n(t.ax + 4)},${n(t.ay)} ${n(t.ax)},${n(t.ay + 4)} ${n(t.ax - 4)},${n(t.ay)}" fill="${PLS_STYLE_ERROR}"/>`);
    extend(t.cx - ERR_R, t.cy - ERR_R); extend(t.cx + ERR_R, t.cy + ERR_R);
    out.push(`<circle cx="${n(t.cx)}" cy="${n(t.cy)}" r="${ERR_R}" ${plsStyle ? `fill="${PLS_STYLE_ERROR}"` : `fill="${indicatorPaint}" stroke="${style.indicatorStroke}" stroke-width="${n(style.indicatorArrowWidth)}"`}/>`);
    const inCircle = !amos && e.value !== null && style.showEstimates;
    const text = inCircle ? (plsStyle ? formatEstimate(style, e.value!) : noLeadingZero(e.value!.toFixed(Math.min(style.decimals, 2)))) : `${e.kind === 'indicator' ? 'e' : 'd'}${amos ? numbered[e.kind] : ''}`;
    out.push(`<text x="${n(t.cx)}" y="${n(t.cy + small * 0.35)}" font-size="${n(small * (plsStyle ? 0.7 : 0.85))}" text-anchor="middle" fill="${plsStyle ? '#ffffff' : style.pathColor}"${e.value === null && !amos ? ' font-style="italic"' : ''}>${esc(text)}</text>`);
    if (amos && e.value === null) {
      // Every error term's weight is fixed at 1; the diagram states it until there are estimates.
      const s = { x1: t.cx - t.nx * ERR_R, y1: t.cy - t.ny * ERR_R, x2: t.ax, y2: t.ay };
      labelOn((s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2, s, { value: 1, p: null, fixed: true }, ink('#333333'));
    } else if (amos && style.showEstimates && e.r2 == null) plainText(t.cx, t.cy - ERR_R - 3, formatEstimate(style, e.value!));
  }
}

/** A construct: its indicator boxes and arrows, its shape, name and R², and the estimates on its indicator arrows. */
function drawConstruct(pen: Pen, f: FigureInput, { c, geom, r2, indicators, observed }: FigureInput['constructs'][number]) {
  const { style, fs, small, amos, plsStyle, semplot, constructPaint, indicatorPaint, ink, out, extend, line, labelOn, plainText } = pen;
  const { rx, ry } = geom;
  const composite = c.type === 'composite';
  // (semPlot keeps the name in the circle)
  const circle = style.circleConstructs && !c.covariate && !observed && !semplot;
  // An observed single-item variable is its own column: no separate indicator box.
  if (!(observed && c.indicators.length === 1)) geom.indicators.forEach((ind) => {
    const [x1, y1, x2, y2] = composite ? [ind.ax, ind.ay, ind.ex, ind.ey] : [ind.ex, ind.ey, ind.ax, ind.ay];
    const fixed = indicators[c.indicators.indexOf(ind.name)];
    const iEdge = semplot ? semplotEdge(fixed?.value ?? null) : null;
    line(c.x + x1, c.y + y1, c.x + x2, c.y + y2, iEdge?.color ?? style.indicatorArrow, iEdge?.width ?? style.indicatorArrowWidth, !(plsStyle && c.indicators.length === 1), semplot && fixed?.fixed ? '5 4' : '');
    const bx = c.x + ind.x, by = c.y + ind.y;
    extend(bx, by); extend(bx + ind.w, by + ind.h);
    out.push(`<rect x="${n(bx)}" y="${n(by)}" width="${n(ind.w)}" height="${n(ind.h)}" rx="${BOX_RX}" fill="${c.color ?? indicatorPaint}" stroke="${style.indicatorStroke}" stroke-width="${n(style.indicatorArrowWidth)}"/>`);
    out.push(`<text x="${n(bx + ind.w / 2)}" y="${n(by + ind.h / 2 + small * 0.35)}" font-size="${n(small)}" text-anchor="middle" fill="${ink('#333333')}">${esc(ind.name)}</text>`);
  });
  const shape = c.covariate || observed || c.shape === 'rectangle'
    ? `<rect x="${n(c.x - rx)}" y="${n(c.y - ry)}" width="${n(2 * rx)}" height="${n(2 * ry)}" rx="${BOX_RX}"`
    : c.shape === 'octagon'
      ? `<polygon points="${octagonVertices(rx, ry).map(([x, y]) => `${n(c.x + x)},${n(c.y + y)}`).join(' ')}"`
    : composite
      ? `<polygon points="${hexagonVertices(rx, ry).map(([x, y]) => `${n(c.x + x)},${n(c.y + y)}`).join(' ')}"`
      : `<ellipse cx="${n(c.x)}" cy="${n(c.y)}" rx="${n(rx)}" ry="${n(ry)}"`;
  out.push(`${shape} fill="${c.color ?? constructPaint}" stroke="${style.constructStroke}" stroke-width="${n(style.constructStrokeWidth)}"/>`);
  extend(c.x - rx, c.y - ry); extend(c.x + rx, c.y + ry);
  const showR2 = style.showR2 && r2 !== null;
  const r2Inside = showR2 && !amos;
  // With circles, names are outside the shape: below, or above when the indicators hang below.
  const nameY = circle ? (c.side === 'bottom' ? c.y - ry - 6 : c.y + ry + fs + 2) : c.y + (r2Inside ? -2 : fs * 0.35);
  if (circle) { const w = textWidth(c.name, fs) * 1.1; extend(c.x - w / 2, nameY - fs); extend(c.x + w / 2, nameY + 2); }
  out.push(`<text x="${n(c.x)}" y="${n(nameY)}" font-size="${fs}"${amos ? '' : ' font-weight="bold"'} text-anchor="middle" fill="${ink('#1f2430')}">${esc(c.name)}</text>`);
  if (r2Inside && plsStyle) out.push(`<text x="${n(c.x)}" y="${n(c.y + small * 0.35)}" font-size="${n(small)}" font-weight="bold" text-anchor="middle" fill="#ffffff">${formatEstimate(style, r2!)}</text>`);
  else if (r2Inside) out.push(`<text x="${n(c.x)}" y="${n(circle ? c.y + small * 0.35 : c.y + fs + 1)}" font-size="${n(small)}" text-anchor="middle" fill="${ink('#444444')}">R² = ${r2!.toFixed(style.decimals)}</text>`);
  else if (showR2) {
    // Above the variable, towards its right.
    plainText(c.x + rx * 0.5, c.y - ry - 3, formatEstimate(style, r2!));
  }
  const onLoading = (ind: ConstructGeom['indicators'][number], l: FigureLabel) => labelOn(c.x + (ind.ex + ind.ax) / 2, c.y + (ind.ey + ind.ay) / 2, { x1: ind.ex, y1: ind.ey, x2: ind.ax, y2: ind.ay }, l, semplot ? semplotEdge(l.value).color : ink('#333333'));
  if (style.showEstimates) {
    geom.indicators.forEach((ind) => {
      const l = indicators[c.indicators.indexOf(ind.name)];
      if (l) onLoading(ind, l);
    });
  } else geom.indicators.forEach((ind) => { if (indicators[c.indicators.indexOf(ind.name)]?.fixed) onLoading(ind, { value: 1, p: null, fixed: true }); });
  // Amos: an indicator's reliability above its box.
  if (amos && style.showR2 && style.showEstimates) geom.indicators.forEach((ind) => {
    const r = f.errors.find((e) => e.kind === 'indicator' && e.name === ind.name)?.r2;
    // (small enough for the gap between stacked boxes)
    if (r != null) plainText(c.x + ind.x + ind.w * 0.65, c.y + ind.y - 1.5, formatEstimate(style, r), Math.min(small, R2_ABOVE_BOX_SIZE));
  });
}

/** The estimates on the arrows, where the label placement pass puts them so that none overlap. */
function drawEstimates(pen: Pen, f: FigureInput) {
  const { style, small, plsStyle, semplot, ink, labelText, label, labelOn, tone } = pen;
  if (!style.showEstimates) return;
  // PLS style: structural estimates bold in a PLS model.
  pen.labelWeight = plsStyle && f.method !== 'cbsem' ? ' font-weight="bold"' : '';
  // Labels never overlap: each sits where the placement pass put it (its preferred point on the arrow when free).
  const size = (l: FigureLabel) => ({ w: textWidth(labelText(l), small) + 8, h: small + 6 });
  const placed = placeFigureLabels(f, size);
  const at = (key: string | undefined, s: Seg, t: number) => (key ? placed.get(key) : undefined) ?? { x: s.x1 + t * (s.x2 - s.x1), y: s.y1 + t * (s.y2 - s.y1) };
  for (const p of f.paths) if (p.label) { const q = p.curved ? (({ mx, my }) => ({ x: mx, y: my }))(pathCurve(p)) : at(p.key, p, p.moderated ? 0.3 : 0.5); labelOn(q.x, q.y, p, p.label, semplot ? semplotEdge(p.label.value).color : tone(p.label.p)); }
  for (const m of f.moderations) if (m.label) {
    if (m.loop) label(m.loop.lx, m.loop.ly, m.label, tone(m.label.p));
    else { const q = at(m.key, m, 0.5); labelOn(q.x, q.y, m, m.label, tone(m.label.p)); }
  }
  for (const h of f.higherOrder) if (h.label) { const q = at(h.key, h, 0.5); labelOn(q.x, q.y, h, h.label, semplot ? semplotEdge(h.label.value).color : ink('#333333')); }
  for (const t of f.means ?? []) if (t.label) { const q = at(t.key, t, 0.5); labelOn(q.x, q.y, t, t.label, tone(t.label.p)); }
  for (const t of f.intercepts ?? []) if (t.label) { const q = at(t.key, t, 0.5); labelOn(q.x, q.y, t, t.label, tone(t.label.p)); }
  for (const g of f.copulas ?? []) for (const t of g.targets) if (t.label) labelOn((t.x1 + t.x2) / 2, (t.y1 + t.y2) / 2, t, t.label, tone(t.label.p));
  for (const k of f.correlations) if (k.label) {
    // Hang the label off the outer side of the arc.
    const text = estimateText(style, k.label.value, k.label.p);
    const w = textWidth(text, small) + 8, h = small + 6;
    // In these styles a label over a box garbles it or hides its name: slide it along the arc.
    const q = style.notation !== 'standard' ? clearPointOnCurve(k.points[0], k.points[1], [k.lx, k.ly], [k.nx, k.ny], w, h, f.constructs.flatMap(({ c, geom }) => geom.indicators.map((b) => ({ x: c.x + b.x, y: c.y + b.y, w: b.w, h: b.h })))) : { x: k.lx, y: k.ly };
    label(q.x + k.nx * w / 2, q.y + k.ny * h / 2, k.label, semplot ? semplotEdge(k.label.value).color : tone(k.label.p));
  }
}

function drawNotes({ small, out, extend }: Pen, f: FigureInput) {
  for (const k of f.notes ?? []) {
    const lines = k.text.split('\n').slice(0, 40), lh = small * 1.3;
    const w = Math.max(60, ...lines.map((l) => textWidth(l, small))) + 12, h = lines.length * lh + 10;
    extend(k.x, k.y); extend(k.x + w, k.y + h);
    out.push(`<rect x="${n(k.x)}" y="${n(k.y)}" width="${n(w)}" height="${n(h)}" fill="#fffbe6" stroke="#d9c98a" stroke-width="0.8"/>`);
    lines.forEach((l, i) => out.push(`<text x="${n(k.x + 6)}" y="${n(k.y + 5 + small + i * lh)}" font-size="${n(small)}" fill="#333333">${esc(l)}</text>`));
  }
}

/** The drawing as an SVG document framed around everything drawn. */
function frame({ style, out, xs, ys }: Pen): { svg: string; width: number; height: number } {
  const gradientDef = (id: string, from: string) => `<linearGradient id="${id}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${style.gradientEnd}"/></linearGradient>`;
  const pad = 16;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  const width = Math.ceil(Math.max(...xs) + pad - minX), height = Math.ceil(Math.max(...ys) + pad - minY);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(minX)} ${n(minY)} ${width} ${height}" font-family='${FONT_FAMILY[style.font]}'>\n`
    + (style.gradientFill ? `<defs>${gradientDef(GRADIENT_CONSTRUCT, style.constructFill)}${gradientDef(GRADIENT_INDICATOR, style.indicatorFill)}</defs>\n` : '')
    + `<rect x="${n(minX)}" y="${n(minY)}" width="${width}" height="${height}" fill="#ffffff"/>\n${out.join('\n')}\n</svg>\n`;
  return { svg, width, height };
}

/** The figure as a self-contained SVG, drawn in layers: lines first, then the shapes over their ends, then the estimates. */
export function renderFigureSvg(f: FigureInput, baseStyle: FigureStyle): { svg: string; width: number; height: number } {
  const pen = makePen(figureForMethod(baseStyle, f.method));
  // Correlations and moderators first, so constructs draw over their ends.
  drawCorrelations(pen, f);
  drawModerations(pen, f);
  drawPaths(pen, f);
  drawHigherOrder(pen, f);
  drawConstant(pen, f);
  drawCopulas(pen, f);
  drawErrors(pen, f);
  for (const k of f.constructs) drawConstruct(pen, f, k);
  drawEstimates(pen, f);
  drawNotes(pen, f);
  return frame(pen);
}
