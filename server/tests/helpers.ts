import type { Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { createApp, type AppDeps } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { createPool, type Db } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';
import type { GoogleClient } from '../src/routes/google.ts';
import { createMailer } from '../src/services/mailer.ts';
import { attachCollab, type Collab } from '../src/ws.ts';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres:///pls_studio_test';
export const ORIGIN = 'http://localhost:5175';

/** Fresh schema for a test file. */
export async function freshDb(): Promise<Db> {
  const db = createPool(TEST_DB);
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(db);
  return db;
}

export interface TestEnv {
  db: Db;
  deps: AppDeps;
  app: ReturnType<typeof createApp>;
  server: Server;
  collab: Collab;
  port: number;
  close(): Promise<void>;
}

export async function startEnv(google?: GoogleClient, more: Partial<AppDeps> = {}): Promise<TestEnv> {
  const db = await freshDb();
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: TEST_DB, APP_ORIGIN: ORIGIN });
  const deps: AppDeps = { config, db, mailer: createMailer(undefined, config.MAIL_FROM, false), google, ...more };
  const app = createApp(deps);
  const server = createServer(app);
  const collab = attachCollab(server, db, (app as unknown as { sessionMiddleware: Parameters<typeof attachCollab>[2] }).sessionMiddleware, ORIGIN);
  deps.onMembershipChange = (p, u) => { void collab.membershipChanged(p, u); };
  await new Promise<void>((r) => server.listen(0, r));
  return {
    db, deps, app, server, collab, port: (server.address() as AddressInfo).port,
    async close() { await collab.close(); await new Promise((r) => server.close(r)); await db.end(); },
  };
}

/** A cookie-keeping client that sends the CSRF token and Origin like the browser app. */
export async function agent(env: TestEnv) {
  const a = request.agent(env.app);
  const s = await a.get('/api/auth/session');
  let csrf: string = s.body.csrfToken;
  const refresh = async () => { csrf = (await a.get('/api/auth/session')).body.csrfToken; };
  const send = (method: 'post' | 'put' | 'patch' | 'delete', url: string) => a[method](url).set('Origin', ORIGIN).set('X-CSRF-Token', csrf);
  return {
    raw: a,
    get: (url: string) => a.get(url),
    post: (url: string, body?: object) => send('post', url).send(body ?? {}),
    put: (url: string, body?: string | object) => typeof body === 'string' ? send('put', url).set('Content-Type', 'application/json').send(body) : send('put', url).send(body ?? {}),
    patch: (url: string, body?: object) => send('patch', url).send(body ?? {}),
    del: (url: string) => send('delete', url),
    refresh,
    cookie: () => (a as unknown as { jar: { getCookies: (o: object) => { name: string; value: string }[] } }).jar.getCookies({ domain: '127.0.0.1', path: '/', secure: false, script: false }),
  };
}

export type Agent = Awaited<ReturnType<typeof agent>>;

/** A registered account; verified (as any account that can share projects must be) unless `verify` is false. */
export async function signedUp(env: TestEnv, email: string, name = email.split('@')[0], verify = true): Promise<Agent> {
  const a = await agent(env);
  const r = await a.post('/api/auth/register', { email, password: 'correct horse battery', name });
  if (r.status !== 201) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  await a.refresh();
  if (verify) {
    const v = await a.post('/api/auth/verify-email', { token: lastToken(env, 'verify') });
    if (v.status !== 200) throw new Error(`verify failed: ${v.status} ${JSON.stringify(v.body)}`);
  }
  return a;
}

/** The token in the last email the server sent (`?verify=` or `?reset=` link). */
export function lastToken(env: TestEnv, kind: 'verify' | 'reset' | 'invite'): string {
  const mail = env.deps.mailer.outbox.at(-1)!;
  const m = new RegExp(`[?&#]${kind}=([^\\s&]+)`).exec(mail.text);
  if (!m) throw new Error(`no ${kind} link in the last email: ${mail.subject}`);
  return decodeURIComponent(m[1]);
}
