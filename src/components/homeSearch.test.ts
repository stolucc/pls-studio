import { describe, expect, it } from 'vitest';
import { matchesQuery } from './HomeScreen';

describe('home-screen search', () => {
  it('matches every word of the query, case-insensitively, across name and tags', () => {
    expect(matchesQuery('', ['anything'])).toBe(true);
    expect(matchesQuery('   ', [])).toBe(true);
    expect(matchesQuery('mimic', ['Social participation (MIMIC model)', 'CB-SEM'])).toBe(true);
    expect(
      matchesQuery('cb-sem mediation', [
        'Industrialisation and political democracy',
        'CB-SEM',
        'Mediation',
      ]),
    ).toBe(true);
    expect(
      matchesQuery('cb-sem moderation', [
        'Industrialisation and political democracy',
        'CB-SEM',
        'Mediation',
      ]),
    ).toBe(false);
    expect(matchesQuery('Lavaan', [undefined, 'lavaan, ?cfa'])).toBe(true);
    expect(matchesQuery('nothing', ['a', 'b'])).toBe(false);
  });
});
