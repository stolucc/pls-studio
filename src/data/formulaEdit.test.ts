import { describe, expect, it } from 'vitest';
import type { Dataset } from '../engine/types';
import type { DataInfo } from '../model/project';
import { columnsIn, parseFormula } from './compute';
import {
  backspace,
  insertAt,
  insertColumn,
  insertComma,
  insertFunction,
  insertOperator,
  previewFormula,
  quoteName,
  type Edit,
} from './formulaEdit';

/** An edit from text with | for the cursor (or [ and ] around a selection). */
function at(marked: string): Edit {
  if (marked.includes('|')) {
    const i = marked.indexOf('|');
    return { text: marked.replace('|', ''), start: i, end: i };
  }
  const start = marked.indexOf('[');
  const end = marked.indexOf(']') - 1;
  return { text: marked.replace('[', '').replace(']', ''), start, end };
}
/** The edit as text with | for the cursor. */
function show(e: Edit): string {
  expect(e.start).toBe(e.end);
  return e.text.slice(0, e.start) + '|' + e.text.slice(e.start);
}

describe('quoteName', () => {
  it('leaves names the parser reads as names as they are', () => {
    expect(quoteName('x1')).toBe('x1');
    expect(quoteName('income.log')).toBe('income.log');
    expect(quoteName('_tmp')).toBe('_tmp');
    expect(quoteName('log')).toBe('log');
  });

  it('puts other names in backticks, and they parse back to the same column', () => {
    for (const name of ['my var', '2nd wave', 'q-1', 'NA', 'and', 'or', 'not', 'é', 'a"b']) {
      const quoted = quoteName(name)!;
      expect(quoted).toBe(`\`${name}\``);
      expect(columnsIn(parseFormula(quoted))).toEqual([name]);
    }
    expect(columnsIn(parseFormula(`${quoteName('my var')} + ${quoteName('x1')}`))).toEqual([
      'my var',
      'x1',
    ]);
  });

  it('cannot write a name with a backtick', () => {
    expect(quoteName('a`b')).toBeNull();
    expect(insertColumn(at('x + |'), 'a`b')).toEqual(at('x + |'));
  });
});

describe('inserting at the cursor', () => {
  it('inserts text at the cursor or over the selection', () => {
    expect(show(insertAt(at('12|'), '3'))).toBe('123|');
    expect(show(insertAt(at('1|3'), '2'))).toBe('12|3');
    expect(show(insertAt(at('[old] + 1'), 'x'))).toBe('x| + 1');
  });

  it('spaces operators without doubling spaces', () => {
    expect(show(insertOperator(at('x|'), '+'))).toBe('x + |');
    expect(show(insertOperator(at('x |'), '*'))).toBe('x * |');
    expect(show(insertOperator(at('|'), '-'))).toBe('- |');
    expect(show(insertOperator(at('(|'), 'not'))).toBe('(not |');
    expect(show(insertOperator(at('x| y'), '<='))).toBe('x <=| y');
    expect(show(insertOperator(at('age >= 18|'), 'and'))).toBe('age >= 18 and |');
    expect(show(insertComma(at('round(x|)')))).toBe('round(x, |)');
  });

  it('inserts a function with the cursor inside its parentheses, or around the selection', () => {
    expect(show(insertFunction(at('|'), 'log'))).toBe('log(|)');
    expect(show(insertFunction(at('1 + |'), 'sqrt'))).toBe('1 + sqrt(|)');
    expect(show(insertFunction(at('[x1 + x2] / 2'), 'abs'))).toBe('abs(x1 + x2)| / 2');
  });

  it('inserts column names, quoted where needed', () => {
    expect(show(insertColumn(at('log(|)'), 'income'))).toBe('log(income|)');
    expect(show(insertColumn(at('|'), 'my var'))).toBe('`my var`|');
  });

  it('builds a formula that parses, as clicking would', () => {
    let e = at('|');
    e = insertFunction(e, 'reverse');
    e = insertColumn(e, 'q 3');
    e = insertComma(e);
    e = insertAt(e, '1');
    e = insertComma(e);
    e = insertAt(e, '5');
    expect(show(e)).toBe('reverse(`q 3`, 1, 5|)');
    expect(() => parseFormula(e.text)).not.toThrow();
  });
});

describe('backspace', () => {
  it('removes the selection, or one character', () => {
    expect(show(backspace(at('[x1] + 2')))).toBe('| + 2');
    expect(show(backspace(at('123|')))).toBe('12|');
    expect(show(backspace(at('|x')))).toBe('|x');
  });

  it('removes an operator with its spaces, a function with its parenthesis, a quoted name', () => {
    expect(show(backspace(at('x + |')))).toBe('x|');
    expect(show(backspace(at('x <= |')))).toBe('x|');
    expect(show(backspace(at('a and |')))).toBe('a|');
    expect(show(backspace(at('round(x, |)')))).toBe('round(x|)');
    expect(show(backspace(at('1 + log(|)')))).toBe('1 + |)');
    expect(show(backspace(at('`my var`|')))).toBe('|');
  });

  it('treats and, or, not as words only when they stand alone', () => {
    expect(show(backspace(at('brand|')))).toBe('bran|');
    expect(show(backspace(at('color|')))).toBe('colo|');
  });
});

describe('previewFormula', () => {
  const data: Dataset = {
    names: ['q1', 'q2', 'my var'],
    cols: [
      Float64Array.from([1, 2, 3, 4, 5, NaN, 2]),
      Float64Array.from([5, 4, 3, 2, 1, 1, 1]),
      Float64Array.from([0, 0, 1, 1, 1, 1, 0]),
    ],
  };
  const info: DataInfo = { fileName: 'd.csv', rows: 7, missingCells: 1, excluded: [] };

  it('gives the first values and the number of missing results', () => {
    expect(previewFormula(data, info, 'q1r', 'reverse(q1, 1, 5)')).toEqual({
      first: [5, 4, 3, 2, 1],
      missing: 1,
      rows: 7,
      column: 'q1r',
    });
    expect(previewFormula(data, info, 'm', 'q1 + `my var`', undefined, 2)).toMatchObject({
      first: [1, 2],
    });
  });

  it('uses a stand-in name while the name is not usable yet', () => {
    expect(previewFormula(data, info, '', 'q1 * 2')).toMatchObject({
      first: [2, 4, 6, 8, 10],
      column: 'new_column_1',
    });
    expect(previewFormula(data, info, 'q1', 'q2 * 2')).toMatchObject({ column: 'new_column_1' });
  });

  it('gives the parser’s or the computation’s message', () => {
    expect(previewFormula(data, info, 'a', 'q1 +')).toEqual({
      error: 'The formula ends too early.',
    });
    expect(previewFormula(data, info, 'a', 'income')).toEqual({
      error: '“income” is not a column of the dataset.',
    });
    expect(previewFormula(data, info, 'a', 'reverse(q1, 5, 1)')).toEqual({
      error: 'reverse(x, low, high): low must be below high, e.g. reverse(q3, 1, 5).',
    });
  });
});
