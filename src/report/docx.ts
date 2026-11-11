// The report as a Word document (.docx, Office Open XML), written in the
// browser: a WordprocessingML package zipped by replication/zip.ts. Tables are
// real Word tables (header row repeated on each page, caption as alt text),
// headings use Word's built-in heading styles (navigation pane, outline), and
// figures are PNG images with their alt text. No dependency, no eval.

import { makeZip, type ZipEntry } from '../replication/zip';
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

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

// A4 with 2.54 cm margins, in twentieths of a point; the text width in EMU.
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = 1440;
const TEXT_TWIPS = PAGE_W - 2 * MARGIN;
const EMU_PER_TWIP = 635;
const EMU_PER_PX = 9525;

/** A code point XML 1.0 allows (control characters other than tab and line ends do not). */
function xmlAllowed(c: number): boolean {
  if (c === 0x9 || c === 0xa || c === 0xd) return true;
  if (c >= 0x20 && c <= 0xd7ff) return true;
  if (c >= 0xe000 && c <= 0xfffd) return true;
  return c >= 0x10000 && c <= 0x10ffff;
}

/** The text without the characters XML cannot hold. */
function xmlChars(s: string): string {
  let out = '';
  for (const ch of s) {
    if (xmlAllowed(ch.codePointAt(0)!)) out += ch;
  }
  return out;
}

/** Text for XML content and attributes. */
export function xmlText(s: string): string {
  return xmlChars(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface RunStyle {
  bold?: boolean;
  italic?: boolean;
}

/** One run of text; line breaks become <w:br/>. */
function run(text: string, style: RunStyle = {}): string {
  const props = [style.bold ? '<w:b/>' : '', style.italic ? '<w:i/>' : ''].join('');
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
  const pieces = text.split('\n').map((line) => `<w:t xml:space="preserve">${xmlText(line)}</w:t>`);
  return `<w:r>${rPr}${pieces.join('<w:br/>')}</w:r>`;
}

interface ParaOptions {
  style?: string;
  align?: 'left' | 'right' | 'center';
  keepNext?: boolean;
}

function paragraph(runs: string, o: ParaOptions = {}): string {
  const props = [
    o.style ? `<w:pStyle w:val="${o.style}"/>` : '',
    o.keepNext ? '<w:keepNext/>' : '',
    o.align && o.align !== 'left' ? `<w:jc w:val="${o.align}"/>` : '',
  ].join('');
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs}</w:p>`;
}

const PARAGRAPH_STYLE: Record<ParagraphStyle, string | undefined> = {
  body: undefined,
  meta: 'Meta',
  status: 'Status',
  note: undefined,
  hint: 'Hint',
  reference: 'Reference',
};

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

function cell(
  text: string,
  width: number,
  align: 'left' | 'right',
  o: RunStyle & { head?: boolean },
) {
  const border = o.head
    ? '<w:tcBorders><w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/></w:tcBorders>'
    : '';
  const tcPr = `<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${border}<w:vAlign w:val="bottom"/></w:tcPr>`;
  const p = paragraph(run(text, o), { style: 'TableText', align });
  return `<w:tc>${tcPr}${p}</w:tc>`;
}

function tableXml(t: TableBlock): string {
  const widths = columnWidths(t);
  const numeric = numericColumns(t);
  const out: string[] = [];
  if (t.title)
    out.push(paragraph(run(t.title, { italic: true }), { style: 'Caption', keepNext: true }));
  const borders =
    '<w:tblBorders>' +
    '<w:top w:val="single" w:sz="12" w:space="0" w:color="000000"/>' +
    '<w:bottom w:val="single" w:sz="12" w:space="0" w:color="000000"/>' +
    '</w:tblBorders>';
  const caption = t.title ? `<w:tblCaption w:val="${xmlText(t.title)}"/>` : '';
  const tblPr =
    `<w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}` +
    '<w:tblLayout w:type="autofit"/>' +
    '<w:tblLook w:val="0020" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/>' +
    `${caption}</w:tblPr>`;
  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const rows: string[] = [];
  if (t.columns.length) {
    const cells = widths.map((w, j) => {
      const align = numeric[j] ? 'right' : 'left';
      return cell(t.columns[j] ?? '', w, align, { head: true });
    });
    // Repeated at the top of each page; marks the header row for screen readers.
    rows.push(`<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${cells.join('')}</w:tr>`);
  }
  for (const r of t.rows) {
    const cells = widths.map((w, j) => {
      const c = r[j];
      const align = numeric[j] ? 'right' : 'left';
      return cell(c?.text ?? '', w, align, { bold: c?.bold });
    });
    rows.push(`<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join('')}</w:tr>`);
  }
  out.push(`<w:tbl>${tblPr}${grid}${rows.join('')}</w:tbl>`);
  if (t.note) {
    out.push(paragraph(run('Note. ', { italic: true }) + run(t.note), { style: 'TableNote' }));
  } else {
    // Word needs a paragraph between two consecutive tables.
    out.push(paragraph('', { style: 'TableNote' }));
  }
  return out.join('');
}

interface Image {
  id: number;
  rel: string;
  file: string;
  data: Uint8Array;
}

function drawing(f: FigureBlock, img: Image): string {
  // Fit to the text width, keep the aspect ratio.
  const maxEmu = TEXT_TWIPS * EMU_PER_TWIP;
  let cx = Math.round(f.width * EMU_PER_PX);
  let cy = Math.round(f.height * EMU_PER_PX);
  if (cx > maxEmu) {
    cy = Math.round((cy * maxEmu) / cx);
    cx = maxEmu;
  }
  const alt = xmlText(f.alt);
  const name = `Figure ${img.id}`;
  return (
    '<w:r><w:drawing>' +
    `<wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${img.id}" name="${name}" descr="${alt}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="${PIC_NS}">` +
    '<pic:pic>' +
    `<pic:nvPicPr><pic:cNvPr id="${img.id}" name="${img.file}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${img.rel}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}

function blockXml(b: Block, images: Map<Block, Image>): string {
  switch (b.kind) {
    case 'heading':
      return paragraph(run(b.text), { style: `Heading${b.level}`, keepNext: true });
    case 'paragraph':
      return paragraph(run(b.text), { style: PARAGRAPH_STYLE[b.style ?? 'body'] });
    case 'list':
      return b.items.map((item) => paragraph(run(`•\t${item}`), { style: 'ListItem' })).join('');
    case 'table':
      return tableXml(b);
    case 'figure': {
      const img = images.get(b);
      const caption = b.caption ? paragraph(run(b.caption), { style: 'FigureCaption' }) : '';
      if (!img) return paragraph(run(`[Figure: ${b.alt}]`), { style: 'Hint' });
      return paragraph(drawing(b, img), { style: 'Figure' }) + caption;
    }
  }
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** A paragraph style; `heading`: its outline level (0 = Heading 1). */
function style(id: string, name: string, pPr: string, rPr: string, heading?: number): string {
  const outline = heading === undefined ? '' : `<w:outlineLvl w:val="${heading}"/>`;
  const extra = heading === undefined ? '' : '<w:uiPriority w:val="9"/><w:qFormat/>';
  return (
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>` +
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/>' +
    extra +
    `<w:pPr>${pPr}${outline}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`
  );
}

const STYLES =
  XML_HEAD +
  `<w:styles xmlns:w="${W_NS}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>' +
  '<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-GB"/>' +
  '</w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
  '</w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  style(
    'Title',
    'Title',
    '<w:keepNext/><w:spacing w:after="60"/>',
    '<w:b/><w:sz w:val="36"/><w:szCs w:val="36"/>',
  ) +
  style(
    'Heading1',
    'heading 1',
    '<w:keepNext/><w:spacing w:before="360" w:after="120"/>',
    '<w:b/><w:sz w:val="32"/>',
    0,
  ) +
  style(
    'Heading2',
    'heading 2',
    '<w:keepNext/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="999999"/></w:pBdr><w:spacing w:before="480" w:after="120"/>',
    '<w:b/><w:sz w:val="30"/>',
    1,
  ) +
  style(
    'Heading3',
    'heading 3',
    '<w:keepNext/><w:spacing w:before="360" w:after="60"/>',
    '<w:b/><w:sz w:val="26"/>',
    2,
  ) +
  style(
    'Heading4',
    'heading 4',
    '<w:keepNext/><w:spacing w:before="240" w:after="60"/>',
    '<w:b/><w:sz w:val="24"/>',
    3,
  ) +
  style(
    'Heading5',
    'heading 5',
    '<w:keepNext/><w:spacing w:before="200" w:after="40"/>',
    '<w:i/><w:sz w:val="22"/>',
    4,
  ) +
  style('Byline', 'Byline', '<w:spacing w:after="360"/>', '<w:color w:val="555555"/>') +
  style('Meta', 'Card details', '', '<w:color w:val="555555"/><w:sz w:val="20"/>') +
  style('Hint', 'Hint', '', '<w:color w:val="444444"/><w:sz w:val="20"/>') +
  style(
    'Status',
    'Status',
    '<w:pBdr><w:left w:val="single" w:sz="18" w:space="4" w:color="C77700"/></w:pBdr>',
    '<w:sz w:val="20"/>',
  ) +
  style('Reference', 'Reference', '<w:ind w:left="720" w:hanging="720"/>', '') +
  style(
    'ListItem',
    'List item',
    '<w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs><w:spacing w:after="40"/><w:ind w:left="360" w:hanging="360"/>',
    '',
  ) +
  style(
    'Caption',
    'caption',
    '<w:keepNext/><w:spacing w:before="200" w:after="60"/>',
    '<w:sz w:val="22"/>',
  ) +
  style(
    'TableText',
    'Table text',
    '<w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/>',
    '<w:sz w:val="19"/><w:szCs w:val="19"/>',
  ) +
  style(
    'TableNote',
    'Table note',
    '<w:spacing w:before="60" w:after="240"/>',
    '<w:sz w:val="20"/>',
  ) +
  style('Figure', 'Figure', '<w:keepNext/><w:spacing w:before="120" w:after="60"/>', '') +
  style('FigureCaption', 'Figure caption', '<w:spacing w:after="240"/>', '<w:sz w:val="20"/>') +
  '</w:styles>';

function contentTypes(hasImages: boolean): string {
  return (
    XML_HEAD +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (hasImages ? '<Default Extension="png" ContentType="image/png"/>' : '') +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>'
  );
}

const ROOT_RELS =
  XML_HEAD +
  `<Relationships xmlns="${PKG_REL}">` +
  `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/>` +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '</Relationships>';

function documentRels(images: Image[]): string {
  const imgs = images
    .map((i) => `<Relationship Id="${i.rel}" Type="${REL}/image" Target="media/${i.file}"/>`)
    .join('');
  return (
    XML_HEAD +
    `<Relationships xmlns="${PKG_REL}">` +
    `<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>` +
    imgs +
    '</Relationships>'
  );
}

function coreProps(title: string, when: Date): string {
  return (
    XML_HEAD +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xmlText(title)}</dc:title>` +
    '<dc:creator>PLS Studio</dc:creator>' +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${when.toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>` +
    '</cp:coreProperties>'
  );
}

/** The document part (word/document.xml) for the blocks, with the images it refers to. */
export function documentXml(doc: ReportDoc, images: Map<Block, Image>): string {
  const body = [
    paragraph(run(doc.title), { style: 'Title' }),
    paragraph(run(doc.date), { style: 'Byline' }),
    ...doc.blocks.map((b) => blockXml(b, images)),
  ].join('');
  const sect =
    `<w:sectPr><w:pgSz w:w="${PAGE_W}" w:h="${PAGE_H}"/>` +
    `<w:pgMar w:top="${MARGIN}" w:right="${MARGIN}" w:bottom="${MARGIN}" w:left="${MARGIN}" ` +
    'w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  return (
    XML_HEAD +
    `<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}">` +
    `<w:body>${body}${sect}</w:body></w:document>`
  );
}

/** The report as a .docx file. Figures that cannot be rasterised are named in a placeholder. */
export async function reportDocx(
  doc: ReportDoc,
  rasterise: Rasterise,
  when = new Date(),
): Promise<Blob> {
  const images = new Map<Block, Image>();
  let n = 0;
  for (const b of doc.blocks) {
    if (b.kind !== 'figure') continue;
    try {
      const data = await rasterise(b.svg, b.width, b.height);
      n += 1;
      images.set(b, { id: n, rel: `rIdImg${n}`, file: `image${n}.png`, data });
    } catch {
      // (the placeholder paragraph names the figure)
    }
  }
  const list = [...images.values()];
  const entries: ZipEntry[] = [
    { path: '[Content_Types].xml', data: contentTypes(list.length > 0) },
    { path: '_rels/.rels', data: ROOT_RELS },
    { path: 'docProps/core.xml', data: coreProps(doc.title, when) },
    { path: 'word/document.xml', data: documentXml(doc, images) },
    { path: 'word/styles.xml', data: STYLES },
    { path: 'word/_rels/document.xml.rels', data: documentRels(list) },
    ...list.map((i) => ({ path: `word/media/${i.file}`, data: i.data })),
  ];
  const zip = await makeZip(entries, when);
  return new Blob([zip], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
