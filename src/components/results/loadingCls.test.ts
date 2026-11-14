// The colour of a reflective loading: by its size, except that a loading whose sign differs from most
// loadings of its construct is bad (often a reverse-coded item); a construct with all negative loadings is
// only reflected, so its loadings are judged by size.
import { describe, expect, it } from 'vitest';
import { loadingCls, mostlyNegative } from './Table';

describe('loadingCls', () => {
  it('judges positive loadings by size (Hair et al.: .708, .40)', () => {
    expect(loadingCls(0.85)).toBe('good');
    expect(loadingCls(0.708)).toBe('good');
    expect(loadingCls(0.6)).toBe('warn');
    expect(loadingCls(0.4)).toBe('warn');
    expect(loadingCls(0.3)).toBe('bad');
  });

  it('marks a negative loading in a mostly positive construct as bad, however large', () => {
    expect(loadingCls(-0.834)).toBe('bad');
    expect(loadingCls(-0.834, false)).toBe('bad');
  });

  it('judges a mostly negative construct by size, and marks its positive loading as bad', () => {
    expect(loadingCls(-0.834, true)).toBe('good');
    expect(loadingCls(-0.5, true)).toBe('warn');
    expect(loadingCls(0.8, true)).toBe('bad');
    expect(loadingCls(0, true)).toBe('bad');
  });
});

describe('mostlyNegative', () => {
  it('needs more negative than positive loadings (a tie is positive)', () => {
    expect(mostlyNegative([-0.8, -0.7, 0.6])).toBe(true);
    expect(mostlyNegative([-0.8, 0.7])).toBe(false);
    expect(mostlyNegative([0.8, 0.7, -0.6])).toBe(false);
    expect(mostlyNegative([])).toBe(false);
  });
});
