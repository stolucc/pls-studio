// The example-data pass-through (routes/exampleData.ts): only the Mplus User's Guide's example files, from
// statmodel.com only, never following a redirect, capped in size and time, rate limited, not stored or cached.
// statmodel.com is replaced by a fake fetch that records what the server asks for.

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { statmodelUrl } from '../src/routes/exampleData.ts';
import { startEnv, type TestEnv } from './helpers.ts';

type Reply =
  | {
      status?: number;
      body?: string | ReadableStream<Uint8Array>;
      headers?: Record<string, string>;
    }
  | 'hang'
  | 'fail';
let calls: { url: string; init: RequestInit }[] = [];
let reply: Reply = {};
const fakeFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  calls.push({ url: String(input), init });
  if (reply === 'fail') throw new TypeError('fetch failed');
  if (reply === 'hang') {
    return new Promise<Response>((_, reject) =>
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason)),
    );
  }
  return new Response(reply.body ?? 'y1 y2\n1 2\n', {
    status: reply.status ?? 200,
    headers: reply.headers,
  });
}) as typeof fetch;

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv(undefined, {
    exampleData: {
      fetch: fakeFetch,
      maxBytes: 1000,
      timeoutMs: 200,
      perMinute: 1000,
      maxConcurrent: 2,
    },
  });
});
afterAll(async () => {
  await env.close();
});
beforeEach(() => {
  calls = [];
  reply = {};
});

const get = (path: string) => request(env.app).get(`/api/example-data/statmodel/${path}`);

describe('example data from statmodel.com', () => {
  it('passes a guide example file through as plain text, uncached, without a session', async () => {
    reply = { body: '  0.5  1.25\n*  2\n', headers: { 'content-type': 'chemical/x-gamess-input' } };
    const res = await get('chap6/ex6.23.dat');
    expect(res.status).toBe(200);
    expect(res.text).toBe('  0.5  1.25\n*  2\n');
    expect(res.headers['content-type']).toBe('text/plain; charset=iso-8859-1');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://www.statmodel.com/usersguide/chap6/ex6.23.dat');
    expect(calls[0].init.redirect).toBe('manual');
    for (const p of ['chap3/ex3.8part1.inp', 'chap12/ex12.7real.dat', 'chap5/ex5.27b.inp'])
      expect((await get(p)).status, p).toBe(200);
  });

  it('asks for nothing but the guide’s example files (no other path, host, chapter, query or encoding trick)', async () => {
    for (const p of [
      'chap6/ex6.23.html',
      'chap6/ex6.23.DAT',
      'chap6/ex6.23.dat.html',
      'chap6/ex6.23',
      'chap7/ex6.23.dat',
      'chap6/ex6.23.dat%00',
      'chap6/..%2F..%2Fetc%2Fpasswd',
      'chap6/%2e%2e%2fex6.1.dat',
      'chap6%2Fex6.23.dat',
      'chap6/ex6.23.dat%3Fx=1',
      'chap6/ex6.23.dat%23x',
      'chap6/x%40evil.example%2Fex6.1.dat',
      'chap6/ex6.1.dat/extra',
      'chap6/ex6.1-2.dat',
      'chap123/ex123.1.dat',
      'ex6.1.dat',
      'chap6/ex6.1.dat%0d%0aHost:%20evil',
      '..%2F..%2Fchap6/ex6.1.dat',
    ]) {
      const res = await get(p);
      expect([400, 404], p).toContain(res.status);
    }
    expect(calls).toEqual([]);
    expect(statmodelUrl('chap6', 'ex6.1.dat')?.href).toBe(
      'https://www.statmodel.com/usersguide/chap6/ex6.1.dat',
    );
    expect(statmodelUrl('chap6/../chap6', 'ex6.1.dat')).toBeNull();
  });

  it('does not pass the query string or the caller’s headers on', async () => {
    const res = await get('chap6/ex6.1.dat?url=https://evil.example/&x=1')
      .set('Cookie', 'pls.sid=secret')
      .set('Authorization', 'Bearer t');
    expect(res.status).toBe(200);
    expect(calls[0].url).toBe('https://www.statmodel.com/usersguide/chap6/ex6.1.dat');
    const sent = new Headers(calls[0].init.headers);
    expect(sent.get('cookie')).toBeNull();
    expect(sent.get('authorization')).toBeNull();
  });

  it('does not follow redirects, and reports a missing file as 404 (statmodel.com answers 300, or 301 to a similar name)', async () => {
    reply = {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      body: 'secret',
    };
    const redirected = await get('chap6/ex6.1.dat');
    expect(redirected.status).toBe(404);
    expect(redirected.text).not.toContain('secret');
    expect(redirected.headers.location).toBeUndefined();
    expect(calls).toHaveLength(1);
    reply = { status: 300, body: '<html>Multiple Choices</html>' };
    const missing = await get('chap6/ex6.99.dat');
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain('Multiple Choices');
    reply = { status: 500, body: 'secret upstream error page' };
    const err = await get('chap6/ex6.1.dat');
    expect(err.status).toBe(502);
    expect(err.text).not.toContain('secret');
  });

  it('caps the size, whether declared or streamed', async () => {
    reply = { body: 'x'.repeat(1001) };
    expect((await get('chap6/ex6.1.dat')).status).toBe(502);
    reply = { body: 'x', headers: { 'content-length': '5000000' } };
    expect((await get('chap6/ex6.1.dat')).status).toBe(502);
    const chunk = new TextEncoder().encode('0123456789'.repeat(40));
    reply = {
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < 5; i++) c.enqueue(chunk);
          c.close();
        },
      }),
    };
    expect((await get('chap6/ex6.1.dat')).status).toBe(502);
    reply = { body: 'x'.repeat(1000) };
    expect((await get('chap6/ex6.1.dat')).status).toBe(200);
  });

  it('gives up after its timeout, and says so when statmodel.com cannot be reached', async () => {
    reply = 'hang';
    expect((await get('chap6/ex6.1.dat')).status).toBe(504);
    reply = 'fail';
    expect((await get('chap6/ex6.1.dat')).status).toBe(502);
  });

  it('caps the downloads in progress', async () => {
    reply = 'hang';
    const [a, b, c] = await Promise.all([
      get('chap6/ex6.1.dat'),
      get('chap6/ex6.2.dat'),
      new Promise((r) => setTimeout(r, 50)).then(() => get('chap6/ex6.3.dat')),
    ]);
    expect([a.status, b.status]).toEqual([504, 504]);
    expect(c.status).toBe(503);
  });
});

describe('rate limit', () => {
  it('answers 429 past the per-minute limit', async () => {
    const limited = await startEnv(undefined, { exampleData: { fetch: fakeFetch, perMinute: 3 } });
    try {
      const statuses = [];
      for (let i = 0; i < 4; i++)
        statuses.push(
          (await request(limited.app).get('/api/example-data/statmodel/chap6/ex6.1.dat')).status,
        );
      expect(statuses).toEqual([200, 200, 200, 429]);
    } finally {
      await limited.close();
    }
  });
});
