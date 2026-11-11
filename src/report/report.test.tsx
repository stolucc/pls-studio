// @vitest-environment happy-dom
// The session report: built from a representative project (a PLS-SEM model
// with its results, a heading, a note, a chart card and a CB-SEM snapshot),
// written as self-contained HTML and as a Word document whose tables are real
// Word tables (the .docx is unzipped and its document.xml checked).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chartAnalysis, chartResult, type ChartOptions } from '../analyses/charts';
import {
  addFrozenCard,
  addText,
  currentCtx,
  loadCards,
  setTitle,
  useAnalyses,
} from '../analyses/store';
import type { Card } from '../analyses/types';
import { Table } from '../components/results/Table';
import type { Dataset } from '../engine/types';
import { useR } from '../rengine/status';
import { cbResult, plsBoot, plsInput, plsResult } from '../reporting/fixtures';
import { resultsKey, useStore } from '../store';
import { cellOf, numericColumns, type Block, type ReportDoc, type TableBlock } from './blocks';
import {
  buildReport,
  dataTable,
  diagramAlt,
  dropEmptySections,
  engineTags,
  softwareTable,
} from './build';
import { reportDocx, xmlText } from './docx';
import { extractBlocks } from './extract';
import { reportHtml } from './html';
import { DEFAULT_REPORT_OPTIONS } from './options';
import { sanitizeSvg } from './svg';

const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
const WHEN = new Date(2026, 10, 11, 14, 30);

const data: Dataset = {
  names: ['x', 'y', 'grp'],
  cols: [
    Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
    Float64Array.from([2, 4, 5, 8, 9, 13, 14, 15]),
    Float64Array.from([1, 2, 1, 2, 1, 2, 1, NaN]),
  ],
  categories: { grp: ['men', 'women'] },
};

/** The model of the methods fixtures, calculated, with a log of cards. */
async function representativeProject() {
  const base = plsInput();
  useStore.getState().newProject();
  useStore.setState({
    cloud: null,
    projectName: 'Loyalty <study>',
    model: base.model,
    settings: base.settings,
    data,
  });
  const s = useStore.getState();
  useStore.setState({
    results: {
      pls: plsResult(),
      cb: null,
      miiv: null,
      boot: plsBoot(),
      fitTest: null,
      key: resultsKey(s),
    },
  });
  useR.setState({ versions: { R: '4.5.1', webR: '0.5.4' } });
  loadCards([]);
  useAnalyses.setState({ results: {}, errors: {} });
  addText('heading', 'Descriptive <checks>');
  addText('note', 'Two outliers were\nkept.');
  const ctx = currentCtx();
  const opts: ChartOptions = { ...chartAnalysis.defaults(ctx), kind: 'histogram', x: 'y' };
  const fingerprint = chartAnalysis.fingerprint(opts, ctx)!;
  const chart: Card = {
    id: 'chart1',
    kind: 'analysis',
    type: 'chart',
    options: opts,
    run: { at: WHEN.getTime(), fingerprint, options: JSON.stringify(opts) },
  };
  useAnalyses.setState((st) => ({
    cards: [...st.cards, chart],
    results: { ...st.results, chart1: chartResult(opts, data) },
  }));
  const snap = await addFrozenCard(
    'snapshot',
    { label: 'CB-SEM model, snapshot 1' },
    { method: 'cbsem', description: 'lavaan', diagram: null, level: 0.95, cb: cbResult() },
  );
  setTitle(snap!, 'Covariance-based check');
}

/** The report's outline: headings, tables (title and columns), figures, others by kind. */
const outline = (blocks: Block[]) =>
  blocks.map((b) => {
    if (b.kind === 'heading') return `h${b.level} ${b.text}`;
    if (b.kind === 'table')
      return `table "${b.title}" [${b.columns.join(' | ')}] ×${b.rows.length}`;
    if (b.kind === 'figure') return `figure (${b.alt.slice(0, 40)})`;
    if (b.kind === 'list') return `list ×${b.items.length}`;
    return `p:${b.style ?? 'body'}`;
  });

/** A 1×1 PNG (rasterising needs a real browser canvas). */
const PNG = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  ),
  (c) => c.charCodeAt(0),
);

/** Attribute values that would load something from outside the file. */
const externalLoads = (html: string) => [
  ...html.matchAll(
    /\s(?:src|href|xlink:href|srcset|poster|action|data)\s*=\s*["']?\s*(?:https?:|\/\/)/gi,
  ),
  ...html.matchAll(/url\(\s*["']?\s*(?:https?:|\/\/)/gi),
  ...html.matchAll(/<(?:link|script|iframe|object|embed|base)\b/gi),
  ...html.matchAll(/@import/gi),
];

let doc: ReportDoc;

beforeAll(async () => {
  // The builder renders with flushSync, outside act().
  g.IS_REACT_ACT_ENVIRONMENT = false;
  await representativeProject();
  doc = await buildReport(DEFAULT_REPORT_OPTIONS, undefined, WHEN);
});
afterAll(() => {
  g.IS_REACT_ACT_ENVIRONMENT = true;
});

describe('report builder', () => {
  it('has the title, the date and the sections in order', () => {
    expect(doc.title).toBe('Loyalty <study>');
    expect(doc.date).toBe('Report created 11 November 2026, 14:30');
    const heads = doc.blocks.filter((b) => b.kind === 'heading' && b.level <= 3);
    expect(heads.map((b) => (b as { text: string }).text)).toEqual([
      'Model',
      'Estimates',
      'Descriptive <checks>',
      'Histogram: y',
      'Covariance-based check',
      'Methods',
      'References',
      'Software',
    ]);
  });

  it('matches the snapshot of its structure', () => {
    expect(outline(doc.blocks)).toMatchSnapshot();
  });

  it('includes the model results as tables (every results tab), not pictures', () => {
    const tabs = doc.blocks.filter((b) => b.kind === 'heading' && b.level === 4);
    expect(tabs.length).toBeGreaterThan(5);
    const tables = doc.blocks.filter((b) => b.kind === 'table');
    expect(tables.length).toBeGreaterThan(5);
    const paths = tables.find((b) => b.kind === 'table' && /path coefficients/i.test(b.title));
    expect(paths).toBeTruthy();
  });

  it('includes the chart as an SVG figure with alt text, and the note as written', () => {
    const fig = doc.blocks.find((b) => b.kind === 'figure');
    expect(fig && fig.kind === 'figure' && fig.svg.startsWith('<svg')).toBe(true);
    expect(fig && fig.kind === 'figure' && fig.alt.length).toBeGreaterThan(0);
    expect(doc.blocks).toContainEqual({
      kind: 'paragraph',
      text: 'Two outliers were\nkept.',
      style: 'note',
    });
  });

  it('has the methods text, a formatted reference list and the software versions', () => {
    const methods = doc.blocks.find(
      (b) => b.kind === 'paragraph' && b.text.includes('Rademaker & Schuberth, 2020'),
    );
    expect(methods).toBeTruthy();
    const refs = doc.blocks.filter((b) => b.kind === 'paragraph' && b.style === 'reference');
    expect(refs.length).toBeGreaterThan(2);
    expect(refs.map((r) => (r as { text: string }).text)).toContain(
      'Rademaker, M. E., & Schuberth, F. (2020). cSEM: Composite-Based Structural Equation Modeling (R package version 0.7.1). https://floschuberth.github.io/cSEM/',
    );
    const software = doc.blocks.find((b) => b.kind === 'table' && b.title === 'Software');
    const names = software?.kind === 'table' ? software.rows.map((r) => r[0].text) : [];
    expect(names).toEqual(expect.arrayContaining(['PLS Studio', 'cSEM', 'R', 'webR']));
  });

  it('leaves the raw data out unless asked, and then shows categories as labels', async () => {
    expect(doc.blocks.some((b) => b.kind === 'heading' && b.text === 'Data')).toBe(false);
    const t = dataTable(data, 'survey.csv')!;
    expect(t.columns).toEqual(['Case', 'x', 'y', 'grp']);
    expect(t.rows[1].map((c) => c.text)).toEqual(['2', '2', '4', 'women']);
    expect(t.rows[7][3].text).toBe('');
    const withData = await buildReport({ ...DEFAULT_REPORT_OPTIONS, data: true }, undefined, WHEN);
    expect(withData.blocks.some((b) => b.kind === 'heading' && b.text === 'Data')).toBe(true);
  });

  it('leaves out results tabs that hold only instructions', () => {
    const blocks: Block[] = [
      { kind: 'paragraph', text: 'cSEM 0.7.1', style: 'hint' },
      { kind: 'heading', level: 4, text: 'Moderation' },
      { kind: 'paragraph', text: 'No moderators in the model. Drag from a construct’s dot…' },
      { kind: 'heading', level: 4, text: 'Paths' },
      { kind: 'table', title: 'Paths', columns: ['Path'], rows: [] },
    ];
    expect(outline(dropEmptySections(blocks))).toEqual([
      'p:hint',
      'h4 Paths',
      'table "Paths" [Path] ×0',
    ]);
    const modelTabs = doc.blocks.filter((b) => b.kind === 'heading' && b.level === 4);
    expect(modelTabs.map((b) => (b as { text: string }).text)).not.toContain('Moderation');
  });

  it('describes the diagram in its alt text', () => {
    const alt = diagramAlt(plsInput().model);
    expect(alt).toMatch(/^Path diagram of the model with 3 constructs/);
    expect(alt).toContain('→');
  });

  it('collects engine tags from results and lists each package once', () => {
    const tags = engineTags({
      engine: { package: 'lavaan + manymome', version: '0.6-19 / 0.2.4' },
      inner: { engine: { package: 'lavaan', version: '0.6-19', desktop: 'R version 4.4.2' } },
    });
    expect(tags).toHaveLength(2);
    const t = softwareTable([...tags, ...tags], {});
    expect(t.rows.map((r) => r.map((c) => c.text).join(' '))).toEqual([
      'PLS Studio — This report',
      'lavaan 0.6-19 R in the browser (webR)',
      'manymome 0.2.4 R in the browser (webR)',
      'lavaan 0.6-19 Desktop R 4.4.2',
    ]);
  });
});

describe('HTML report', () => {
  let html = '';
  beforeAll(() => {
    html = reportHtml(doc);
  });

  it('is one self-contained file: no external URLs, no scripts', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain("default-src 'none'");
    expect(externalLoads(html)).toEqual([]);
    expect(html).not.toMatch(/<button|<input|<select|<textarea/);
  });

  it('escapes the user’s text', () => {
    expect(html).toContain('<h1>Loyalty &lt;study&gt;</h1>');
    expect(html).toContain('<h2>Descriptive &lt;checks&gt;</h2>');
    expect(html).toContain('<p class="note">Two outliers were<br>kept.</p>');
  });

  it('is accessible: table captions and header cells, figures with a name', () => {
    expect(html).toMatch(
      /<table><caption>[^<]+<\/caption><thead><tr><th scope="col" class="text">/,
    );
    expect(html).toMatch(/<th scope="row" class="text">/);
    expect(html).toMatch(/<figure><svg[^>]* role="img" aria-label="[^"]+"/);
    expect(html).toContain('<html lang="en">');
  });

  it('matches the snapshot of its element structure', () => {
    // Tags only (text, numbers and the drawings' insides vary with layout).
    const tags = [...html.replace(/<svg[\s\S]*?<\/svg>/g, '<svg/>').matchAll(/<(\/?[a-z0-9]+)/g)]
      .map((m) => m[1])
      .join(' ');
    expect(tags).toMatchSnapshot();
  });
});

describe('Word report', () => {
  let dir = '';
  let xml = '';
  beforeAll(async () => {
    const blob = await reportDocx(doc, async () => PNG, WHEN);
    dir = mkdtempSync(join(tmpdir(), 'report-docx-'));
    const file = join(dir, 'report.docx');
    writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
    expect(execFileSync('unzip', ['-t', file]).toString()).toContain('No errors detected');
    execFileSync('unzip', ['-q', file, '-d', dir]);
    xml = readFileSync(join(dir, 'word', 'document.xml'), 'utf8');
  });

  it('is a WordprocessingML package with styles, properties and the figure', () => {
    const types = readFileSync(join(dir, '[Content_Types].xml'), 'utf8');
    expect(types).toContain('wordprocessingml.document.main+xml');
    expect(readFileSync(join(dir, 'word', 'styles.xml'), 'utf8')).toContain('w:styleId="Heading2"');
    expect(readFileSync(join(dir, 'docProps', 'core.xml'), 'utf8')).toContain(
      '<dc:title>Loyalty &lt;study&gt;</dc:title>',
    );
    const rels = readFileSync(join(dir, 'word', '_rels', 'document.xml.rels'), 'utf8');
    expect(rels).toContain('Target="media/image1.png"');
    expect(readFileSync(join(dir, 'word', 'media', 'image1.png'))).toEqual(Buffer.from(PNG));
  });

  it('has every table as a real Word table with a header row and its caption', () => {
    const tables = doc.blocks.filter((b) => b.kind === 'table');
    expect(xml.match(/<w:tbl>/g)?.length).toBe(tables.length);
    expect(xml.match(/<w:tblHeader\/>/g)?.length).toBe(tables.length);
    const software = tables.find((t) => t.kind === 'table' && t.title === 'Software')!;
    expect(xml).toContain('<w:tblCaption w:val="Software"/>');
    if (software.kind === 'table') {
      for (const col of software.columns) expect(xml).toContain(`>${col}</w:t>`);
    }
    const paths = tables.find((t) => t.kind === 'table' && /path coefficients/i.test(t.title));
    expect(paths && paths.kind === 'table' && xml.includes(paths.rows[0][1].text)).toBe(true);
  });

  it('uses heading styles, alt text on figures and keeps the note’s line break', () => {
    expect(xml).toContain('<w:pStyle w:val="Title"/>');
    expect(xml).toContain('<w:pStyle w:val="Heading2"/>');
    expect(xml).toMatch(/<wp:docPr id="1" name="Figure 1" descr="[^"]+"\/>/);
    expect(xml).toContain('Two outliers were</w:t><w:br/><w:t xml:space="preserve">kept.');
    expect(xml).toContain('Descriptive &lt;checks&gt;');
  });

  it('is well-formed XML', () => {
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    expect(parsed.getElementsByTagName('parsererror')).toHaveLength(0);
    try {
      execFileSync('xmllint', ['--noout', join(dir, 'word', 'document.xml')]);
    } catch (e) {
      // xmllint is optional; a parse error is not.
      if ((e as { status?: number }).status) throw e;
    }
  });
});

describe('report pieces', () => {
  beforeEach(() => {
    g.IS_REACT_ACT_ENVIRONMENT = true;
  });

  it('reads tables from the Table component’s own data, with their notes', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <div>
          <p className="hint">Estimates below.</p>
          <Table
            title="Loadings"
            columns={['Indicator', 'λ']}
            rows={[[{ v: 'x1' }, { v: 0.81234, d: 2 }]]}
            note={<>Standardised.</>}
            file="loadings"
          />
          <div>
            <div className="table-tools">
              <h3>Construct scores</h3>
            </div>
            <button>
              <svg width="10" height="10" />
              Download scores (CSV)
            </button>
            <div className="table-note">Standardised proxy scores for each observation.</div>
          </div>
          <div className="stat-cards">
            <div className="stat-card">
              <div className="k">Observations</div>
              <div className="v">250</div>
            </div>
          </div>
        </div>,
      ),
    );
    const blocks = extractBlocks(host);
    act(() => root.unmount());
    host.remove();
    expect(blocks).toEqual([
      { kind: 'paragraph', text: 'Estimates below.', style: 'hint' },
      {
        kind: 'table',
        title: 'Loadings',
        columns: ['Indicator', 'λ'],
        rows: [
          [
            { text: 'x1', numeric: false },
            { text: '0.81', numeric: true },
          ],
        ],
        note: 'Standardised.',
      },
      {
        kind: 'table',
        title: 'Summary',
        columns: ['Statistic', 'Value'],
        rows: [
          [
            { text: 'Observations', numeric: false },
            { text: '250', numeric: true },
          ],
        ],
      },
    ]);
  });

  it('aligns a column by its contents: numbers and their placeholders right, text left', () => {
    const t: TableBlock = {
      kind: 'table',
      title: 'T',
      columns: ['Name', 'β', 'Type', 'p'],
      rows: [
        [cellOf('a'), cellOf(0.5), cellOf('factor'), cellOf(null)],
        [cellOf('b'), cellOf(null), cellOf('composite'), cellOf(null)],
      ],
    };
    expect(numericColumns(t)).toEqual([false, true, false, false]);
  });

  it('escapes text for Word and drops characters XML cannot hold', () => {
    expect(xmlText('a\u0001b & <c> "d"\tö\u{1F600}')).toBe(
      'ab &amp; &lt;c&gt; &quot;d&quot;\tö\u{1F600}',
    );
  });

  it('sanitises inline SVG: no scripts, handlers, foreign content or outside links; ids per figure', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="x()">' +
      '<script>alert(1)</script><foreignObject><div>hi</div></foreignObject>' +
      '<defs><marker id="arrow"><path d="M0 0"/></marker></defs>' +
      '<path marker-end="url(#arrow)" style="fill:url(https://evil.example/x)"/>' +
      '<use xlink:href="https://evil.example/s.svg#a"/><use href="#arrow"/>' +
      '<text>A &amp; B</text></svg>';
    const out = sanitizeSvg(svg, 'f1-', 'Chart "one"')!;
    expect(out).not.toMatch(/script|onload|foreignObject|evil\.example/);
    expect(out).toContain('id="f1-arrow"');
    expect(out).toContain('marker-end="url(#f1-arrow)"');
    expect(out).toContain('href="#f1-arrow"');
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="Chart &quot;one&quot;"');
    expect(out).toContain('A &amp; B');
    expect(sanitizeSvg('<html/>', 'p', 'x')).toBeNull();
  });
});
