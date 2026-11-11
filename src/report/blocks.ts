// The report as a list of plain blocks (headings, paragraphs, tables, figures,
// lists). The report builder produces them from the project and the results;
// the HTML and Word writers turn the same blocks into their formats, so both
// files have the same content and structure.

import { fmt } from '../format';

/** One cell of a report table, as displayed in the app. */
export interface ReportCell {
  text: string;
  /** Numbers are right-aligned. */
  numeric: boolean;
  bold?: boolean;
}

/** A results table: real rows and columns, never a picture. */
export interface TableBlock {
  kind: 'table';
  title: string;
  columns: string[];
  rows: ReportCell[][];
  note?: string;
}

/** A figure: an SVG document (charts, the path diagram). */
export interface FigureBlock {
  kind: 'figure';
  svg: string;
  width: number;
  height: number;
  /** Alternative text (required for accessibility). */
  alt: string;
  caption?: string;
}

/** Paragraph styles: meta lines under a card title, warnings, the user's notes, hints. */
export type ParagraphStyle = 'body' | 'meta' | 'status' | 'note' | 'hint' | 'reference';

export interface ParagraphBlock {
  kind: 'paragraph';
  /** Line breaks ("\n") are kept. */
  text: string;
  style?: ParagraphStyle;
}

export interface HeadingBlock {
  kind: 'heading';
  /** 1: the report title; 2: sections; 3: cards; 4 and 5: inside a card. */
  level: 1 | 2 | 3 | 4 | 5;
  text: string;
}

export interface ListBlock {
  kind: 'list';
  items: string[];
}

export type Block = HeadingBlock | ParagraphBlock | TableBlock | FigureBlock | ListBlock;

/** A whole report. */
export interface ReportDoc {
  title: string;
  /** The date line under the title. */
  date: string;
  blocks: Block[];
}

/** A cell from a value as the app displays it (numbers with their decimals). */
export function cellOf(v: number | string | null, digits = 3, bold?: boolean): ReportCell {
  if (typeof v === 'number') {
    return { text: fmt(v, digits), numeric: true, ...(bold ? { bold } : {}) };
  }
  return { text: v ?? '—', numeric: false, ...(bold ? { bold } : {}) };
}

/** A placeholder cell ("—" or empty): takes its column's alignment. */
const placeholder = (c: ReportCell) => !c.numeric && (c.text === '—' || c.text === '');

/**
 * Which columns are numeric (right-aligned, header included): every cell a
 * number or a placeholder, and at least one number. The first column holds
 * row names and stays left-aligned.
 */
export function numericColumns(t: TableBlock): boolean[] {
  const n = Math.max(t.columns.length, ...t.rows.map((r) => r.length), 0);
  return Array.from({ length: n }, (_, j) => {
    if (j === 0) return false;
    const cells = t.rows.map((r) => r[j]).filter((c): c is ReportCell => !!c);
    const numbers = cells.some((c) => c.numeric);
    return numbers && cells.every((c) => c.numeric || placeholder(c));
  });
}
