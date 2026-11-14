// Editing a formula with buttons (the formula builder of the computed-column dialog): pure
// functions that insert a piece of text at the cursor, or remove one, and say where the cursor
// goes next. The text field stays the main way to write a formula; the buttons only add to it.

import type { Dataset } from '../engine/types';
import type { DataInfo } from '../model/project';
import { computeColumn, nameError } from './compute';
import { transformData } from './pipeline';

/** A formula being edited: its text and the selected range (start = end: just the cursor). */
export interface Edit {
  text: string;
  start: number;
  end: number;
}

/** What the parser reads as a word: a column (or function) name that needs no backticks. */
const BARE_NAME = /^[A-Za-z_][A-Za-z0-9_.]*$/;
/** Words the parser reads as something else than a column: and, or, not, and NA (missing). */
const RESERVED = new Set(['and', 'or', 'not', 'NA']);

/**
 * How a column name is written in a formula: as it is when the parser reads it as a name,
 * else in backticks (`my var`, `2nd wave`, `NA`). Null when it cannot be written at all (a name
 * with a backtick in it, which the parser has no escape for).
 */
export function quoteName(name: string): string | null {
  if (BARE_NAME.test(name) && !RESERVED.has(name)) return name;
  if (name.includes('`') || name === '') return null;
  return `\`${name}\``;
}

/** Replace the selection with `piece`; the cursor goes `cursor` characters into it (default: after it). */
export function insertAt(edit: Edit, piece: string, cursor = piece.length): Edit {
  const before = edit.text.slice(0, edit.start);
  const after = edit.text.slice(edit.end);
  const at = before.length + cursor;
  return { text: before + piece + after, start: at, end: at };
}

/**
 * Insert an operator (+, <=, and, …) with a space on either side, without doubling a space
 * that is already there and without a leading space at the start of the formula or after "(".
 */
export function insertOperator(edit: Edit, op: string): Edit {
  const before = edit.text.slice(0, edit.start);
  const after = edit.text.slice(edit.end);
  let piece = op;
  const last = before.slice(-1);
  if (before !== '' && last !== ' ' && last !== '(') piece = ' ' + piece;
  if (!after.startsWith(' ')) piece = piece + ' ';
  return insertAt(edit, piece);
}

/** Insert ", " between the arguments of a function. */
export function insertComma(edit: Edit): Edit {
  const after = edit.text.slice(edit.end);
  const piece = after.startsWith(' ') ? ',' : ', ';
  return insertAt(edit, piece);
}

/**
 * Insert a function call. With nothing selected: "name()" with the cursor between the
 * parentheses; with a selection: the selection becomes the argument, "name(selection)", and the
 * cursor goes after it.
 */
export function insertFunction(edit: Edit, name: string): Edit {
  const selected = edit.text.slice(edit.start, edit.end);
  if (selected === '') return insertAt(edit, `${name}()`, name.length + 1);
  return insertAt(edit, `${name}(${selected})`);
}

/** Insert a column's name, in backticks where the parser needs them. Unchanged when it cannot be written. */
export function insertColumn(edit: Edit, name: string): Edit {
  const quoted = quoteName(name);
  if (quoted === null) return edit;
  return insertAt(edit, quoted);
}

// What one press of Backspace removes before the cursor: an operator with its spaces, a
// function name with its "(", a backticked name, or else one character. The words and, or, not
// count only as whole words ("brand" loses one letter, not "and").
const LAST_PIECE = new RegExp(
  [
    String.raw` ?(?:<=|>=|==|!=|(?<![A-Za-z0-9_.])(?:and|or|not)|[-+*/^<>&|]) ?$`,
    String.raw`, ?$`,
    String.raw`[A-Za-z_][A-Za-z0-9_.]*\($`,
    '`[^`]*`$',
  ].join('|'),
);

/** Backspace: remove the selection, or the last piece before the cursor (see LAST_PIECE). */
export function backspace(edit: Edit): Edit {
  if (edit.start !== edit.end) return insertAt(edit, '');
  if (edit.start === 0) return edit;
  const before = edit.text.slice(0, edit.start);
  const match = LAST_PIECE.exec(before);
  const length = match ? match[0].length : 1;
  return insertAt({ ...edit, start: edit.start - length }, '');
}

/** The result of trying a formula before the column is made. */
export type Preview =
  | { error: string }
  | { first: number[]; missing: number; rows: number; column: string };

/**
 * Compute the column as the dialog would (the same computeColumn over every case, the filter
 * applied afterwards) without keeping it: the first `count` values and how many are missing, or
 * why the formula cannot be computed. While the name is not usable yet, a stand-in name is used,
 * so the formula can be checked first.
 */
export function previewFormula(
  data: Dataset,
  info: DataInfo,
  name: string,
  expr: string,
  editing?: string,
  count = 5,
): Preview {
  let column = name.trim();
  if (nameError(column, data, info, editing)) column = standInName(data);
  try {
    const r = transformData(data, info, (d, i) => computeColumn(d, i, column, expr), {
      recompute: !!editing,
    });
    const values = r.data.cols[r.data.names.indexOf(column)];
    const missing = values.filter(Number.isNaN).length;
    return { first: Array.from(values.slice(0, count)), missing, rows: values.length, column };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** A column name that is not in the dataset (for a preview before the name is chosen). */
function standInName(data: Dataset): string {
  let k = 1;
  while (data.names.includes(`new_column_${k}`)) k++;
  return `new_column_${k}`;
}
