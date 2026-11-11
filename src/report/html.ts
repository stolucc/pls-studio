// The report as one self-contained HTML file: inline CSS, figures as inline
// SVG (sanitised), no scripts and no external resources (a CSP meta tag
// enforces it). Tables have captions and header cells; figures have alt text.

import {
  numericColumns,
  type Block,
  type FigureBlock,
  type ReportDoc,
  type TableBlock,
} from './blocks';
import { sanitizeSvg } from './svg';

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Text for HTML content and attributes. */
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ESC[ch]);

/** Escaped text with its line breaks kept. */
const lines = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');

const CSS = `
:root { color-scheme: light; }
body { font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.45;
  color: #111; background: #fff; max-width: 52rem; margin: 2.5rem auto; padding: 0 1rem; }
h1 { font-size: 18pt; margin: 0 0 .25rem; }
.byline { color: #555; margin: 0 0 2rem; }
h2 { font-size: 15pt; margin: 2.4rem 0 .6rem; border-bottom: 1px solid #999; padding-bottom: .2rem; }
h3 { font-size: 13pt; margin: 1.8rem 0 .3rem; }
h4 { font-size: 12pt; margin: 1.3rem 0 .3rem; }
h5 { font-size: 11pt; font-style: italic; font-weight: normal; margin: 1rem 0 .2rem; }
p { margin: .3rem 0 .6rem; }
.meta { color: #555; font-size: 10pt; margin-top: 0; }
.status { font-size: 10pt; background: #fff4e0; border-left: 3px solid #c77700; padding: .3rem .6rem; }
.hint { font-size: 10pt; color: #444; }
.reference { padding-left: 2em; text-indent: -2em; }
.table-wrap { overflow-x: auto; margin: .6rem 0 1rem; }
table { border-collapse: collapse; font-size: 10.5pt;
  border-top: 1.5px solid #111; border-bottom: 1.5px solid #111; }
caption { text-align: left; font-style: italic; padding-bottom: .3rem; }
thead th { font-weight: normal; border-bottom: 1px solid #111; padding: .25rem .6rem;
  vertical-align: bottom; }
td, tbody th { padding: .15rem .6rem; font-weight: normal; }
.text { text-align: left; }
.num { text-align: right; }
td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
.bold { font-weight: bold; }
.note { font-size: 10pt; margin: .2rem 0 1rem; }
figure { margin: 1rem 0; }
figure svg { max-width: 100%; height: auto; }
figcaption { font-size: 10pt; color: #333; }
footer { margin-top: 3rem; font-size: 9pt; color: #666; border-top: 1px solid #ccc; padding-top: .5rem; }
@media print { h2, h3 { break-after: avoid; } table, figure { break-inside: avoid; } }
`;

function tableHtml(t: TableBlock): string {
  const numeric = numericColumns(t);
  const align = (j: number) => (numeric[j] ? 'num' : 'text');
  // The first column holds row names when it is text throughout: row headers.
  const rowHeads = t.rows.length > 0 && t.rows.every((r) => r[0] && !r[0].numeric);
  const head = t.columns
    .map((c, j) => `<th scope="col" class="${align(j)}">${escapeHtml(c)}</th>`)
    .join('');
  const body = t.rows
    .map((row) => {
      const cells = row.map((cell, j) => {
        const classes = [align(j), cell.bold ? 'bold' : ''].filter(Boolean).join(' ');
        const cls = ` class="${classes}"`;
        if (j === 0 && rowHeads) return `<th scope="row"${cls}>${escapeHtml(cell.text)}</th>`;
        return `<td${cls}>${escapeHtml(cell.text)}</td>`;
      });
      return `<tr>${cells.join('')}</tr>`;
    })
    .join('\n');
  const caption = t.title ? `<caption>${escapeHtml(t.title)}</caption>` : '';
  const thead = t.columns.length ? `<thead><tr>${head}</tr></thead>` : '';
  const note = t.note ? `\n<p class="note"><i>Note.</i> ${escapeHtml(t.note)}</p>` : '';
  return `<div class="table-wrap"><table>${caption}${thead}<tbody>\n${body}\n</tbody></table></div>${note}`;
}

function figureHtml(f: FigureBlock, index: number): string {
  const svg = sanitizeSvg(f.svg, `f${index}-`, f.alt);
  const caption = f.caption ? `<figcaption>${escapeHtml(f.caption)}</figcaption>` : '';
  if (!svg) return `<p class="hint">[Figure: ${escapeHtml(f.alt)}]</p>`;
  return `<figure>${svg}${caption}</figure>`;
}

function blockHtml(b: Block, index: number): string {
  switch (b.kind) {
    case 'heading':
      return `<h${b.level}>${escapeHtml(b.text)}</h${b.level}>`;
    case 'paragraph': {
      const style = b.style && b.style !== 'body' ? ` class="${b.style}"` : '';
      return `<p${style}>${lines(b.text)}</p>`;
    }
    case 'list':
      return `<ul>${b.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
    case 'table':
      return tableHtml(b);
    case 'figure':
      return figureHtml(b, index);
  }
}

/** The report as an HTML document. */
export function reportHtml(doc: ReportDoc): string {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:";
  const body = doc.blocks.map((b, i) => blockHtml(b, i)).join('\n');
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(doc.title)}</title>`,
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    '<main>',
    `<h1>${escapeHtml(doc.title)}</h1>`,
    `<p class="byline">${escapeHtml(doc.date)}</p>`,
    body,
    '</main>',
    '<footer>Produced with PLS Studio.</footer>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
