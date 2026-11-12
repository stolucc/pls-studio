// HTTP application: security middleware, sessions, CSRF and the JSON API.

import crypto from 'node:crypto';
import path from 'node:path';
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
import { exampleDataRoutes, type ExampleDataOptions } from './routes/exampleData.ts';
import { projectRoutes } from './routes/projects.ts';
import type { Mailer } from './services/mailer.ts';
import { AccessError } from './services/projects.ts';
import { AuthError, getUser } from './services/users.ts';
import { staticCacheControl, staticContentType } from './staticCache.ts';

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
  /** (tests) the example-data pass-through's fetch, limits and timeout */
  exampleData?: ExampleDataOptions;
}

export const SESSION_COOKIE = 'pls.sid';

/** CSP for the webR worker script only (see the static-files section). */
export const WEBR_WORKER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

export function createApp(deps: AppDeps) {
  const { config } = deps;
  const app = express();
  const prod = config.NODE_ENV === 'production';
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // WebAssembly compilation for the in-browser R runtime (webR); does not allow JS eval.
          scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ['https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'blob:'],
          // The optional desktop R helper (helper/) on the loopback interface; example data read from their source
          // when an example opens (src/examples/remote: the RI-CLPM tutorial's file on GitHub).
          connectSrc: ["'self'", 'http://127.0.0.1:9878', 'https://raw.githubusercontent.com'],
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
    }),
  );

  app.use(
    '/api',
    rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false }),
  );

  // Liveness + database check for the deploy scripts and monitoring. Registered
  // before the session middleware so probes never create session rows (but
  // after the rate limiter: it is unauthenticated and queries the database).
  app.get(
    '/api/health',
    h(async (_req, res) => {
      await deps.db.query('SELECT 1');
      res.set('Cache-Control', 'no-store').json({ ok: true });
    }),
  );

  // Example data the browser cannot fetch itself (statmodel.com sends no CORS header), passed through and never
  // stored (routes/exampleData.ts). Before the session middleware: anonymous, it creates no session rows or cookies.
  app.use('/api/example-data', exampleDataRoutes(deps.exampleData));

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
  (app as unknown as { sessionMiddleware: typeof sessionMiddleware }).sessionMiddleware =
    sessionMiddleware;

  // CSRF: a per-session token, delivered by GET /api/auth/session (and the csrf-token
  // cookie), required in X-CSRF-Token on every state-changing request — login included.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      res.cookie('csrf-token', req.session.csrfToken, {
        sameSite: 'lax',
        secure: prod,
        httpOnly: false,
      });
      return next();
    }
    const origin = req.get('origin');
    if (origin && origin !== config.APP_ORIGIN)
      return res.status(403).json({ error: 'Cross-origin request refused.' });
    const sent = req.get('x-csrf-token');
    if (!sent || !req.session.csrfToken || !safeEqual(sent, req.session.csrfToken)) {
      return res
        .status(403)
        .json({ error: 'Missing or invalid CSRF token. Reload the page and try again.' });
    }
    next();
  });

  app.use('/api/auth', express.json({ limit: '16kb' }), authRoutes(deps));
  app.use('/api/projects', projectRoutes(deps));

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  if (config.STATIC_DIR) {
    // webR's worker (where R runs) needs eval: when R loads its shared libraries
    // (libRblas.so, package .so files), Emscripten builds their EM_ASM functions
    // with eval. Without it R dies on start-up ("ASM_CONSTS[code] is not a
    // function"). A worker's CSP comes from its own script response, so only this
    // one file gets 'unsafe-eval'; the page keeps the strict policy above.
    app.get('/webr/webr-worker.js', (_req, res, next) => {
      res.setHeader('Content-Security-Policy', WEBR_WORKER_CSP);
      next();
    });
    // The single-page app, same origin as the API (cookies, CSRF and CSP all line up).
    // Cache headers per file (staticCache.ts): index.html and the R worker revalidated on every load,
    // Vite's content-hashed bundles and the versioned R package binaries cached for good, the rest
    // (the pinned R runtime, example data) for an hour; the R shared libraries labelled as WebAssembly, so Caddy
    // compresses them.
    const staticRoot = path.resolve(config.STATIC_DIR);
    app.use(
      express.static(config.STATIC_DIR, {
        index: 'index.html',
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          const relative = path.relative(staticRoot, filePath);
          const cache = staticCacheControl(relative);
          if (cache) res.setHeader('Cache-Control', cache);
          const type = staticContentType(relative);
          if (type) res.setHeader('Content-Type', type);
        },
      }),
    );
    app.get('/', (_req, res) =>
      res.set('Cache-Control', 'no-cache').sendFile('index.html', { root: config.STATIC_DIR }),
    );
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AccessError)
      return res
        .status(err.status)
        .json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    if (err instanceof ZodError)
      return res.status(400).json({ error: err.issues[0]?.message ?? 'Invalid input.' });
    if (err instanceof AuthError)
      return res
        .status(err.code === 'locked' ? 429 : err.code === 'exists' ? 409 : 400)
        .json({ error: err.message, code: err.code });
    const status =
      (err as { status?: number; statusCode?: number }).status ??
      (err as { statusCode?: number }).statusCode;
    if (status === 413) return res.status(413).json({ error: 'Upload too large.' });
    if (status === 400) return res.status(400).json({ error: 'Malformed request.' });
    console.error(err);
    res.status(500).json({ error: 'Internal error.' });
  });
  return app;
}

/** Express handler wrapper for async routes. */
export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

export function requireUser(req: Request): string {
  const id = req.session.userId;
  if (!id) throw new AccessError('Please sign in.', 401);
  return id;
}

/** The signed-in user, who must have verified their email address (creating and joining projects). */
export async function requireVerified(db: Db, req: Request): Promise<string> {
  const id = requireUser(req);
  const user = await getUser(db, id);
  if (!user) throw new AccessError('Please sign in.', 401);
  if (!user.email_verified)
    throw new AccessError(
      'Verify your email address first: open the link in the email we sent you (the account menu can send it again).',
      403,
      'unverified',
    );
  return id;
}

/** Regenerate the session id on privilege change (prevents session fixation). */
export function establishSession(
  req: Request,
  res: Response,
  userId: string,
  secure: boolean,
): Promise<void> {
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
