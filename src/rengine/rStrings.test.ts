// R's JSON writes a one-element vector as a scalar: a single warning arrives
// as a string. It must still be one warning (not 73 characters of one).

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model/project';
import { useStore } from '../store';
import { rStrings } from './bridge';
import { parseCpaOutput } from './cpa';

const one = 'lavaan WARNING: the optimizer warns that a solution has NOT been found!';

describe('one warning from R', () => {
  it('is a list of one', () => {
    expect(rStrings(one)).toEqual([one]);
    expect(rStrings([one, 'b'])).toEqual([one, 'b']);
    expect(rStrings(null)).toEqual([]);
    expect(rStrings([1, 'x'])).toEqual(['x']);
    expect(parseCpaOutput({ warnings: one }).warnings).toEqual([one]);
  });

  it('reaches Messages even if a result still carries it as a string', () => {
    useStore.setState({ messages: [], settings: DEFAULT_SETTINGS });
    useStore
      .getState()
      .setResults(
        { cb: { warnings: one, engine: { package: 'lavaan', version: '0.7-3' } } as never },
        'k',
      );
    expect(useStore.getState().messages.map((m) => m.text)).toEqual([one]);
  });
});
