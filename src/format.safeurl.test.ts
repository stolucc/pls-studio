import { describe, expect, it } from 'vitest';
import { safeUrl } from './format';

describe('safeUrl', () => {
  it('accepts web links only', () => {
    expect(safeUrl('https://cran.r-project.org/package=lavaan')).toBe(true);
    expect(safeUrl('HTTP://example.org')).toBe(true);
    for (const u of ['javascript:alert(1)', ' javascript:alert(1)', 'data:text/html,x', '//evil.example', '', null, undefined]) expect(safeUrl(u)).toBe(false);
  });
});
