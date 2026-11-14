// vitest setup (the unit tests, without WEBR_TESTS): no test reaches the network by accident. A test that needs
// fetch stubs it (vi.stubGlobal, vi.spyOn); any other request fails the test that made it, even where the code
// under test swallows the error. The app's own evidence file (validation.json, src/validation/useEvidence.ts)
// answers 404, as a build without it: components that show evidence render, and their tests do not depend on what
// public/validation.json holds or on a server at localhost:3000 (happy-dom's page URL).

import { afterEach, expect } from 'vitest';

/** Requests no test stubbed, made during the current test. */
const unexpected: string[] = [];

/** For this file's own test: the unexpected requests so far, forgotten (so that the test does not fail for them). */
export const takeUnexpected = () => unexpected.splice(0);

const urlOf = (input: unknown): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return String((input as { url?: unknown })?.url ?? input);
};

if (!process.env.WEBR_TESTS) {
  globalThis.fetch = (async (input: unknown) => {
    const url = urlOf(input);
    if (/(^|\/)validation\.json$/.test(url.split('?')[0])) {
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    unexpected.push(url);
    throw new Error(`Unexpected network request in a unit test: ${url} (stub fetch in the test)`);
  }) as typeof fetch;

  afterEach(() => {
    const urls = takeUnexpected();
    expect(urls, 'unexpected network requests (stub fetch in the test)').toEqual([]);
  });
}
