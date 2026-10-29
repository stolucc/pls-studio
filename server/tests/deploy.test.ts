// Production-serving behaviour the deploy scripts rely on: the health probe and
// the cache headers on the built client.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import type { Db } from '../src/db.ts';
import { createMailer } from '../src/services/mailer.ts';
import { freshDb, ORIGIN, TEST_DB } from './helpers.ts';

let db: Db;
let staticDir: string;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  staticDir = mkdtempSync(join(tmpdir(), 'pls-static-'));
  mkdirSync(join(staticDir, 'assets'));
  mkdirSync(join(staticDir, 'webr'));
  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>PLS Studio</title>');
  writeFileSync(join(staticDir, 'assets', 'index-abc123.js'), 'export {};');
  writeFileSync(join(staticDir, 'webr', 'R.wasm'), Buffer.from([0, 97, 115, 109]));
  writeFileSync(join(staticDir, 'webr', 'webr-worker.js'), 'self.onmessage = () => {};');
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DB, APP_ORIGIN: ORIGIN, STATIC_DIR: staticDir });
  app = createApp({ config, db, mailer: createMailer(undefined, config.MAIL_FROM, false) });
});

afterAll(async () => {
  await db.end();
  rmSync(staticDir, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('reports ok without creating a session', async () => {
    const before = (await db.query('SELECT count(*)::int AS n FROM session')).rows[0].n;
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['set-cookie']).toBeUndefined();
    const after = (await db.query('SELECT count(*)::int AS n FROM session')).rows[0].n;
    expect(after).toBe(before);
  });

  it('fails when the database is unreachable', async () => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DB, APP_ORIGIN: ORIGIN });
    const broken = { query: async () => { throw new Error('connection refused'); } } as unknown as Db;
    const res = await request(createApp({ config, db: broken, mailer: createMailer(undefined, config.MAIL_FROM, false) })).get('/api/health');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal error.' });
  });
});

describe('static client caching', () => {
  it('revalidates index.html on every load', async () => {
    for (const url of ['/', '/index.html']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('caches content-hashed bundles for good', async () => {
    const res = await request(app).get('/assets/index-abc123.js');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('caches the R runtime for an hour and keeps cross-origin isolation', async () => {
    const res = await request(app).get('/webr/R.wasm');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.headers['cross-origin-embedder-policy']).toBe('require-corp');
  });
});

describe('webR worker content security policy', () => {
  const scriptSrc = (csp: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));

  it('lets the R worker eval (Emscripten builds shared-library EM_ASM code with it)', async () => {
    const res = await request(app).get('/webr/webr-worker.js');
    expect(res.status).toBe(200);
    expect(scriptSrc(res.headers['content-security-policy'])).toBe("script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'");
    expect(res.headers['content-security-policy']).toContain("object-src 'none'");
    expect(res.headers['cross-origin-embedder-policy']).toBe('require-corp');
    // Revalidated on every load, so a policy change reaches browsers at once.
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('keeps eval blocked everywhere else, including the page', async () => {
    for (const url of ['/', '/webr/R.wasm', '/assets/index-abc123.js', '/api/health']) {
      const csp = (await request(app).get(url)).headers['content-security-policy'] as string;
      expect(csp, url).not.toContain("'unsafe-eval'");
    }
  });
});
