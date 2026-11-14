// Accounts: registration, password login with lockout, TOTP, Google linking.

import argon2 from 'argon2';
import * as OTPAuth from 'otpauth';
import { hashToken, newToken, open, seal } from '../crypto.ts';
import { tx, type Db } from '../db.ts';

export interface User {
  id: string;
  email: string;
  display_name: string;
  totp_enabled: boolean;
  has_password: boolean;
  google_linked: boolean;
  email_verified: boolean;
}

const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
// Precomputed hash so that unknown emails cost the same time as wrong passwords.
const DUMMY_HASH = argon2.hash('dummy-password-for-timing', ARGON);

export const PASSWORD_MIN = 12;

export function validatePassword(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > 256) return 'Password is too long.';
  if (new Set(pw).size < 5) return 'Password is too repetitive.';
  return null;
}

const toUser = (r: Record<string, unknown>): User => ({
  id: r.id as string,
  email: r.email as string,
  display_name: r.display_name as string,
  totp_enabled: r.totp_enabled as boolean,
  has_password: r.password_hash !== null,
  google_linked: r.google_sub !== null,
  email_verified: r.email_verified === true,
});

export async function getUser(db: Db, id: string): Promise<User | null> {
  const r = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return r.rows[0] ? toUser(r.rows[0]) : null;
}

export async function findByEmail(db: Db, email: string): Promise<User | null> {
  const r = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return r.rows[0] ? toUser(r.rows[0]) : null;
}

export class AuthError extends Error {
  readonly code: 'invalid' | 'locked' | 'totp_required' | 'exists' | 'weak' | 'token';
  constructor(message: string, code: AuthError['code']) {
    super(message);
    this.code = code;
  }
}

/**
 * Register. An address any account holds is taken, verified or not: replacing
 * an unverified account here would let anyone take over the account of a
 * person who registered but has not yet clicked the link (and the link mailed
 * for the new password would verify it for the newcomer). The route mails a
 * password link instead: whoever controls the mailbox gets the account
 * (resetPassword), which also removes a squatter's second factor.
 */
export async function register(
  db: Db,
  email: string,
  password: string,
  displayName: string,
): Promise<User> {
  const weak = validatePassword(password);
  if (weak) throw new AuthError(weak, 'weak');
  const hash = await argon2.hash(password, ARGON);
  try {
    const r = await db.query(
      'INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING *',
      [email, displayName, hash],
    );
    return toUser(r.rows[0]);
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new AuthError('An account with this email already exists.', 'exists');
    throw err;
  }
}

/**
 * Password (and TOTP) login. Errors are deliberately generic; after
 * MAX_FAILED consecutive failures the account locks for LOCK_MINUTES.
 */
export async function login(
  db: Db,
  totpKey: Buffer,
  email: string,
  password: string,
  totpCode?: string,
): Promise<User> {
  const r = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const row = r.rows[0];
  if (!row || !row.password_hash) {
    await argon2.verify(await DUMMY_HASH, password).catch(() => false);
    throw new AuthError('Incorrect email or password.', 'invalid');
  }
  if (row.locked_until && new Date(row.locked_until) > new Date()) {
    throw new AuthError('Too many failed attempts. Try again later.', 'locked');
  }
  const ok = await argon2.verify(row.password_hash, password);
  if (!ok) {
    await recordFailure(db, row.id);
    throw new AuthError('Incorrect email or password.', 'invalid');
  }
  if (row.totp_enabled) {
    if (!totpCode)
      throw new AuthError('Enter the code from your authenticator app.', 'totp_required');
    if (!(await useTotp(db, totpKey, row.id, row.totp_secret, totpCode))) {
      await recordFailure(db, row.id);
      throw new AuthError('Incorrect authentication code.', 'invalid');
    }
  }
  await clearFailures(db, row.id);
  return toUser(row);
}

/**
 * Count a failed attempt; the MAX_FAILED-th locks the account. One atomic
 * UPDATE (the row lock orders parallel attempts): a read-then-write would let
 * parallel guesses each write "1" and the lock never trigger.
 */
async function recordFailure(db: Db, id: string) {
  await db.query(
    `UPDATE users SET
       failed_logins = CASE WHEN failed_logins + 1 >= $2 THEN 0 ELSE failed_logins + 1 END,
       locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + make_interval(mins => $3) ELSE locked_until END
     WHERE id = $1`,
    [id, MAX_FAILED, LOCK_MINUTES],
  );
}

async function clearFailures(db: Db, id: string) {
  await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [id]);
}

export async function verifyPassword(db: Db, id: string, password: string): Promise<boolean> {
  const r = await db.query('SELECT password_hash FROM users WHERE id = $1', [id]);
  const h = r.rows[0]?.password_hash;
  return h ? argon2.verify(h, password) : false;
}

/** End every session of a user (all devices), or all but `keep`. */
export async function endSessions(db: Db | import('pg').PoolClient, userId: string, keep?: string) {
  await db.query(
    "DELETE FROM session WHERE sess->>'userId' = $1 AND ($2::text IS NULL OR sid <> $2)",
    [userId, keep ?? null],
  );
}

// ---------- emailed tokens (verification, password reset) ----------

export type TokenKind = 'verify' | 'reset';
export const TOKEN_HOURS: Record<TokenKind, number> = { verify: 24, reset: 1 };

/** A fresh token of this kind for the user; earlier open ones stop working. */
export async function issueToken(db: Db, userId: string, kind: TokenKind): Promise<string> {
  const { token, hash } = newToken();
  await tx(db, async (c) => {
    await c.query(
      'UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND kind = $2 AND used_at IS NULL',
      [userId, kind],
    );
    await c.query(
      `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(hours => ${TOKEN_HOURS[kind]}))`,
      [userId, kind, hash],
    );
  });
  return token;
}

/** Whether a token of this kind was issued for the user in the last `minutes`. */
export async function issuedRecently(
  db: Db,
  userId: string,
  kind: TokenKind,
  minutes: number,
): Promise<boolean> {
  const r = await db.query(
    'SELECT 1 FROM auth_tokens WHERE user_id = $1 AND kind = $2 AND created_at > now() - make_interval(mins => $3)',
    [userId, kind, minutes],
  );
  return (r.rowCount ?? 0) > 0;
}

/** Use a token once; returns the user id. */
async function consumeToken(
  c: import('pg').PoolClient,
  token: string,
  kind: TokenKind,
): Promise<string> {
  const r = await c.query(
    'SELECT * FROM auth_tokens WHERE token_hash = $1 AND kind = $2 FOR UPDATE',
    [hashToken(token), kind],
  );
  const row = r.rows[0];
  if (!row || row.used_at || new Date(row.expires_at) < new Date())
    throw new AuthError('This link is not valid any more. Request a new one.', 'token');
  await c.query('UPDATE auth_tokens SET used_at = now() WHERE id = $1', [row.id]);
  return row.user_id as string;
}

export async function verifyEmail(db: Db, token: string): Promise<User> {
  return tx(db, async (c) => {
    const id = await consumeToken(c, token, 'verify');
    const r = await c.query('UPDATE users SET email_verified = true WHERE id = $1 RETURNING *', [
      id,
    ]);
    return toUser(r.rows[0]);
  });
}

/**
 * Set a new password from an emailed link. Proves the address, so the account
 * counts as verified; the lockout clears; every session ends (the link may have
 * been requested because the password leaked). TOTP stays as it was, unless
 * the account was unverified: then whoever set it up never proved the address
 * (a squatter), so it goes, with the other open links.
 */
export async function resetPassword(db: Db, token: string, password: string): Promise<User> {
  const weak = validatePassword(password);
  if (weak) throw new AuthError(weak, 'weak');
  const hash = await argon2.hash(password, ARGON);
  return tx(db, async (c) => {
    const id = await consumeToken(c, token, 'reset');
    const before = await c.query('SELECT email_verified FROM users WHERE id = $1 FOR UPDATE', [id]);
    if (!before.rows[0].email_verified) {
      await c.query(
        'UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL WHERE id = $1',
        [id],
      );
      await c.query(
        'UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
        [id],
      );
    }
    const r = await c.query(
      'UPDATE users SET password_hash = $2, email_verified = true, failed_logins = 0, locked_until = NULL WHERE id = $1 RETURNING *',
      [id, hash],
    );
    await endSessions(c, id);
    return toUser(r.rows[0]);
  });
}

/** Change the password of a signed-in account; other sessions end. */
export async function changePassword(
  db: Db,
  userId: string,
  current: string,
  next: string,
  keepSession: string,
): Promise<void> {
  if (!(await verifyPassword(db, userId, current)))
    throw new AuthError('Incorrect password.', 'invalid');
  const weak = validatePassword(next);
  if (weak) throw new AuthError(weak, 'weak');
  const hash = await argon2.hash(next, ARGON);
  await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, hash]);
  await endSessions(db, userId, keepSession);
}

// ---------- TOTP ----------

const totpFor = (secret: string, label = 'PLS Studio') =>
  new OTPAuth.TOTP({
    issuer: 'PLS Studio',
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });

/**
 * Check a TOTP code against the user's (encrypted) secret and use it up: the
 * time step of the last accepted code is stored, and a code of that step or an
 * earlier one is refused (RFC 6238 section 5.2: a seen code must not work twice).
 * The conditional UPDATE makes two parallel uses of one code accept only one.
 */
async function useTotp(
  db: Db,
  totpKey: Buffer,
  userId: string,
  sealedSecret: Buffer,
  code: string,
): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const totp = totpFor(open(totpKey, sealedSecret, `totp:${userId}`).toString());
  const now = Date.now();
  const delta = totp.validate({ token: code, window: 1, timestamp: now });
  if (delta === null) return false;
  const step = totp.counter({ timestamp: now }) + delta;
  const r = await db.query(
    'UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)',
    [userId, step],
  );
  return r.rowCount === 1;
}

/** Start TOTP enrolment: store an encrypted pending secret, return the otpauth URI. */
export async function beginTotp(
  db: Db,
  totpKey: Buffer,
  user: User,
): Promise<{ uri: string; secret: string }> {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  await db.query(
    'UPDATE users SET totp_secret = $2, totp_last_step = NULL WHERE id = $1 AND totp_enabled = false',
    [user.id, seal(totpKey, Buffer.from(secret), `totp:${user.id}`)],
  );
  return { uri: totpFor(secret, user.email).toString(), secret };
}

export async function enableTotp(
  db: Db,
  totpKey: Buffer,
  userId: string,
  code: string,
): Promise<boolean> {
  const r = await db.query('SELECT totp_secret FROM users WHERE id = $1 AND totp_enabled = false', [
    userId,
  ]);
  const enc = r.rows[0]?.totp_secret;
  if (!enc || !(await useTotp(db, totpKey, userId, enc, code))) return false;
  await db.query('UPDATE users SET totp_enabled = true WHERE id = $1', [userId]);
  return true;
}

export async function disableTotp(db: Db, userId: string) {
  await db.query(
    'UPDATE users SET totp_enabled = false, totp_secret = NULL, totp_last_step = NULL WHERE id = $1',
    [userId],
  );
}

// ---------- Google ----------

/** Existing account by Google subject, if linked. */
export async function findByGoogle(db: Db, sub: string): Promise<User | null> {
  const r = await db.query('SELECT * FROM users WHERE google_sub = $1', [sub]);
  return r.rows[0] ? toUser(r.rows[0]) : null;
}

export async function createGoogleUser(
  db: Db,
  sub: string,
  email: string,
  name: string,
): Promise<User> {
  const r = await db.query(
    'INSERT INTO users (email, display_name, google_sub, email_verified) VALUES ($1, $2, $3, true) RETURNING *',
    [email, name, sub],
  );
  return toUser(r.rows[0]);
}

/**
 * Google asserts the address; an unverified password account holding it never
 * proved ownership, so it becomes this Google user's: password, second factor,
 * sessions and tokens of the old account go. Null when the account is verified.
 */
export async function claimUnverified(
  db: Db,
  userId: string,
  sub: string,
  name: string,
): Promise<User | null> {
  return tx(db, async (c) => {
    const r = await c.query(
      `UPDATE users SET google_sub = $2, display_name = $3, email_verified = true, password_hash = NULL, totp_enabled = false, totp_secret = NULL, failed_logins = 0, locked_until = NULL
        WHERE id = $1 AND email_verified = false RETURNING *`,
      [userId, sub, name],
    );
    if (!r.rowCount) return null;
    await c.query('UPDATE auth_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [
      userId,
    ]);
    await endSessions(c, userId);
    return toUser(r.rows[0]);
  });
}

export async function linkGoogle(db: Db, userId: string, sub: string) {
  await db.query('UPDATE users SET google_sub = $2 WHERE id = $1', [userId, sub]);
}

/**
 * A TOTP code from a signed-in or half-signed-in user (the second step after
 * Google sign-in; confirming that a password-less account turns TOTP off).
 * Counts like a password attempt: a wrong code is a failure towards the
 * lockout, and a locked account is refused before the code is looked at.
 */
export async function verifyTotpForUser(
  db: Db,
  totpKey: Buffer,
  userId: string,
  code: string,
): Promise<boolean> {
  const r = await db.query(
    'SELECT totp_secret, totp_enabled, locked_until FROM users WHERE id = $1',
    [userId],
  );
  const row = r.rows[0];
  if (!row?.totp_enabled || !row.totp_secret) return false;
  if (row.locked_until && new Date(row.locked_until) > new Date())
    throw new AuthError('Too many failed attempts. Try again later.', 'locked');
  if (!(await useTotp(db, totpKey, userId, row.totp_secret, code))) {
    await recordFailure(db, userId);
    return false;
  }
  await clearFailures(db, userId);
  return true;
}
