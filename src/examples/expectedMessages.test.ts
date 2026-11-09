import { expect, it } from 'vitest';
import { expectedWhy, unexpectedMessages } from './expectedMessages';
import type { ExpectedMessage } from './packages';

const EXPECTED: ExpectedMessage[] = [
  { pattern: 'not positive definite', level: 'warning', why: 'the source’s own result' },
  { pattern: 'mixed signs', level: 'note', why: 'explains a blank cell' },
  { pattern: 'either level', why: 'any level' },
];

it('gives the reason of the first matching pattern, at the level it names', () => {
  expect(expectedWhy(EXPECTED, 'the matrix is not positive definite', 'warning')).toBe('the source’s own result');
  expect(expectedWhy(EXPECTED, 'the matrix is not positive definite', 'info')).toBeNull();
  expect(expectedWhy(EXPECTED, 'items correlate with mixed signs', 'info')).toBe('explains a blank cell');
  expect(expectedWhy(EXPECTED, 'items correlate with mixed signs', 'note')).toBe('explains a blank cell');
  expect(expectedWhy(EXPECTED, 'items correlate with mixed signs', 'warning')).toBeNull();
  expect(expectedWhy(EXPECTED, 'at either level', 'warning')).toBe('any level');
  expect(expectedWhy(EXPECTED, 'something else', 'warning')).toBeNull();
  expect(expectedWhy(undefined, 'not positive definite', 'warning')).toBeNull();
});

it('a malformed pattern matches nothing', () => {
  expect(expectedWhy([{ pattern: '(', why: 'x' }], '(', 'warning')).toBeNull();
});

it('lists the warnings and (distinct) notes a run raised that the example does not expect', () => {
  expect(unexpectedMessages(EXPECTED, { warnings: ['not positive definite', 'did not converge'], notes: ['mixed signs', 'a note', 'a note'] }))
    .toEqual({ warnings: ['did not converge'], notes: ['a note'] });
  expect(unexpectedMessages(undefined, { warnings: ['w'], notes: ['n'] })).toEqual({ warnings: ['w'], notes: ['n'] });
});
