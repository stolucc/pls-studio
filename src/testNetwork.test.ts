// The unit tests' network guard (src/testNetwork.ts, a setup file).

import { describe, expect, it } from 'vitest';
import { loadEvidence, resetEvidence } from './validation/useEvidence';
import { takeUnexpected } from './testNetwork';

describe('no network in unit tests', () => {
  it('refuses a request no test stubbed, and remembers it for the test’s failure', async () => {
    await expect(fetch('https://example.org/data.csv')).rejects.toThrow(
      /Unexpected network request in a unit test: https:\/\/example.org\/data.csv/,
    );
    expect(takeUnexpected()).toEqual(['https://example.org/data.csv']);
  });

  it('answers the evidence file with 404: the app loads no evidence, without a server', async () => {
    resetEvidence();
    expect(await loadEvidence()).toBeNull();
    expect(takeUnexpected()).toEqual([]);
    resetEvidence();
  });
});
