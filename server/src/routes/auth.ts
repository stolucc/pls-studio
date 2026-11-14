import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import { z } from 'zod';
import { establishSession, h, requireUser, requireVerified, type AppDeps } from '../app.ts';
import { acceptInvitation, previewInvitation } from '../services/projects.ts';
import * as users from '../services/users.ts';
import { googleRoutes } from './google.ts';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(1).max(256);
const name = z.string().trim().min(1).max(80);
/** How long the code step after Google sign-in stays open. */
export const PENDING_TOTP_MS = 5 * 60_000;
const code = z
  .string()
  .trim()
  .regex(/^\d{6}$/);

export function authRoutes(deps: AppDeps) {
  const { db, config, mailer } = deps;
  const r = Router();
  const totpKey = Buffer.from(config.TOTP_KEY, 'base64');
  const secure = config.NODE_ENV === 'production';
  // Brute-force protection on credential endpoints (per IP), on top of per-account lockout.
  const strict = rateLimit({
    windowMs: 15 * 60_000,
    limit: config.NODE_ENV === 'test' ? 1000 : 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  r.get(
    '/session',
    h(async (req, res) => {
      const user = req.session.userId ? await users.getUser(db, req.session.userId) : null;
      res.json({
        user,
        csrfToken: req.session.csrfToken,
        googleEnabled: !!deps.google,
        pendingTotp: !!req.session.pendingTotpUser,
        pendingGoogleLink: req.session.pendingGoogle
          ? { email: req.session.pendingGoogle.email }
          : null,
      });
    }),
  );

  // Emails carry a single-use link; a failed send is logged, the user can ask again.
  const sendVerification = async (user: users.User) => {
    const token = await users.issueToken(db, user.id, 'verify');
    try {
      await mailer.send({
        to: user.email,
        subject: 'Verify your email address for PLS Studio',
        text: [
          `Hello ${user.display_name},`,
          '',
          `Open this link to verify ${user.email} for your PLS Studio account (valid for ${users.TOKEN_HOURS.verify} hours):`,
          `${config.APP_ORIGIN}/#verify=${encodeURIComponent(token)}`,
          '',
          'If you did not create this account, ignore this email: the address stays unverified and anyone can register it.',
        ].join('\n'),
      });
    } catch (err) {
      console.error(`Verification email to ${user.email} failed: ${(err as Error).message}`);
    }
  };
  const sendReset = async (user: users.User) => {
    const token = await users.issueToken(db, user.id, 'reset');
    try {
      await mailer.send({
        to: user.email,
        subject: `${user.has_password ? 'Reset' : 'Set'} your PLS Studio password`,
        text: [
          `Hello ${user.display_name},`,
          '',
          `Open this link to ${user.has_password ? 'choose a new' : 'set a'} password for your PLS Studio account (valid for ${users.TOKEN_HOURS.reset} hour):`,
          `${config.APP_ORIGIN}/#reset=${encodeURIComponent(token)}`,
          '',
          'If you did not ask for this, ignore this email: nothing changes.',
        ].join('\n'),
      });
    } catch (err) {
      console.error(`Password email to ${user.email} failed: ${(err as Error).message}`);
    }
  };

  r.post(
    '/register',
    strict,
    h(async (req, res) => {
      const body = z.object({ email, password, name }).parse(req.body);
      let user: users.User;
      try {
        user = await users.register(db, body.email, body.password, body.name);
      } catch (err) {
        const held = err instanceof users.AuthError && err.code === 'exists';
        const existing = held ? await users.findByEmail(db, body.email) : null;
        if (!existing || existing.email_verified) throw err;
        // Held by an account that never verified the address: maybe the person
        // registering is its owner coming back, maybe someone squatting it.
        // Nothing changes here; the mailbox gets a password link (at most one
        // per quarter hour this way), which hands the account to whoever controls it.
        if (!(await users.issuedRecently(db, existing.id, 'reset', 15))) await sendReset(existing);
        return res.status(409).json({
          error:
            'An account with this email already exists but was never verified. We have emailed this address a link to set its password.',
          code: 'exists',
        });
      }
      await sendVerification(user);
      await establishSession(req, res, user.id, secure);
      res.status(201).json({ user });
    }),
  );

  // ---- email verification ----
  r.post(
    '/verify-email',
    strict,
    h(async (req, res) => {
      const body = z.object({ token: z.string().min(1).max(200) }).parse(req.body);
      const user = await users.verifyEmail(db, body.token);
      res.json({ ok: true, email: user.email });
    }),
  );

  r.post(
    '/verify-email/resend',
    strict,
    h(async (req, res) => {
      const user = await users.getUser(db, requireUser(req));
      if (!user) return res.status(401).json({ error: 'Please sign in.' });
      if (user.email_verified)
        return res.status(409).json({ error: 'This address is already verified.' });
      await sendVerification(user);
      res.json({ ok: true });
    }),
  );

  // ---- password reset (also how a Google-only account sets a password) ----
  // The answer never says whether the address has an account.
  const perEmail = rateLimit({
    windowMs: 60 * 60_000,
    limit: config.NODE_ENV === 'test' ? 1000 : 3,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) =>
      String((req.body as { email?: unknown })?.email ?? '')
        .trim()
        .toLowerCase(),
    message: { error: 'Too many emails requested for this address. Try again later.' },
  });
  r.post(
    '/password/forgot',
    strict,
    perEmail,
    h(async (req, res) => {
      const body = z.object({ email }).parse(req.body);
      const user = await users.findByEmail(db, body.email);
      if (user) await sendReset(user);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/password/reset',
    strict,
    h(async (req, res) => {
      const body = z.object({ token: z.string().min(1).max(200), password }).parse(req.body);
      const user = await users.resetPassword(db, body.token, body.password);
      deps.onSessionsEnded?.(user.id);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/password/change',
    strict,
    h(async (req, res) => {
      const userId = requireUser(req);
      const body = z.object({ current: password, password }).parse(req.body);
      await users.changePassword(db, userId, body.current, body.password, req.sessionID);
      deps.onSessionsEnded?.(userId, { keep: req.sessionID });
      res.json({ ok: true });
    }),
  );

  r.post(
    '/login',
    strict,
    h(async (req, res) => {
      const body = z.object({ email, password, code: code.optional() }).parse(req.body);
      const user = await users.login(db, totpKey, body.email, body.password, body.code);
      await establishSession(req, res, user.id, secure);
      res.json({ user });
    }),
  );

  r.post(
    '/logout',
    h(async (req, res) => {
      const userId = req.session.userId;
      const sessionId = req.sessionID;
      await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
      if (userId) deps.onSessionsEnded?.(userId, { only: sessionId });
      res.clearCookie('pls.sid');
      res.json({ ok: true });
    }),
  );

  // ---- TOTP ----
  r.post(
    '/totp/setup',
    h(async (req, res) => {
      const user = await users.getUser(db, requireUser(req));
      if (!user) return res.status(401).json({ error: 'Please sign in.' });
      if (user.totp_enabled)
        return res.status(409).json({ error: 'Two-factor authentication is already on.' });
      const { uri, secret } = await users.beginTotp(db, totpKey, user);
      res.json({ uri, secret, qr: await QRCode.toDataURL(uri) });
    }),
  );

  r.post(
    '/totp/enable',
    strict,
    h(async (req, res) => {
      const body = z.object({ code }).parse(req.body);
      const ok = await users.enableTotp(db, totpKey, requireUser(req), body.code);
      if (!ok)
        return res
          .status(400)
          .json({ error: 'That code did not match. Check the time on your device and try again.' });
      res.json({ ok: true });
    }),
  );

  r.post(
    '/totp/disable',
    strict,
    h(async (req, res) => {
      const userId = requireUser(req);
      const body = z
        .object({ password: password.optional(), code: code.optional() })
        .parse(req.body);
      const user = await users.getUser(db, userId);
      if (!user) return res.status(401).json({ error: 'Please sign in.' });
      if (user.has_password) {
        if (!body.password || !(await users.verifyPassword(db, userId, body.password)))
          return res.status(400).json({ error: 'Incorrect password.' });
      } else {
        // A Google-only account has no password to confirm with: a current code
        // from the authenticator proves the same (and counts towards the lockout).
        if (!body.code || !(await users.verifyTotpForUser(db, totpKey, userId, body.code)))
          return res.status(400).json({ error: 'Incorrect authentication code.' });
      }
      await users.disableTotp(db, userId);
      res.json({ ok: true });
    }),
  );

  // Second step after Google sign-in for accounts with TOTP.
  r.post(
    '/totp/verify',
    strict,
    h(async (req, res) => {
      const body = z.object({ code }).parse(req.body);
      const pending = req.session.pendingTotpUser;
      if (!pending) return res.status(400).json({ error: 'Nothing to verify.' });
      if (Date.now() - (req.session.pendingTotpAt ?? 0) > PENDING_TOTP_MS) {
        delete req.session.pendingTotpUser;
        delete req.session.pendingTotpAt;
        return res
          .status(400)
          .json({ error: 'This sign-in has expired. Sign in with Google again.' });
      }
      const ok = await users.verifyTotpForUser(db, totpKey, pending, body.code);
      if (!ok) return res.status(400).json({ error: 'Incorrect authentication code.' });
      await establishSession(req, res, pending, secure);
      res.json({ user: await users.getUser(db, pending) });
    }),
  );

  // ---- invitations (public preview; acceptance needs a signed-in, matching account) ----
  r.get(
    '/invitations/:token',
    h(async (req, res) => {
      res.json(await previewInvitation(db, String(req.params.token)));
    }),
  );

  r.post(
    '/invitations/:token/accept',
    h(async (req, res) => {
      const userId = await requireVerified(db, req);
      const user = await users.getUser(db, userId);
      const projectId = await acceptInvitation(db, String(req.params.token), userId, user!.email);
      deps.onMembershipChange?.(projectId, userId);
      res.json({ projectId });
    }),
  );

  r.use('/google', googleRoutes(deps, strict));
  return r;
}
