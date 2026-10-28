import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import { z } from 'zod';
import { establishSession, h, requireUser, type AppDeps } from '../app.ts';
import { acceptInvitation, previewInvitation } from '../services/projects.ts';
import * as users from '../services/users.ts';
import { googleRoutes } from './google.ts';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(1).max(256);
const name = z.string().trim().min(1).max(80);
const code = z.string().trim().regex(/^\d{6}$/);

export function authRoutes(deps: AppDeps) {
  const { db, config } = deps;
  const r = Router();
  const totpKey = Buffer.from(config.TOTP_KEY, 'base64');
  const secure = config.NODE_ENV === 'production';
  // Brute-force protection on credential endpoints (per IP), on top of per-account lockout.
  const strict = rateLimit({ windowMs: 15 * 60_000, limit: config.NODE_ENV === 'test' ? 1000 : 30, standardHeaders: 'draft-8', legacyHeaders: false });

  r.get('/session', h(async (req, res) => {
    const user = req.session.userId ? await users.getUser(db, req.session.userId) : null;
    res.json({
      user,
      csrfToken: req.session.csrfToken,
      googleEnabled: !!deps.google,
      pendingTotp: !!req.session.pendingTotpUser,
      pendingGoogleLink: req.session.pendingGoogle ? { email: req.session.pendingGoogle.email } : null,
    });
  }));

  r.post('/register', strict, h(async (req, res) => {
    const body = z.object({ email, password, name }).parse(req.body);
    const user = await users.register(db, body.email, body.password, body.name);
    await establishSession(req, res, user.id, secure);
    res.status(201).json({ user });
  }));

  r.post('/login', strict, h(async (req, res) => {
    const body = z.object({ email, password, code: code.optional() }).parse(req.body);
    const user = await users.login(db, totpKey, body.email, body.password, body.code);
    await establishSession(req, res, user.id, secure);
    res.json({ user });
  }));

  r.post('/logout', h(async (req, res) => {
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    res.clearCookie('pls.sid');
    res.json({ ok: true });
  }));

  // ---- TOTP ----
  r.post('/totp/setup', h(async (req, res) => {
    const user = await users.getUser(db, requireUser(req));
    if (!user) return res.status(401).json({ error: 'Please sign in.' });
    if (user.totp_enabled) return res.status(409).json({ error: 'Two-factor authentication is already on.' });
    const { uri, secret } = await users.beginTotp(db, totpKey, user);
    res.json({ uri, secret, qr: await QRCode.toDataURL(uri) });
  }));

  r.post('/totp/enable', strict, h(async (req, res) => {
    const body = z.object({ code }).parse(req.body);
    const ok = await users.enableTotp(db, totpKey, requireUser(req), body.code);
    if (!ok) return res.status(400).json({ error: 'That code did not match. Check the time on your device and try again.' });
    res.json({ ok: true });
  }));

  r.post('/totp/disable', strict, h(async (req, res) => {
    const userId = requireUser(req);
    const body = z.object({ password }).parse(req.body);
    if (!(await users.verifyPassword(db, userId, body.password))) return res.status(400).json({ error: 'Incorrect password.' });
    await users.disableTotp(db, userId);
    res.json({ ok: true });
  }));

  // Second step after Google sign-in for accounts with TOTP.
  r.post('/totp/verify', strict, h(async (req, res) => {
    const body = z.object({ code }).parse(req.body);
    const pending = req.session.pendingTotpUser;
    if (!pending) return res.status(400).json({ error: 'Nothing to verify.' });
    const ok = await users.verifyTotpForUser(db, totpKey, pending, body.code);
    if (!ok) return res.status(400).json({ error: 'Incorrect authentication code.' });
    await establishSession(req, res, pending, secure);
    res.json({ user: await users.getUser(db, pending) });
  }));

  // ---- invitations (public preview; acceptance needs a signed-in, matching account) ----
  r.get('/invitations/:token', h(async (req, res) => {
    res.json(await previewInvitation(db, String(req.params.token)));
  }));

  r.post('/invitations/:token/accept', h(async (req, res) => {
    const userId = requireUser(req);
    const user = await users.getUser(db, userId);
    const projectId = await acceptInvitation(db, String(req.params.token), userId, user!.email);
    deps.onMembershipChange?.(projectId, userId);
    res.json({ projectId });
  }));

  r.use('/google', googleRoutes(deps, strict));
  return r;
}
