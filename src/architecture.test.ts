// The design document is served as a page (public/architecture.html),
// generated from ARCHITECTURE.md by scripts/architecture.mjs: the page must be
// current, plain (no scripts, for the app's CSP), with every section in its
// contents and every Markdown construct the document uses rendered.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { build, render } from '../scripts/architecture.mjs';

const md = readFileSync(join(process.cwd(), 'ARCHITECTURE.md'), 'utf8');
const html = readFileSync(join(process.cwd(), 'public', 'architecture.html'), 'utf8');

describe('architecture page', () => {
  it('is generated from ARCHITECTURE.md and up to date (npm run docs:architecture)', () => {
    expect(html).toBe(build());
  });

  it('is a plain document with a contents list of every section', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\bsrc=|@import|url\(/i);
    const sections = [...md.matchAll(/^## (.*)$/gm)].map((m) => m[1]);
    expect(sections.length).toBeGreaterThan(5);
    for (const s of sections) expect(html).toContain(`>${s.replace(/&/g, '&amp;')}</a>`);
    for (const a of [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])) expect(html, `missing #${a}`).toContain(`id="${a}"`);
  });

  it('renders headings, paragraphs, code, tables, lists, inline code, bold and links', () => {
    const { title, body, headings } = render([
      '# Title', '', '## One & two', 'A paragraph with `code`, **bold** and a [link](https://x.example/p).', 'Same paragraph.', '',
      '```', 'raw <code>', '```', '', '| H1 | H2 |', '|---|---|', '| `a` | b |', '', '- first', '- second', '  continued', '', '1. one', '2. two', '',
    ].join('\n'));
    expect(title).toBe('Title');
    expect(headings).toEqual([{ id: 'one-two', text: 'One & two' }]);
    expect(body).toContain('<h2 id="one-two">One &amp; two</h2>');
    expect(body).toContain('<p>A paragraph with <code>code</code>, <strong>bold</strong> and a <a href="https://x.example/p">link</a>. Same paragraph.</p>');
    expect(body).toContain('<pre>raw &lt;code&gt;</pre>');
    expect(body).toContain('<table>\n<tr><th>H1</th><th>H2</th></tr>\n<tr><td><code>a</code></td><td>b</td></tr>\n</table>');
    expect(body).toContain('<ul><li>first</li><li>second continued</li></ul>');
    expect(body).toContain('<ol><li>one</li><li>two</li></ol>');
  });
});
