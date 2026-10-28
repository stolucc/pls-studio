import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, parseCsvRows } from './dataset';

describe('parseCsv', () => {
  it('parses quoted fields, CRLF and BOM', () => {
    const rows = parseCsvRows('﻿"a","b, c"\r\n1,"he said ""hi"""\r\n', ',');
    expect(rows).toEqual([['a', 'b, c'], ['1', 'he said "hi"']]);
  });
  it('detects delimiters', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('"x;y",b,c\n')).toBe(',');
  });
  it('converts missing tokens to NaN and excludes non-numeric columns', () => {
    const r = parseCsv('id,x,name,empty\n1,2.5,foo,\n2,NA,bar,\n3,,baz,\n');
    expect(r.dataset.names).toEqual(['id', 'x']);
    expect(Number.isNaN(r.dataset.cols[1][1])).toBe(true);
    expect(Number.isNaN(r.dataset.cols[1][2])).toBe(true);
    expect(r.missingCells).toBe(2);
    expect(r.excludedColumns.map((e) => e.name)).toEqual(['name', 'empty']);
    expect(r.rows).toBe(3);
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
