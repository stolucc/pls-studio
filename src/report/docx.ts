// The report as a Word document (.docx), written in the browser with the `docx`
// library. Tables are real Word tables (header row repeated on each page, the
// caption as a "Caption" paragraph above), headings use Word's built-in heading
// styles (navigation pane, outline), and figures are PNG images with alt text.

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type ParagraphChild,
} from 'docx';
import {
  numericColumns,
  type Block,
  type FigureBlock,
  type ParagraphStyle,
  type ReportDoc,
  type TableBlock,
} from './blocks';

/** Rasterises an SVG to PNG bytes (in the browser: figure/export.ts pngBlob). */
export type Rasterise = (svg: string, width: number, height: number) => Promise<Uint8Array>;

// A4 with 2.54 cm margins, in twentieths of a point (twips).
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 1440;
const TEXT_TWIPS = PAGE_W - 2 * MARGIN;
// The text width in pixels at 96 dpi (1 inch = 1440 twips = 96 px), for figure sizes.
const TEXT_PX = Math.round((TEXT_TWIPS / 1440) * 96);

const HEADING: Record<1 | 2 | 3 | 4 | 5, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
};

/** The app's own paragraph styles (defined in STYLES below); body and notes use Normal. */
const PARAGRAPH_STYLE: Record<ParagraphStyle, string | undefined> = {
  body: undefined,
  meta: 'Meta',
  status: 'Status',
  note: undefined,
  hint: 'Hint',
  reference: 'Reference',
};

/** A code point XML 1.0 allows (control characters other than tab and line ends do not). */
function xmlAllowed(c: number): boolean {
  if (c === 0x9 || c === 0xa || c === 0xd) return true;
  if (c >= 0x20 && c <= 0xd7ff) return true;
  if (c >= 0xe000 && c <= 0xfffd) return true;
  return c >= 0x10000 && c <= 0x10ffff;
}

/** The text without the characters a Word document (XML) cannot hold; the library escapes the rest. */
export function wordText(s: string): string {
  let out = '';
  for (const ch of s) {
    if (xmlAllowed(ch.codePointAt(0)!)) out += ch;
  }
  return out;
}

/** Text runs for one paragraph: each line break in the text becomes a Word line break. */
function runs(text: string, style: { bold?: boolean; italics?: boolean } = {}): TextRun[] {
  return wordText(text)
    .split('\n')
    .map((line, i) => new TextRun({ text: line, break: i > 0 ? 1 : undefined, ...style }));
}

/** Column widths (twips) in proportion to their longest text, fitted to the page. */
function columnWidths(t: TableBlock): number[] {
  const n = Math.max(t.columns.length, ...t.rows.map((r) => r.length), 1);
  const longest = Array.from({ length: n }, (_, j) => {
    const texts = [t.columns[j] ?? '', ...t.rows.map((r) => r[j]?.text ?? '')];
    return Math.max(3, ...texts.map((s) => Math.min(s.length, 40)));
  });
  const total = longest.reduce((a, b) => a + b, 0);
  return longest.map((len) => Math.floor((len / total) * TEXT_TWIPS));
}

function tableCell(
  text: string,
  width: number,
  alignRight: boolean,
  head: boolean,
  bold?: boolean,
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.BOTTOM,
    // A rule under the header row; the table itself has rules above and below (APA style).
    borders: head ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' } } : undefined,
    children: [
      new Paragraph({
        style: 'TableText',
        alignment: alignRight ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: runs(text, { bold }),
      }),
    ],
  });
}

function tableBlocks(t: TableBlock): (Paragraph | Table)[] {
  const widths = columnWidths(t);
  const numeric = numericColumns(t);
  const out: (Paragraph | Table)[] = [];
  if (t.title) {
    out.push(
      new Paragraph({
        style: 'Caption',
        keepNext: true,
        children: runs(t.title, { italics: true }),
      }),
    );
  }
  const rows: TableRow[] = [];
  if (t.columns.length) {
    const cells = widths.map((w, j) => tableCell(t.columns[j] ?? '', w, numeric[j], true));
    // Repeated at the top of each page; marks the header row for screen readers.
    rows.push(new TableRow({ tableHeader: true, cantSplit: true, children: cells }));
  }
  for (const r of t.rows) {
    const cells = widths.map((w, j) =>
      tableCell(r[j]?.text ?? '', w, numeric[j], false, r[j]?.bold),
    );
    rows.push(new TableRow({ cantSplit: true, children: cells }));
  }
  const rule = { style: BorderStyle.SINGLE, size: 12, color: '000000' };
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  out.push(
    new Table({
      rows,
      columnWidths: widths,
      layout: TableLayoutType.AUTOFIT,
      borders: {
        top: rule,
        bottom: rule,
        left: none,
        right: none,
        insideHorizontal: none,
        insideVertical: none,
      },
    }),
  );
  if (t.note) {
    out.push(
      new Paragraph({
        style: 'TableNote',
        children: [new TextRun({ text: 'Note. ', italics: true }), ...runs(t.note)],
      }),
    );
  } else {
    // Word needs a paragraph between two consecutive tables.
    out.push(new Paragraph({ style: 'TableNote' }));
  }
  return out;
}

/** A figure as an inline PNG, fitted to the text width with its aspect ratio kept. */
function figureBlocks(f: FigureBlock, png: Uint8Array | undefined, index: number): Paragraph[] {
  if (!png) return [new Paragraph({ style: 'Hint', children: runs(`[Figure: ${f.alt}]`) })];
  let width = f.width;
  let height = f.height;
  if (width > TEXT_PX) {
    height = Math.round((height * TEXT_PX) / width);
    width = TEXT_PX;
  }
  const image = new ImageRun({
    type: 'png',
    data: png,
    transformation: { width, height },
    altText: { name: `Figure ${index}`, title: f.caption ?? `Figure ${index}`, description: f.alt },
  });
  const out = [new Paragraph({ style: 'Figure', children: [image as ParagraphChild] })];
  if (f.caption) out.push(new Paragraph({ style: 'FigureCaption', children: runs(f.caption) }));
  return out;
}

function blockContent(
  b: Block,
  images: Map<Block, { png: Uint8Array; index: number }>,
): (Paragraph | Table)[] {
  switch (b.kind) {
    case 'heading':
      return [new Paragraph({ heading: HEADING[b.level], keepNext: true, children: runs(b.text) })];
    case 'paragraph':
      return [new Paragraph({ style: PARAGRAPH_STYLE[b.style ?? 'body'], children: runs(b.text) })];
    case 'list':
      return b.items.map(
        (item) => new Paragraph({ style: 'ListItem', children: runs(`•\t${item}`) }),
      );
    case 'table':
      return tableBlocks(b);
    case 'figure': {
      const image = images.get(b);
      return figureBlocks(b, image?.png, image?.index ?? 0);
    }
  }
}

// The app's paragraph styles; Word's own Title, Heading 1–5 and Normal are used as they are.
const small = { size: 18 };
const STYLES = [
  { id: 'Meta', name: 'Meta', basedOn: 'Normal', run: { ...small, color: '555555' } },
  { id: 'Status', name: 'Status', basedOn: 'Normal', run: { color: '9A5B00', bold: true } },
  {
    id: 'Hint',
    name: 'Hint',
    basedOn: 'Normal',
    run: { ...small, color: '555555', italics: true },
  },
  {
    id: 'Reference',
    name: 'Reference',
    basedOn: 'Normal',
    paragraph: { indent: { left: 720, hanging: 720 } },
  },
  {
    id: 'Byline',
    name: 'Byline',
    basedOn: 'Normal',
    run: { color: '555555' },
    paragraph: { spacing: { after: 240 } },
  },
  {
    id: 'Caption',
    name: 'Caption',
    basedOn: 'Normal',
    paragraph: { spacing: { before: 240, after: 80 } },
  },
  {
    id: 'TableText',
    name: 'Table Text',
    basedOn: 'Normal',
    run: small,
    paragraph: { spacing: { before: 20, after: 20 } },
  },
  {
    id: 'TableNote',
    name: 'Table Note',
    basedOn: 'Normal',
    run: small,
    paragraph: { spacing: { before: 80, after: 240 } },
  },
  {
    id: 'Figure',
    name: 'Figure',
    basedOn: 'Normal',
    paragraph: { spacing: { before: 120, after: 80 } },
  },
  {
    id: 'FigureCaption',
    name: 'Figure Caption',
    basedOn: 'Normal',
    run: { ...small, italics: true },
  },
  {
    id: 'ListItem',
    name: 'List Item',
    basedOn: 'Normal',
    paragraph: { indent: { left: 360, hanging: 360 } },
  },
];

/** The report as a .docx file. Figures that cannot be rasterised are named in a placeholder. */
export async function reportDocx(doc: ReportDoc, rasterise: Rasterise): Promise<Blob> {
  const images = new Map<Block, { png: Uint8Array; index: number }>();
  let index = 0;
  for (const b of doc.blocks) {
    if (b.kind !== 'figure') continue;
    try {
      const png = await rasterise(b.svg, b.width, b.height);
      index += 1;
      images.set(b, { png, index });
    } catch {
      // (the placeholder paragraph names the figure)
    }
  }
  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: runs(doc.title) }),
    new Paragraph({ style: 'Byline', children: runs(doc.date) }),
    ...doc.blocks.flatMap((b) => blockContent(b, images)),
  ];
  const document = new Document({
    title: doc.title,
    creator: 'PLS Studio',
    lastModifiedBy: 'PLS Studio',
    styles: { paragraphStyles: STYLES },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE_W, height: PAGE_H },
            margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBlob(document);
}
