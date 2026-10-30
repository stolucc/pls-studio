// Google sign-in (OpenID Connect, authorization code + PKCE, state and nonce).
// Policy (as flowtex): a Google account matching an existing password account
// is only linked after the user confirms that account's password; TOTP still applies.

import { Router, type RequestHandler } from 'express';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { establishSession, h, type AppDeps } from '../app.ts';
import * as users from '../services/users.ts';

export interface GoogleIdentity { sub: string; email: string; emailVerified: boolean; name: string }

/** The pieces of the OIDC exchange, injectable for tests. */
export interface GoogleClient {
  authorizationUrl(redirectUri: string, state: string, nonce: string, challenge: string): string;
  exchange(currentUrl: URL, state: string, nonce: string, verifier: string): Promise<GoogleIdentity>;
}

export async function createGoogleClient(clientId: string, clientSecret: string): Promise<GoogleClient> {
  const config = await oidc.discovery(new URL('https://accounts.google.com'), clientId, clientSecret);
  return {
    authorizationUrl: (redirect_uri, state, nonce, code_challenge) => oidc.buildAuthorizationUrl(config, {
      redirect_uri, scope: 'openid email profile', state, nonce, code_challenge, code_challenge_method: 'S256',
    }).href,
    async exchange(currentUrl, expectedState, expectedNonce, pkceCodeVerifier) {
      const tokens = await oidc.authorizationCodeGrant(config, currentUrl, { pkceCodeVerifier, expectedState, expectedNonce });
      const c = tokens.claims()!;
      return { sub: String(c.sub), email: String(c.email ?? ''), emailVerified: c.email_verified === true, name: String(c.name ?? c.email ?? 'Google user') };
    },
  };
}

export function googleRoutes(deps: AppDeps, strict: RequestHandler) {
  const { db, config } = deps;
  const r = Router();
  const secure = config.NODE_ENV === 'production';
  const totpKey = Buffer.from(config.TOTP_KEY, 'base64');
  const redirectUri = `${config.APP_ORIGIN}/api/auth/google/callback`;

  r.get('/start', h(async (req, res) => {
    if (!deps.google) return res.status(404).json({ error: 'Google sign-in is not configured.' });
    const state = oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier();
    req.session.oauth = { state, nonce, verifier };
    const url = deps.google.authorizationUrl(redirectUri, state, nonce, await oidc.calculatePKCECodeChallenge(verifier));
    req.session.save(() => res.redirect(url));
  }));

  r.get('/callback', h(async (req, res) => {
    const pending = req.session.oauth;
    delete req.session.oauth;
    if (!deps.google || !pending) return res.redirect('/?auth=google-failed');
    let id: GoogleIdentity;
    try {
      id = await deps.google.exchange(new URL(req.originalUrl, config.APP_ORIGIN), pending.state, pending.nonce, pending.verifier);
    } catch {
      return res.redirect('/?auth=google-failed');
    }
    if (!id.email || !id.emailVerified) return res.redirect('/?auth=google-unverified');
    const email = id.email.toLowerCase();

    const finish = async (user: users.User) => {
      if (user.totp_enabled) {
        req.session.pendingTotpUser = user.id; // second factor required
        return req.session.save(() => res.redirect('/?auth=totp'));
      }
      await establishSession(req, res, user.id, secure);
      res.redirect('/?auth=ok');
    };

    const linked = await users.findByGoogle(db, id.sub);
    if (linked) return finish(linked);
    const existing = await users.findByEmail(db, email);
    if (existing && !existing.email_verified) {
      // An account that never verified this address is a squat, not its owner.
      const claimed = await users.claimUnverified(db, existing.id, id.sub, id.name.slice(0, 80));
      if (claimed) return finish(claimed);
    }
    if (existing) {
      // Never link silently: ask for the existing account's password first.
      req.session.pendingGoogle = { sub: id.sub, email, name: id.name };
      return req.session.save(() => res.redirect('/?auth=google-link'));
    }
    return finish(await users.createGoogleUser(db, id.sub, email, id.name.slice(0, 80)));
  }));

  r.post('/link', strict, h(async (req, res) => {
    const pending = req.session.pendingGoogle;
    if (!pending) return res.status(400).json({ error: 'No Google sign-in is waiting to be linked.' });
    const body = z.object({ password: z.string().min(1).max(256), code: z.string().regex(/^\d{6}$/).optional() }).parse(req.body);
    const user = await users.login(db, totpKey, pending.email, body.password, body.code);
    await users.linkGoogle(db, user.id, pending.sub);
    delete req.session.pendingGoogle;
    await establishSession(req, res, user.id, secure);
    res.json({ user: await users.getUser(db, user.id) });
  }));

  return r;
}
