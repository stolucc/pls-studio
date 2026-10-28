// HTTP application: security middleware, sessions, CSRF and the JSON API.

import crypto from 'node:crypto';
import connectPg from 'connect-pg-simple';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import helmet from 'helmet';
import { ZodError } from 'zod';
import type { Config } from './config.ts';
import { safeEqual } from './crypto.ts';
import type { Db } from './db.ts';
import { authRoutes } from './routes/auth.ts';
import { projectRoutes } from './routes/projects.ts';
import type { Mailer } from './services/mailer.ts';
import { AccessError } from './services/projects.ts';
import { AuthError } from './services/users.ts';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    csrfToken?: string;
    /** Google sign-in waiting for a password (link) or TOTP code. */
    pendingGoogle?: { sub: string; email: string; name: string };
    pendingTotpUser?: string;
    oauth?: { state: string; nonce: string; verifier: string };
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  mailer: Mailer;
  /** Set by the WebSocket layer so membership changes can disconnect users. */
  onMembershipChange?: (projectId: string, userId?: string) => void;
  google?: import('./routes/google.ts').GoogleClient;
}

export const SESSION_COOKIE = 'pls.sid';

export function createApp(deps: AppDeps) {
  const { config } = deps;
  const app = express();
  const prod = config.NODE_ENV === 'production';
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // WebAssembly compilation for the in-browser R runtime (webR); does not allow JS eval.
        scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ['https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
      },
    },
    // Cross-origin isolation (with helmet's default COOP same-origin): the in-browser
    // R runtime (webR) needs SharedArrayBuffer.
    crossOriginEmbedderPolicy: { policy: 'require-corp' },
  }));

  const PgStore = connectPg(session);
  const sessionMiddleware = session({
    name: SESSION_COOKIE,
    store: new PgStore({ pool: deps.db, tableName: 'session', createTableIfMissing: false }),
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: prod, maxAge: 24 * 60 * 60 * 1000 },
  });
  app.use(sessionMiddleware);
  (app as unknown as { sessionMiddleware: typeof sessionMiddleware }).sessionMiddleware = sessionMiddleware;

  app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }));

  // CSRF: a per-session token, delivered by GET /api/auth/session (and the csrf-token
  // cookie), required in X-CSRF-Token on every state-changing request — login included.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      res.cookie('csrf-token', req.session.csrfToken, { sameSite: 'lax', secure: prod, httpOnly: false });
      return next();
    }
    const origin = req.get('origin');
    if (origin && origin !== config.APP_ORIGIN) return res.status(403).json({ error: 'Cross-origin request refused.' });
    const sent = req.get('x-csrf-token');
    if (!sent || !req.session.csrfToken || !safeEqual(sent, req.session.csrfToken)) {
      return res.status(403).json({ error: 'Missing or invalid CSRF token. Reload the page and try again.' });
    }
    next();
  });

  app.use('/api/auth', express.json({ limit: '16kb' }), authRoutes(deps));
  app.use('/api/projects', projectRoutes(deps));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  if (config.STATIC_DIR) {
    // The single-page app, same origin as the API (cookies, CSRF and CSP all line up).
    app.use(express.static(config.STATIC_DIR, { index: 'index.html', maxAge: '1h' }));
    app.get('/', (_req, res) => res.sendFile('index.html', { root: config.STATIC_DIR }));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AccessError) return res.status(err.status).json({ error: err.message });
    if (err instanceof ZodError) return res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid input.' });
    if (err instanceof AuthError) return res.status(err.code === 'locked' ? 429 : err.code === 'exists' ? 409 : 400).json({ error: err.message, code: err.code });
    const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode;
    if (status === 413) return res.status(413).json({ error: 'Upload too large.' });
    if (status === 400) return res.status(400).json({ error: 'Malformed request.' });
    console.error(err);
    res.status(500).json({ error: 'Internal error.' });
  });
  return app;
}

/** Express handler wrapper for async routes. */
export const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

export function requireUser(req: Request): string {
  const id = req.session.userId;
  if (!id) throw new AccessError('Please sign in.', 401);
  return id;
}

/** Regenerate the session id on privilege change (prevents session fixation). */
export function establishSession(req: Request, res: Response, userId: string, secure: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      // The new session has a new CSRF token: hand it to the client right away.
      res.cookie('csrf-token', req.session.csrfToken, { sameSite: 'lax', secure, httpOnly: false });
      req.session.save((e) => (e ? reject(e) : resolve()));
    });
  });
}
