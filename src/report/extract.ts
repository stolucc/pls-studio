// A rendered result (a card's View, a model result tab) as report blocks, in
// the order shown: tables from the Table component's own data (tableRegistry),
// charts as standalone SVG, key-figure tiles as a small table, headings, lists
// and text. Controls (buttons, inputs, tab bars, chart tools) are left out.

import { standaloneSvg } from '../figure/standalone';
import type { Block, FigureBlock, ReportCell, TableBlock } from './blocks';
import { svgFromDataUrl } from './svg';
import { registeredTable } from './tableRegistry';

const SKIP = [
  'button',
  'input',
  'select',
  'textarea',
  'script',
  'style',
  'noscript',
  '[role="tablist"]',
  '[role="dialog"]',
  '.chart-tools',
  '.chart-style',
  '.table-tools',
  '.report-skip',
].join(', ');

// Elements that start a block of their own (anything else is inline text).
const BLOCK_TAGS = new Set([
  'div',
  'p',
  'section',
  'article',
  'figure',
  'figcaption',
  'table',
  'ul',
  'ol',
  'li',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'img',
  'svg',
  'details',
  'summary',
  'dl',
  'pre',
  'blockquote',
  'fieldset',
  'header',
  'footer',
  'nav',
  'main',
  'aside',
]);

const squash = (s: string) => s.replace(/[\s\u00a0]+/g, ' ').trim();

/** The visible text of an element, without its controls. */
function textOf(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(SKIP).forEach((n) => n.remove());
  return squash(copy.textContent ?? '');
}

const isBlock = (n: Node): n is Element =>
  n.nodeType === 1 && BLOCK_TAGS.has((n as Element).localName);

const hasBlockInside = (el: Element) => [...el.querySelectorAll('*')].some((n) => isBlock(n));

/** Whether an element holds a table, chart, image or key figures (icons in controls do not count). */
const hasContent = (el: Element) =>
  [...el.querySelectorAll('table, svg, img, .stat-cards')].some((n) => !n.closest(SKIP));

/** A table drawn without the Table component: header cells and body cells as text. */
function domTable(el: HTMLTableElement): TableBlock {
  const caption = el.querySelector('caption');
  const headRow = el.tHead?.rows[0] ?? null;
  const columns = headRow ? [...headRow.cells].map((c) => textOf(c)) : [];
  const bodyRows = [...el.querySelectorAll('tbody > tr, :scope > tr')];
  const rows: ReportCell[][] = bodyRows.map((tr) =>
    [...(tr as HTMLTableRowElement).cells].map((c) => ({
      text: textOf(c) || '—',
      numeric: c.classList.contains('num'),
    })),
  );
  return {
    kind: 'table',
    title: caption ? textOf(caption) : '',
    columns,
    rows,
  };
}

/** Key-figure tiles ("Observations 250") as a two-column table. */
function statCards(el: Element): TableBlock {
  const rows = [...el.querySelectorAll('.stat-card')].map((card) => {
    const k = card.querySelector('.k');
    const v = card.querySelector('.v');
    const value = v ? textOf(v) : '';
    return [
      { text: k ? textOf(k) : '', numeric: false },
      { text: value, numeric: /^[-−]?[\d.,]+%?$/.test(value) },
    ];
  });
  return { kind: 'table', title: 'Summary', columns: ['Statistic', 'Value'], rows };
}

/** The size an SVG is drawn at (attributes, then layout, then a default). */
function svgSize(svg: SVGSVGElement): { width: number; height: number } {
  const box = svg.getBoundingClientRect();
  const width = Number(svg.getAttribute('width')) || box.width || 480;
  const height = Number(svg.getAttribute('height')) || box.height || 320;
  return { width, height };
}

/** A chart: its SVG with computed styles written on, its caption and alt text. */
function chart(svg: SVGSVGElement): FigureBlock {
  const { width, height } = svgSize(svg);
  const frame = svg.closest('figure');
  let caption = '';
  if (frame) {
    const copy = frame.cloneNode(true) as Element;
    copy.querySelectorAll('svg').forEach((n) => n.remove());
    caption = textOf(copy);
  }
  const named = svg.getAttribute('aria-label') ?? svg.querySelector(':scope > title')?.textContent;
  const alt = squash(named ?? '') || caption || 'Chart';
  return {
    kind: 'figure',
    svg: standaloneSvg(svg, width, height),
    width,
    height,
    alt,
    ...(caption ? { caption } : {}),
  };
}

/** An <img> holding an SVG diagram (data URL); other images are left out. */
function image(img: HTMLImageElement): FigureBlock | null {
  const svg = svgFromDataUrl(img.getAttribute('src') ?? '');
  if (!svg) return null;
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const width = Number(doc.getAttribute('width')) || 600;
  const height = Number(doc.getAttribute('height')) || 400;
  return { kind: 'figure', svg, width, height, alt: img.getAttribute('alt') || 'Figure' };
}

/** Blocks of a rendered result, in order. `headingLevel`: the level of headings found inside. */
export function extractBlocks(root: Element, headingLevel: 4 | 5 = 5): Block[] {
  const out: Block[] = [];
  // Table notes are part of their registered table.
  const consumed = new Set<Element>();
  let inline = '';
  const flush = (style?: 'hint' | 'status') => {
    const text = squash(inline);
    inline = '';
    if (text) out.push({ kind: 'paragraph', text, ...(style ? { style } : {}) });
  };
  const paragraphStyle = (el: Element): 'hint' | 'status' | undefined => {
    if (el.matches('.card-bar.bad, [role="alert"], .status')) return 'status';
    if (el.matches('.hint, .muted')) return 'hint';
    return undefined;
  };

  const walk = (el: Element) => {
    if (el.matches(SKIP) || consumed.has(el) || el.getAttribute('hidden') !== null) return;
    const tag = el.localName;
    // A titled block whose content is only controls (e.g. "Download scores") and a note.
    const titled = el.querySelector(':scope > .table-tools');
    if (titled && !hasContent(el)) return;
    if (tag === 'table') {
      const reg = registeredTable(el);
      if (reg) {
        el.parentElement?.querySelectorAll(':scope > .table-note').forEach((n) => consumed.add(n));
        out.push(reg);
      } else {
        out.push(domTable(el as HTMLTableElement));
      }
      return;
    }
    if (tag === 'svg') {
      out.push(chart(el as SVGSVGElement));
      return;
    }
    if (tag === 'img') {
      const fig = image(el as HTMLImageElement);
      if (fig) out.push(fig);
      return;
    }
    if (el.classList.contains('stat-cards')) {
      out.push(statCards(el));
      return;
    }
    if (/^h[1-6]$/.test(tag)) {
      const text = textOf(el);
      if (text) out.push({ kind: 'heading', level: headingLevel, text });
      return;
    }
    if (tag === 'figure' && el.querySelector('svg')) {
      // The chart carries the figure's caption.
      const svg = el.querySelector('svg')!;
      walk(svg);
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      const items = [...el.children]
        .filter((li) => li.localName === 'li')
        .map((li) => textOf(li))
        .filter(Boolean);
      if (items.length) out.push({ kind: 'list', items });
      return;
    }
    if (!hasBlockInside(el)) {
      const text = textOf(el);
      if (text) out.push({ kind: 'paragraph', text, ...withStyle(paragraphStyle(el)) });
      return;
    }
    for (const node of [...el.childNodes]) {
      if (node.nodeType === 3) {
        inline += node.textContent ?? '';
      } else if (isBlock(node)) {
        flush();
        walk(node);
      } else if (node.nodeType === 1) {
        const child = node as Element;
        if (child.matches(SKIP)) continue;
        // Inline element with blocks inside (e.g. a <span> holding a table).
        if (hasBlockInside(child)) {
          flush();
          walk(child);
        } else {
          inline += ` ${textOf(child)} `;
        }
      }
    }
    flush(paragraphStyle(el));
  };

  for (const child of [...root.childNodes]) {
    if (child.nodeType === 1) walk(child as Element);
    else if (child.nodeType === 3) inline += child.textContent ?? '';
  }
  flush();
  return out;
}

const withStyle = (style: 'hint' | 'status' | undefined) => (style ? { style } : {});
