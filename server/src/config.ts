// Configuration from the environment, validated at startup. In production
// every secret is required; development gets clearly-marked local defaults.

import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  DATABASE_URL: z.string().min(1).default('postgres:///pls_studio'),
  /** Public origin of the app, e.g. https://pls.example.org (used for links, Origin checks, OAuth redirect). */
  APP_ORIGIN: z.string().url().default('http://localhost:5175'),
  SESSION_SECRET: z.string().min(32),
  /** 32-byte master key (base64) that wraps per-project data keys. */
  DATA_MASTER_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64'),
  /** Key wrapping TOTP secrets (32 bytes, base64). */
  TOTP_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('PLS Studio <no-reply@localhost>'),
  /** Built client (../dist) to serve in production; unset when a reverse proxy serves it. */
  STATIC_DIR: z.string().optional(),
  /** Max dataset upload, bytes. */
  MAX_DATASET_BYTES: z.coerce.number().int().default(60 * 1024 * 1024),
});

export type Config = z.infer<typeof schema>;

const DEV_DEFAULTS: Record<string, string> = {
  // Clearly fake, development-only values. Production refuses to start without real ones.
  SESSION_SECRET: 'dev-only-session-secret-change-me-0123456789abcdef',
  DATA_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
  TOTP_KEY: Buffer.alloc(32, 9).toString('base64'),
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const merged = { ...env };
  if (!isProd && env.NODE_ENV !== 'production') {
    for (const [k, v] of Object.entries(DEV_DEFAULTS)) merged[k] ??= v;
  }
  const parsed = schema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    for (const [k, v] of Object.entries(DEV_DEFAULTS)) {
      if ((parsed.data as Record<string, unknown>)[k] === v) throw new Error(`${k} must be set in production`);
    }
    if (!parsed.data.APP_ORIGIN.startsWith('https://')) throw new Error('APP_ORIGIN must be https in production');
  }
  return parsed.data;
}
