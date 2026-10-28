import * as OTPAuth from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GoogleClient, GoogleIdentity } from '../src/routes/google.ts';
import { agent, ORIGIN, signedUp, startEnv, type TestEnv } from './helpers.ts';

/** Fake Google OIDC: hands back whatever identity the test queues. */
let nextIdentity: GoogleIdentity | null = null;
const fakeGoogle: GoogleClient = {
  authorizationUrl: (redirect, state) => `https://accounts.example/auth?state=${state}&redirect_uri=${encodeURIComponent(redirect)}`,
  async exchange(url, state) {
    if (url.searchParams.get('state') !== state) throw new Error('state mismatch');
    if (!nextIdentity) throw new Error('no identity');
    return nextIdentity;
  },
};

let env: TestEnv;
beforeAll(async () => { env = await startEnv(fakeGoogle); });
afterAll(async () => { await env.close(); });

describe('registration and login', () => {
  it('registers, rejects duplicates and weak passwords', async () => {
    const a = await agent(env);
    const r = await a.post('/api/auth/register', { email: 'Ann@Example.org', password: 'correct horse battery', name: 'Ann' });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ email: 'ann@example.org', display_name: 'Ann', totp_enabled: false });
    expect(r.body.user).not.toHaveProperty('password_hash');
    const b = await agent(env);
    expect((await b.post('/api/auth/register', { email: 'ann@example.org', password: 'correct horse battery', name: 'X' })).status).toBe(409);
    expect((await b.post('/api/auth/register', { email: 'bob@example.org', password: 'short', name: 'Bob' })).status).toBe(400);
  });

  it('requires a CSRF token and the app origin on state-changing requests', async () => {
    const a = await agent(env);
    const noToken = await a.raw.post('/api/auth/login').set('Origin', ORIGIN).send({ email: 'ann@example.org', password: 'x' });
    expect(noToken.status).toBe(403);
    const foreign = await a.post('/api/auth/login', { email: 'ann@example.org', password: 'x' }).set('Origin', 'https://evil.example');
    expect(foreign.status).toBe(403);
  });

  it('logs in, regenerates the session id and logs out', async () => {
    const a = await agent(env);
    const before = ([] as string[]).concat((await a.get('/api/auth/session')).headers['set-cookie'] ?? []).join(';');
    const r = await a.post('/api/auth/login', { email: 'ann@example.org', password: 'correct horse battery' });
    expect(r.status).toBe(200);
    const sid = (r.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('pls.sid='))!;
    expect(sid).toBeTruthy();
    expect(before).not.toContain(sid.split(';')[0]);
    expect(sid).toMatch(/HttpOnly/i);
    await a.refresh();
    expect((await a.get('/api/auth/session')).body.user.email).toBe('ann@example.org');
    await a.post('/api/auth/logout');
    expect((await a.get('/api/auth/session')).body.user).toBeNull();
  });

  it('gives generic errors and locks the account after repeated failures', async () => {
    await signedUp(env, 'lock@example.org');
    const a = await agent(env);
    const unknown = await a.post('/api/auth/login', { email: 'nobody@example.org', password: 'whatever whatever' });
    const wrong = await a.post('/api/auth/login', { email: 'lock@example.org', password: 'wrong password!!' });
    expect(unknown.body.error).toBe(wrong.body.error);
    for (let i = 0; i < 4; i++) await a.post('/api/auth/login', { email: 'lock@example.org', password: 'wrong password!!' });
    const locked = await a.post('/api/auth/login', { email: 'lock@example.org', password: 'correct horse battery' });
    expect(locked.status).toBe(429);
  });
});

describe('two-factor authentication', () => {
  it('enrols, requires the code at login, and stores the secret encrypted', async () => {
    const a = await signedUp(env, 'totp@example.org');
    const setup = await a.post('/api/auth/totp/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.qr).toMatch(/^data:image\/png;base64,/);
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.body.secret), digits: 6, period: 30 });
    expect((await a.post('/api/auth/totp/enable', { code: '000000' })).status).toBe(400);
    expect((await a.post('/api/auth/totp/enable', { code: totp.generate() })).status).toBe(200);

    const row = (await env.db.query("SELECT totp_secret FROM users WHERE email = 'totp@example.org'")).rows[0];
    expect(row.totp_secret.toString('latin1')).not.toContain(setup.body.secret);

    const b = await agent(env);
    const noCode = await b.post('/api/auth/login', { email: 'totp@example.org', password: 'correct horse battery' });
    expect(noCode.status).toBe(400);
    expect(noCode.body.code).toBe('totp_required');
    const ok = await b.post('/api/auth/login', { email: 'totp@example.org', password: 'correct horse battery', code: totp.generate() });
    expect(ok.status).toBe(200);

    await b.refresh();
    expect((await b.post('/api/auth/totp/disable', { password: 'nope nope nope' })).status).toBe(400);
    expect((await b.post('/api/auth/totp/disable', { password: 'correct horse battery' })).status).toBe(200);
  });
});

describe('Google sign-in', () => {
  async function googleRound(id: GoogleIdentity) {
    const a = await agent(env);
    const start = await a.get('/api/auth/google/start');
    expect(start.status).toBe(302);
    const state = new URL(start.headers.location).searchParams.get('state')!;
    nextIdentity = id;
    const cb = await a.get(`/api/auth/google/callback?code=abc&state=${state}`);
    return { a, location: cb.headers.location as string };
  }

  it('creates an account for a new verified Google user', async () => {
    const { a, location } = await googleRound({ sub: 'g-1', email: 'new@gmail.example', emailVerified: true, name: 'New User' });
    expect(location).toBe('/?auth=ok');
    expect((await a.get('/api/auth/session')).body.user).toMatchObject({ email: 'new@gmail.example', google_linked: true, has_password: false });
  });

  it('rejects unverified emails and a forged state', async () => {
    expect((await googleRound({ sub: 'g-2', email: 'x@gmail.example', emailVerified: false, name: 'X' })).location).toBe('/?auth=google-unverified');
    const a = await agent(env);
    await a.get('/api/auth/google/start');
    nextIdentity = { sub: 'g-3', email: 'y@gmail.example', emailVerified: true, name: 'Y' };
    const cb = await a.get('/api/auth/google/callback?code=abc&state=forged');
    expect(cb.headers.location).toBe('/?auth=google-failed');
  });

  it('links to an existing password account only after the password is confirmed', async () => {
    await signedUp(env, 'link@example.org');
    const { a, location } = await googleRound({ sub: 'g-4', email: 'link@example.org', emailVerified: true, name: 'Link' });
    expect(location).toBe('/?auth=google-link');
    expect((await a.get('/api/auth/session')).body.user).toBeNull();
    await a.refresh();
    expect((await a.post('/api/auth/google/link', { password: 'wrong password!!' })).status).toBe(400);
    const ok = await a.post('/api/auth/google/link', { password: 'correct horse battery' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.google_linked).toBe(true);
    // Next time Google signs straight in.
    expect((await googleRound({ sub: 'g-4', email: 'link@example.org', emailVerified: true, name: 'Link' })).location).toBe('/?auth=ok');
  });

  it('still requires TOTP after Google sign-in', async () => {
    const a = await signedUp(env, 'gtotp@example.org');
    const setup = await a.post('/api/auth/totp/setup');
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.body.secret), digits: 6, period: 30 });
    await a.post('/api/auth/totp/enable', { code: totp.generate() });
    await env.db.query("UPDATE users SET google_sub = 'g-5' WHERE email = 'gtotp@example.org'");
    const { a: b, location } = await googleRound({ sub: 'g-5', email: 'gtotp@example.org', emailVerified: true, name: 'G' });
    expect(location).toBe('/?auth=totp');
    expect((await b.get('/api/auth/session')).body).toMatchObject({ user: null, pendingTotp: true });
    await b.refresh();
    expect((await b.post('/api/auth/totp/verify', { code: '000000' })).status).toBe(400);
    expect((await b.post('/api/auth/totp/verify', { code: totp.generate() })).status).toBe(200);
  });
});
