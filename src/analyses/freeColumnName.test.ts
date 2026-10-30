import { expect, it } from 'vitest';
import { freeColumnName } from './common';

it('saves classes under a column name not yet in use', () => {
  expect(freeColumnName(['a', 'b'], 'rebus_2')).toBe('rebus_2');
  expect(freeColumnName(['rebus_2', 'rebus_2_2'], 'rebus_2')).toBe('rebus_2_3');
});
