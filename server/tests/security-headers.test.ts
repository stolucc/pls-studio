import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agent, startEnv, type TestEnv } from './helpers.ts';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env.close();
});

describe('content security policy', () => {
  it('allows WebAssembly compilation for the in-browser R runtime, but not eval', async () => {
    const res = await (await agent(env)).get('/api/auth/session');
    const csp = res.headers['content-security-policy'] as string;
    const scriptSrc = csp
      .split(';')
      .map((d) => d.trim())
      .find((d) => d.startsWith('script-src'))!;
    expect(scriptSrc).toBe("script-src 'self' 'wasm-unsafe-eval'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toMatch(/worker-src 'self' blob:/);
  });
});

describe('cross-origin isolation', () => {
  it('sends COOP and COEP so the R runtime can use SharedArrayBuffer', async () => {
    const res = await (await agent(env)).get('/api/auth/session');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-embedder-policy']).toBe('require-corp');
  });
});

describe('rate limiting', () => {
  it('covers the unauthenticated health probe too', async () => {
    const res = await (await agent(env)).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['ratelimit']).toBeDefined();
  });
});
