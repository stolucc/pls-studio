import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, parseCsvRows } from './dataset';

describe('parseCsv', () => {
  it('parses quoted fields, CRLF and BOM', () => {
    const rows = parseCsvRows('﻿"a","b, c"\r\n1,"he said ""hi"""\r\n', ',');
    expect(rows).toEqual([
      ['a', 'b, c'],
      ['1', 'he said "hi"'],
    ]);
  });
  it('detects delimiters', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('"x;y",b,c\n')).toBe(',');
  });
  it('converts missing tokens to NaN and excludes empty columns', () => {
    const r = parseCsv('id,x,name,empty\n1,2.5,foo,\n2,NA,bar,\n3,,baz,\n');
    expect(r.dataset.names).toEqual(['id', 'x', 'name']);
    expect(Number.isNaN(r.dataset.cols[1][1])).toBe(true);
    expect(Number.isNaN(r.dataset.cols[1][2])).toBe(true);
    expect(r.missingCells).toBe(2);
    expect(r.excludedColumns.map((e) => e.name)).toEqual(['empty']);
    expect(r.rows).toBe(3);
  });
  it('codes text columns with few values as categories 1, 2, ... in natural order', () => {
    const r = parseCsv('school,y\nSchool 10,1\nschool 2,2\nSchool 10,3\nNA,4\nAlpha,5\n');
    expect(r.dataset.categories).toEqual({ school: ['Alpha', 'school 2', 'School 10'] });
    expect(Array.from(r.dataset.cols[0])).toEqual([3, 2, 3, NaN, 1]);
    expect(r.missingCells).toBe(1);
    // Mixed numbers and text: the whole column is text.
    expect(parseCsv('g\n1\n2\nx\n').dataset.categories).toEqual({ g: ['1', '2', 'x'] });
    // Numeric data has no categories.
    expect(parseCsv('a\n1\n').dataset.categories).toBeUndefined();
  });
  it('leaves out free text (mostly different values)', () => {
    const rows = Array.from({ length: 80 }, (_, i) => `comment number ${i},${i}`).join('\n');
    const r = parseCsv(`note,v\n${rows}\n`);
    expect(r.dataset.names).toEqual(['v']);
    expect(r.excludedColumns[0]).toMatchObject({
      name: 'note',
      reason: expect.stringMatching(/text with many different values/),
    });
    // Many rows, few ids: kept (cluster ids).
    const ids = Array.from({ length: 400 }, (_, i) => `cl${i % 60},${i}`).join('\n');
    expect(parseCsv(`cluster,v\n${ids}\n`).dataset.categories?.cluster).toHaveLength(60);
  });
  it('supports decimal comma with semicolons and custom missing codes', () => {
    const r = parseCsv('a;b\n1,5;-99\n2,5;3\n', { missingTokens: ['-99'] });
    expect(Array.from(r.dataset.cols[0])).toEqual([1.5, 2.5]);
    expect(Number.isNaN(r.dataset.cols[1][0])).toBe(true);
  });
  it('de-duplicates and fills blank headers', () => {
    const r = parseCsv('x,x,\n1,2,3\n');
    expect(r.dataset.names).toEqual(['x', 'x_2', 'V3']);
  });
  it('rejects files without data rows', () => {
    expect(() => parseCsv('a,b\n')).toThrow(/header row and at least one data row/);
  });
});
