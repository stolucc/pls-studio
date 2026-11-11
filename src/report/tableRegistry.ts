// The results tables as data: every Table component registers its title,
// columns, rows and note against its <table> element, so the report reads the
// values themselves (as the CSV and LaTeX exports do) rather than the page's
// text. Weakly held: an unmounted table's entry goes with its element.

import { cellOf, type TableBlock } from './blocks';

/** A table cell as the Table component holds it. */
export interface RegisteredCell {
  v: number | string | null;
  d?: number;
  bold?: boolean;
}

export interface RegisteredTable {
  title: string;
  columns: string[];
  rows: RegisteredCell[][];
  note?: string;
}

const tables = new WeakMap<Element, RegisteredTable>();

/** Called by the Table component when its <table> mounts or re-renders. */
export function registerTable(el: Element, data: RegisteredTable): void {
  tables.set(el, data);
}

/** The registered data of a <table>, as a report table; null for tables drawn elsewhere. */
export function registeredTable(el: Element): TableBlock | null {
  const t = tables.get(el);
  if (!t) return null;
  return {
    kind: 'table',
    title: t.title,
    columns: t.columns,
    rows: t.rows.map((r) => r.map((cell) => cellOf(cell.v, cell.d ?? 3, cell.bold))),
    ...(t.note ? { note: t.note } : {}),
  };
}
