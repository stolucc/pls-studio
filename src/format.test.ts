import { describe, expect, it } from 'vitest';
import { csvCell, fmt, fmtP, noLeadingZero, pIs, safeFileName, safeUrl, stars } from './format';

describe('number formatting', () => {
  it('formats numbers to three decimals by default, dashes for missing, ∞ for infinite', () => {
    expect(fmt(0.12345)).toBe('0.123');
    expect(fmt(2, 1)).toBe('2.0');
    expect(fmt(null)).toBe('—');
    expect(fmt(undefined)).toBe('—');
    expect(fmt(NaN)).toBe('—');
    expect(fmt(Infinity)).toBe('∞');
  });
  it('writes p values and stars at the conventional thresholds', () => {
    expect(fmtP(0.0004)).toBe('<0.001');
    expect(fmtP(0.001)).toBe('0.001');
    expect(fmtP(0.04567)).toBe('0.046');
    expect(fmtP(NaN)).toBe('—');
    expect(fmtP(undefined)).toBe('—');
    expect(pIs(0.0004)).toBe('< 0.001');
    expect(pIs(0.0372)).toBe('= 0.037');
    expect(noLeadingZero('0.450')).toBe('.450');
    expect(noLeadingZero('-0.12')).toBe('-.12');
    expect(noLeadingZero('10.5')).toBe('10.5');
    expect(stars(0.0009)).toBe('***');
    expect(stars(0.001)).toBe('**');
    expect(stars(0.0099)).toBe('**');
    expect(stars(0.01)).toBe('*');
    expect(stars(0.0499)).toBe('*');
    expect(stars(0.05)).toBe('');
  });
});

describe('CSV cells', () => {
  it('quotes commas, quotes and line breaks, and doubles inner quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(1.5)).toBe('1.5');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });
  it('defuses spreadsheet formulas (=, +, -, @, tab, CR) but leaves negative numbers alone', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('-1.5')).toBe('-1.5');
    expect(csvCell(-2)).toBe('-2');
    expect(csvCell('\tx')).toBe("'\tx");
  });
});

describe('file names and links', () => {
  it('makes a safe file name, with a fallback', () => {
    expect(safeFileName('My project: v2 / final?')).toBe('My-project-v2-final');
    expect(safeFileName('  ')).toBe('model');
    expect(safeFileName('a  b')).toBe('a-b');
  });
  it('accepts http(s) links only', () => {
    expect(safeUrl('https://x.example/p')).toBe(true);
    expect(safeUrl('HTTP://x.example')).toBe(true);
    expect(safeUrl('javascript:alert(1)')).toBe(false);
    expect(safeUrl('ftp://x')).toBe(false);
    expect(safeUrl(null)).toBe(false);
    expect(safeUrl(undefined)).toBe(false);
  });
});
