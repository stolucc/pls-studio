import { describe, expect, it } from 'vitest';
import {
  constraintText,
  hypothesisErrors,
  hypothesisLabels,
  parseHypotheses,
  usesAbs,
} from './hypothesis';

const printed = (text: string) =>
  parseHypotheses(text).map((h) => h.constraints.map(constraintText));

describe('informative hypotheses: the grammar', () => {
  it('splits chains into neighbouring comparisons and & or ; into constraints, one hypothesis per line', () => {
    expect(printed('b1 > b2 > 0')).toEqual([['b1 > b2', 'b2 > 0']]);
    expect(printed('a = b = c & d < 0\n\n  a > b; c == 0  ')).toEqual([
      ['a = b', 'b = c', 'd < 0'],
      ['a > b', 'c = 0'],
    ]);
    expect(parseHypotheses('a > b\nc > 0').map((h) => h.text)).toEqual(['a > b', 'c > 0']);
  });

  it('reads linear combinations, numbers and abs(label), and prints them for restriktor and bain', () => {
    expect(printed('2*b1 - b2 > .1')).toEqual([['2*b1 - b2 > .1']]);
    expect(printed('-b1 + b2*0.5 < -1')).toEqual([['-b1 + 0.5*b2 < -1']]);
    expect(printed('b1 - - b2 > 0')).toEqual([['b1 + b2 > 0']]);
    expect(printed('abs(b1) > abs( b2 )')).toEqual([['abs(b1) > abs(b2)']]);
    const [h] = parseHypotheses('abs(b1) > 2*b2 & b3 = 0');
    expect(hypothesisLabels(h)).toEqual(['b1', 'b2', 'b3']);
    expect(usesAbs(h)).toBe(true);
    expect(usesAbs(parseHypotheses('b1 > b2')[0])).toBe(false);
  });

  it('refuses anything else with a message naming the hypothesis', () => {
    const err = (t: string) => {
      try {
        parseHypotheses(t);
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(err('')).toMatch(/at least one hypothesis/);
    expect(err('b1')).toMatch(/compares nothing/);
    expect(err('1 > 0')).toMatch(/numbers only/);
    expect(err('b1 >= b2')).toMatch(/≥/);
    expect(err('b1*b2 > 0')).toMatch(/linear/);
    expect(err('exp(b1) > 0')).toMatch(/only abs\(label\)/);
    expect(err('abs(b1 + b2) > 0')).toMatch(/one label/);
    expect(err('(b1 + b2) > 0')).toMatch(/Unexpected|Parentheses/);
    expect(err('b1 > b2 &')).toMatch(/one is missing/);
    expect(err('b1 > "x"); system("id")')).toMatch(/Unexpected “"”/);
    expect(err('b1 > 1e5')).toMatch(/needs an operator/);
    expect(err('a > b\nb1 2 > 0')).toMatch(/^Hypothesis 2/);
    expect(err(Array.from({ length: 11 }, () => 'a > b').join('\n'))).toMatch(/At most 10/);
    expect(err(`a > ${'b + '.repeat(200)}c`)).toMatch(/too long/);
  });

  it('checks the labels against the model, and abs() against bain', () => {
    const labels = new Set(['b1', 'b2']);
    expect(hypothesisErrors('b1 > b2 > 0', labels, true)).toEqual([]);
    expect(hypothesisErrors('b1 > b3', labels, false)[0]).toMatch(/“b3” is not a parameter label/);
    expect(hypothesisErrors('abs(b1) > abs(b2)', labels, false)).toEqual([]);
    expect(hypothesisErrors('abs(b1) > abs(b2)', labels, true)[0]).toMatch(/bain has no abs/);
    expect(hypothesisErrors('b1 > if', new Set(['b1', 'if']), false)[0]).toMatch(/reserved word/);
    expect(hypothesisErrors('b1 >', labels, false)[0]).toMatch(/Hypothesis 1/);
  });
});
