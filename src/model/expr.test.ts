import { describe, expect, it } from 'vitest';
import { exprToR, nameError, namesIn, parseConstraint, parseExpr } from './expr';

describe('parameter expressions', () => {
  it('parse arithmetic over labels with the usual precedence', () => {
    expect(exprToR(parseExpr('a*b + c'))).toBe('((a * b) + c)');
    expect(exprToR(parseExpr('-a^2 / (b - 1.5e-1)'))).toBe('((-(a ^ 2)) / (b - 0.15))');
    expect(namesIn(parseExpr('a1*b_2 + a1'))).toEqual(['a1', 'b_2']);
  });

  it('refuse anything but arithmetic (the text goes into R code)', () => {
    for (const bad of ['system("x")', 'a; b', 'a <- 1', '"a"', 'a, b', 'exp(a)', 'a b', '', '(a', 'a)', 'a $ b', '`a`', 'a[1]']) {
      expect(() => parseExpr(bad), bad).toThrow();
    }
  });

  it('parse a hypothesis a == b', () => {
    const c = parseConstraint(' a == b*2 ');
    expect([exprToR(c.left), exprToR(c.right)]).toEqual(['a', '(b * 2)']);
    expect(() => parseConstraint('a = b')).toThrow(/expression == expression/);
    expect(() => parseConstraint('a == b == c')).toThrow();
  });

  it('check names', () => {
    expect(nameError('a1')).toBeNull();
    expect(nameError('1a')).toMatch(/not a valid name/);
    expect(nameError('TRUE')).toMatch(/reserved/);
    expect(nameError('a.b')).toMatch(/not a valid name/);
  });
});
