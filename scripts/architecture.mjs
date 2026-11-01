// ARCHITECTURE.md -> public/architecture.html: the design document as a page
// in the app (same look as the user guide; no scripts, so it works under the
// app's CSP). Run by `npm run docs:architecture` and before every build; the
// test src/architecture.test.ts fails when the page is out of date.
//
// A small Markdown subset is enough for the document: headings, paragraphs,
// fenced code (a ```svg fence is a diagram, emitted as is), pipe tables, bullet and numbered lists, inline code, bold,
// links. Anything else is written as text.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Inline Markdown: code spans first (their contents are literal), then bold and links. */
function inline(text) {
  const parts = text.split(/(`[^`]*`)/);
  return parts.map((p, i) => {
    if (i % 2 === 1) return `<code>${esc(p.slice(1, -1))}</code>`;
    return esc(p)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t, u) => (/^(https?:\/\/|#|[a-z0-9_./-]+\.html)/i.test(u) ? `<a href="${u}">${t}</a>` : `${t} (${u})`));
  }).join('');
}

/** The document's body as HTML and its h2 headings (for the contents). */
export function render(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const headings = [];
  let title = '';
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      flush();
      const info = line.slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      // A diagram written as SVG in the document itself (no scripts; the CSP allows inline SVG).
      if (info === 'svg') out.push(`<figure class="diagram">${code.join('\n')}</figure>`);
      else out.push(`<pre>${esc(code.join('\n'))}</pre>`);
      continue;
    }
    const h = /^(#{1,3}) (.*)$/.exec(line);
    if (h) {
      flush();
      const level = h[1].length, text = h[2].trim();
      if (level === 1) { title = text; out.push(`<h1>${inline(text)}</h1>`); }
      else {
        const id = slug(text);
        if (level === 2) headings.push({ id, text });
        out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      }
      i++;
      continue;
    }
    if (/^\|/.test(line)) {
      flush();
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push('<table>', `<tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr>`,
        ...body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`), '</table>');
      continue;
    }
    const list = /^(\s*)([-*]|\d+\.) (.*)$/.exec(line);
    if (list) {
      flush();
      const ordered = /\d/.test(list[2]);
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*]|\d+\.) (.*)$/.exec(lines[i]);
        if (m && (/\d/.test(m[2]) === ordered)) { items.push(m[3]); i++; }
        else if (/^\s+\S/.test(lines[i]) && items.length) { items[items.length - 1] += ' ' + lines[i].trim(); i++; }
        else break;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (line.trim() === '') { flush(); i++; continue; }
    para.push(line.trim());
    i++;
  }
  flush();
  return { title, body: out.join('\n'), headings };
}

/** The whole page: the user guide's stylesheet, a contents list, the document, a footer. */
export function page(md, style) {
  const { title, body, headings } = render(md);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="How PLS Studio is designed: the stores, the built-in engine, how the front end talks to R (webR and the desktop helper), the Analyses log, collaboration, build and deploy.">
${style}
</head>
<body>
<div class="wrap">
<nav aria-label="Contents">
  <div class="brand">PLS Studio design</div>
  <ol>
${headings.map((h) => `    <li><a href="#${h.id}">${inline(h.text)}</a></li>`).join('\n')}
    <li><a href="guide.html">User guide →</a></li>
  </ol>
</nav>
<main>
${body}

<footer>Generated from ARCHITECTURE.md in the PLS Studio repository (npm run docs:architecture).</footer>
</main>
</div>
</body>
</html>
`;
}

export function build() {
  const md = readFileSync(join(ROOT, 'ARCHITECTURE.md'), 'utf8');
  const guide = readFileSync(join(ROOT, 'public', 'guide.html'), 'utf8');
  const style = /<style>[\s\S]*?<\/style>/.exec(guide)[0].replace('</style>', 'figure.diagram { margin: 12px 0 18px; overflow-x: auto; } figure.diagram svg { display: block; max-width: 100%; height: auto; } </style>');
  return page(md, style);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(ROOT, 'public', 'architecture.html'), build());
  console.log('public/architecture.html written.');
}
