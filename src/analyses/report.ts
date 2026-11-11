// The analysis log as a report: one self-contained HTML file (no scripts, no
// external resources) with the cards in their order, headings and notes as
// written, and each result as shown on the Analyses tab, in APA-like style.
// Charts become images (standalone SVG); controls are left out.

import { standaloneSvg } from '../figure/standalone';
import { useStore } from '../store';
import { analysisType } from './registry';
import { cardStatus, currentCtx, unpackCard, useAnalyses } from './store';
import type { Card } from './types';

const svgImage = (svg: string) =>
  `data:image/svg+xml;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(svg)))}`;

/** Copy of a card's rendered result for the report: controls removed, charts as images, no attributes but a few safe ones. */
export function cleanResult(el: Element, doc: Document = document): Element {
  const out = el.cloneNode(true) as Element;
  // Charts: the drawn SVG as a standalone image (computed styles written onto it).
  const live = [...el.querySelectorAll('svg')];
  const copies = [...out.querySelectorAll('svg')];
  copies.forEach((svg, i) => {
    const src = live[i] as SVGSVGElement;
    const w = Number(src.getAttribute('width')) || src.getBoundingClientRect().width || 400;
    const h = Number(src.getAttribute('height')) || src.getBoundingClientRect().height || 300;
    const img = doc.createElement('img');
    img.setAttribute('src', svgImage(standaloneSvg(src, w, h)));
    img.setAttribute('width', String(w));
    img.setAttribute('alt', src.getAttribute('aria-label') ?? 'Chart');
    svg.replaceWith(img);
  });
  out
    .querySelectorAll(
      'button, input, select, textarea, script, style, [role="tablist"], .chart-tools, .chart-style',
    )
    .forEach((n) => n.remove());
  // Blocks left with only a title and a note (their content was a control, e.g. "Save scores").
  out.querySelectorAll('div').forEach((n) => {
    if (n.querySelector('table, img, .stat-cards')) return;
    const tools = n.querySelector(':scope > .table-tools');
    if (tools && [...n.children].every((c) => c === tools || c.classList.contains('table-note')))
      n.remove();
  });
  // Only presentational attributes stay (and images' data: sources).
  const KEEP = new Set(['class', 'colspan', 'rowspan', 'alt', 'width', 'style']);
  for (const n of [out, ...out.querySelectorAll('*')]) {
    for (const a of [...n.attributes]) {
      const keep =
        KEEP.has(a.name) ||
        (a.name === 'src' &&
          n.tagName === 'IMG' &&
          /^data:image\/(svg\+xml|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(a.value));
      if (!keep || (a.name === 'style' && /url\(|expression|@import/i.test(a.value)))
        n.removeAttribute(a.name);
    }
  }
  return out;
}

const CSS = `
body { font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.45; color: #111; max-width: 52rem; margin: 2.5rem auto; padding: 0 1.5rem; }
h1 { font-size: 16pt; margin: 0 0 .25rem; } .byline { color: #555; margin: 0 0 2rem; }
h2 { font-size: 14pt; margin: 2.2rem 0 .6rem; border-bottom: 1px solid #999; padding-bottom: .2rem; }
h3 { font-size: 12pt; margin: 1.6rem 0 .2rem; } .meta { color: #555; font-size: 10pt; margin: 0 0 .6rem; }
.status { font-size: 10pt; background: #fff4e0; border-left: 3px solid #c77700; padding: .3rem .6rem; margin: .4rem 0; }
.note-card { white-space: pre-wrap; }
table.grid { border-collapse: collapse; margin: .4rem 0 .2rem; font-size: 10.5pt; border-top: 1.5px solid #111; border-bottom: 1.5px solid #111; }
table.grid th { font-weight: normal; border-bottom: 1px solid #111; padding: .25rem .6rem; text-align: right; }
table.grid td { padding: .15rem .6rem; text-align: right; } table.grid th:first-child, table.grid td:first-child { text-align: left; }
td.num { font-variant-numeric: tabular-nums; } td.dim { color: #888; } td.bad { color: #b00020; } td.good { color: #0a7a43; }
.table-tools h3 { font-size: 11pt; font-style: italic; font-weight: normal; margin: 1.2rem 0 .2rem; }
.table-note { font-size: 10pt; margin: .2rem 0 1rem; } .table-note::before { content: "Note. "; font-style: italic; }
.hint { font-size: 10pt; color: #444; } .muted { color: #666; } img { max-width: 100%; height: auto; }
.tables, .mc-grid { display: block; } figure { margin: .8rem 0; }
.stat-cards { display: flex; gap: 1.2rem; flex-wrap: wrap; font-size: 10pt; } .stat-card .k { color: #555; }
footer { margin-top: 3rem; font-size: 9pt; color: #777; border-top: 1px solid #ccc; padding-top: .5rem; }
`;

/** The report as an HTML document (the cards must be rendered on the Analyses tab). */
export function buildReport(cards: Card[], title: string, doc: Document = document): string {
  const html = doc.implementation.createHTMLDocument(title);
  const d = html;
  const meta = (attrs: Record<string, string>) => {
    const m = d.createElement('meta');
    for (const [k, v] of Object.entries(attrs)) m.setAttribute(k, v);
    d.head.appendChild(m);
  };
  meta({ charset: 'utf-8' });
  meta({
    'http-equiv': 'Content-Security-Policy',
    content: "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  });
  meta({ name: 'viewport', content: 'width=device-width, initial-scale=1' });
  const style = d.createElement('style');
  style.textContent = CSS;
  d.head.appendChild(style);
  const add = (tag: string, text: string, cls?: string) => {
    const e = d.createElement(tag);
    e.textContent = text;
    if (cls) e.className = cls;
    d.body.appendChild(e);
    return e;
  };
  add('h1', title);
  add('p', `Analysis report · ${new Date().toLocaleString()}`, 'byline');
  const ctx = currentCtx();
  const results = useAnalyses.getState().results;
  for (const card of cards) {
    if (card.kind !== 'analysis') {
      if (card.kind === 'heading') add('h2', card.text || 'Heading');
      else if (card.text) add('p', card.text, 'note-card');
      continue;
    }
    const t = analysisType(card.type);
    add('h3', card.title || (t ? (t.cardTitle?.(card.options as never) ?? t.title) : card.type));
    if (t)
      add(
        'p',
        `${t.frozen ? 'Snapshot' : t.summary(card.options as never)}${card.run ? ` · ${new Date(card.run.at).toLocaleString()}` : ''}`,
        'meta',
      );
    if (!card.run) {
      add('p', 'Not run.', 'status');
      continue;
    }
    const st = cardStatus(card, ctx, false, card.id in results);
    if (st.state === 'stale' || st.state === 'missing')
      add('p', `Out of date: ${st.why}`, 'status');
    const shown = doc.getElementById(card.id)?.querySelector('.card-result');
    if (shown) d.body.appendChild(d.importNode(cleanResult(shown, doc), true));
  }
  add(
    'footer',
    'Produced with PLS Studio. Results computed by the R packages named in each table’s note.',
  );
  return '<!doctype html>\n' + html.documentElement.outerHTML;
}

/** Unpack every stored result, let the cards render, then save the report. */
export async function exportReport() {
  const s = useStore.getState();
  const cards = useAnalyses.getState().cards;
  if (!cards.length) {
    s.toast('info', 'The analysis log is empty: add cards first.');
    return;
  }
  await Promise.all(
    cards.map((c) => (c.kind === 'analysis' && c.run?.packed ? unpackCard(c.id) : null)),
  );
  // (two frames: React renders the unpacked results)
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const { downloadText, safeFileName } = await import('../format');
  downloadText(
    `${safeFileName(s.projectName)}-report.html`,
    buildReport(cards, s.projectName),
    'text/html',
  );
  s.toast(
    'success',
    'Report saved (HTML). Open it in a browser; print it to PDF from there, or paste the tables into Word.',
  );
}
