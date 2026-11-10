import { describe, expect, it } from 'vitest';
import { ANALYSIS_TYPES } from './registry';
import { matchesSearch } from './search';

describe('searching the Add analysis menu', () => {
  it('matches every word, in any order, ignoring case and accents', () => {
    expect(matchesSearch('', 'Anything')).toBe(true);
    expect(matchesSearch('anova', 'Repeated-measures ANOVA')).toBe(true);
    expect(matchesSearch('measures repeated', 'Repeated-measures ANOVA')).toBe(true);
    expect(matchesSearch('mediation', 'Médiation')).toBe(true);
    expect(matchesSearch('anova bayes', 'Repeated-measures ANOVA')).toBe(false);
  });
  it('looks at the description and the group too', () => {
    expect(matchesSearch('critical ratios', 'Parameter comparisons', 'pairwise z-tests of differences between estimates (critical ratios)')).toBe(true);
    expect(matchesSearch('cb-sem', 'Parameter comparisons', '', 'CB-SEM model')).toBe(true);
  });
  it('finds the analyses people look for by name', () => {
    const find = (q: string) => ANALYSIS_TYPES.filter((t) => !t.frozen).flatMap((t) => (t.entries ?? [{ title: t.title, sub: t.sub }]).filter((e) => matchesSearch(q, e.title, e.sub, t.group, t.title)).map((e) => e.title));
    expect(find('parcel')).toEqual(['Parcel allocation variability']);
    expect(find('pls cb compared')).toContain('PLS-SEM and CB-SEM compared');
    expect(find('zzzz')).toEqual([]);
  });
});
