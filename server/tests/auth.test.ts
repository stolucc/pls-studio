import * as OTPAuth from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GoogleClient, GoogleIdentity } from '../src/routes/google.ts';
import { agent, lastToken, ORIGIN, signedUp, startEnv, type TestEnv } from './helpers.ts';

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
    expect(r.body.user.email_verified).toBe(false);
    await a.refresh();
    expect((await a.post('/api/auth/verify-email', { token: lastToken(env, 'verify') })).status).toBe(200);
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

describe('email verification', () => {
  it('sends a link; until it is used the account cannot create or join projects', async () => {
    const a = await signedUp(env, 'fresh@example.org', 'Fresh', false);
    const mail = env.deps.mailer.outbox.at(-1)!;
    expect(mail.to).toBe('fresh@example.org');
    expect(mail.subject).toContain('Verify');
    const token = lastToken(env, 'verify');
    const stored = (await env.db.query("SELECT token_hash FROM auth_tokens WHERE kind = 'verify' ORDER BY created_at DESC LIMIT 1")).rows[0].token_hash as Buffer;
    expect(stored.toString('latin1')).not.toContain(token);
    const refused = await a.post('/api/projects', { name: 'Mine' });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('unverified');
    expect((await a.post('/api/auth/verify-email', { token })).status).toBe(200);
    expect((await a.get('/api/auth/session')).body.user.email_verified).toBe(true);
    expect((await a.post('/api/projects', { name: 'Mine' })).status).toBe(201);
    // single use
    expect((await a.post('/api/auth/verify-email', { token })).status).toBe(400);
    expect((await a.post('/api/auth/verify-email/resend')).status).toBe(409);
  });

  it('resend replaces the earlier link', async () => {
    const a = await signedUp(env, 'again@example.org', 'Again', false);
    const first = lastToken(env, 'verify');
    expect((await a.post('/api/auth/verify-email/resend')).status).toBe(200);
    const second = lastToken(env, 'verify');
    expect(second).not.toBe(first);
    expect((await a.post('/api/auth/verify-email', { token: first })).status).toBe(400);
    expect((await a.post('/api/auth/verify-email', { token: second })).status).toBe(200);
  });

  it('an unverified account does not reserve the address: the next registration replaces it', async () => {
    const squatter = await signedUp(env, 'victim@example.org', 'Squatter', false);
    const owner = await agent(env);
    const r = await owner.post('/api/auth/register', { email: 'victim@example.org', password: 'the real owners pw', name: 'Owner' });
    expect(r.status).toBe(201);
    expect(r.body.user.display_name).toBe('Owner');
    expect((await squatter.get('/api/auth/session')).body.user).toBeNull(); // its session ended
    const login = await (await agent(env)).post('/api/auth/login', { email: 'victim@example.org', password: 'correct horse battery' });
    expect(login.status).toBe(400); // the squatter's password is gone
    expect((await (await agent(env)).post('/api/auth/login', { email: 'victim@example.org', password: 'the real owners pw' })).status).toBe(200);
  });

  it('a verified account keeps its address', async () => {
    await signedUp(env, 'keeper@example.org');
    expect((await (await agent(env)).post('/api/auth/register', { email: 'keeper@example.org', password: 'something else 123', name: 'X' })).status).toBe(409);
  });
});

describe('password reset', () => {
  it('emails a link only for existing accounts, without saying so', async () => {
    const a = await agent(env);
    const before = env.deps.mailer.outbox.length;
    expect((await a.post('/api/auth/password/forgot', { email: 'nobody@example.org' })).status).toBe(200);
    expect(env.deps.mailer.outbox.length).toBe(before);
    await signedUp(env, 'forgot@example.org');
    expect((await a.post('/api/auth/password/forgot', { email: 'Forgot@Example.org' })).status).toBe(200);
    expect(env.deps.mailer.outbox.at(-1)!.to).toBe('forgot@example.org');
    expect(env.deps.mailer.outbox.at(-1)!.subject).toContain('Reset');
  });

  it('sets the new password once, clears the lockout and ends every session', async () => {
    const a = await signedUp(env, 'reset@example.org');
    expect((await a.post('/api/projects', { name: 'P' })).status).toBe(201);
    await env.db.query("UPDATE users SET failed_logins = 4, locked_until = now() + interval '10 minutes' WHERE email = 'reset@example.org'");
    await (await agent(env)).post('/api/auth/password/forgot', { email: 'reset@example.org' });
    const token = lastToken(env, 'reset');
    const b = await agent(env);
    expect((await b.post('/api/auth/password/reset', { token, password: 'short' })).status).toBe(400);
    expect((await b.post('/api/auth/password/reset', { token, password: 'brand new password 1' })).status).toBe(200);
    expect((await b.post('/api/auth/password/reset', { token, password: 'brand new password 2' })).status).toBe(400);
    expect((await a.get('/api/auth/session')).body.user).toBeNull();
    expect((await (await agent(env)).post('/api/auth/login', { email: 'reset@example.org', password: 'correct horse battery' })).status).toBe(400);
    expect((await (await agent(env)).post('/api/auth/login', { email: 'reset@example.org', password: 'brand new password 1' })).status).toBe(200);
  });

  it('refuses an expired link and keeps the second factor', async () => {
    const a = await signedUp(env, 'totpreset@example.org');
    const setup = await a.post('/api/auth/totp/setup');
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(setup.body.secret), digits: 6, period: 30 });
    expect((await a.post('/api/auth/totp/enable', { code: totp.generate() })).status).toBe(200);
    await (await agent(env)).post('/api/auth/password/forgot', { email: 'totpreset@example.org' });
    const expired = lastToken(env, 'reset');
    await env.db.query("UPDATE auth_tokens SET expires_at = now() - interval '1 minute' WHERE kind = 'reset' AND used_at IS NULL");
    expect((await (await agent(env)).post('/api/auth/password/reset', { token: expired, password: 'brand new password 1' })).status).toBe(400);
    await (await agent(env)).post('/api/auth/password/forgot', { email: 'totpreset@example.org' });
    expect((await (await agent(env)).post('/api/auth/password/reset', { token: lastToken(env, 'reset'), password: 'brand new password 1' })).status).toBe(200);
    const login = await (await agent(env)).post('/api/auth/login', { email: 'totpreset@example.org', password: 'brand new password 1' });
    expect(login.status).toBe(400);
    expect(login.body.code).toBe('totp_required');
  });

  it('lets a Google-only account set a password, which then also works', async () => {
    nextIdentity = { sub: 'g-pw', email: 'gonly@example.org', emailVerified: true, name: 'G Only' };
    const a = await agent(env);
    const s = await a.get('/api/auth/google/start');
    const st = new URL(s.headers.location).searchParams.get('state')!;
    await a.get(`/api/auth/google/callback?code=abc&state=${st}`);
    expect((await a.get('/api/auth/session')).body.user).toMatchObject({ has_password: false, email_verified: true });
    await (await agent(env)).post('/api/auth/password/forgot', { email: 'gonly@example.org' });
    expect(env.deps.mailer.outbox.at(-1)!.subject).toContain('Set');
    expect((await (await agent(env)).post('/api/auth/password/reset', { token: lastToken(env, 'reset'), password: 'a password at last 1' })).status).toBe(200);
    const login = await (await agent(env)).post('/api/auth/login', { email: 'gonly@example.org', password: 'a password at last 1' });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({ has_password: true, google_linked: true });
  });

  it('changes the password of a signed-in account and ends its other sessions', async () => {
    const a = await signedUp(env, 'change@example.org');
    const other = await (await agent(env)).post('/api/auth/login', { email: 'change@example.org', password: 'correct horse battery' });
    expect(other.status).toBe(200);
    expect((await a.post('/api/auth/password/change', { current: 'wrong password!!', password: 'new password number 1' })).status).toBe(400);
    expect((await a.post('/api/auth/password/change', { current: 'correct horse battery', password: 'new password number 1' })).status).toBe(200);
    expect((await a.get('/api/auth/session')).body.user).not.toBeNull();
    expect((await (await agent(env)).post('/api/auth/login', { email: 'change@example.org', password: 'new password number 1' })).status).toBe(200);
  });
});

describe('Google sign-in and unverified accounts', () => {
  it('claims an unverified password account with the same address instead of asking for its password', async () => {
    const squatter = await signedUp(env, 'claimed@example.org', 'Squatter', false);
    const a = await agent(env);
    const s = await a.get('/api/auth/google/start');
    const st = new URL(s.headers.location).searchParams.get('state')!;
    nextIdentity = { sub: 'g-claim', email: 'claimed@example.org', emailVerified: true, name: 'Real Owner' };
    const cb = await a.get(`/api/auth/google/callback?code=abc&state=${st}`);
    expect(cb.headers.location).toBe('/?auth=ok');
    expect((await a.get('/api/auth/session')).body.user).toMatchObject({ display_name: 'Real Owner', google_linked: true, has_password: false, email_verified: true });
    expect((await squatter.get('/api/auth/session')).body.user).toBeNull();
    expect((await (await agent(env)).post('/api/auth/login', { email: 'claimed@example.org', password: 'correct horse battery' })).status).toBe(400);
  });
});
