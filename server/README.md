# PLS Studio collaboration server

Accounts, shared projects, invitations, encrypted datasets and real-time co-editing
(Y.js over WebSocket) for PLS Studio. Node 22 runs the TypeScript sources directly.

## Run locally

```bash
createdb pls_studio && createdb pls_studio_test
npm install
npm run dev            # http://localhost:8787 (migrates on start)
cd .. && npm run dev   # client on http://localhost:5175, proxies /api and /ws
npm test               # integration tests against pls_studio_test (real PostgreSQL)
```

Without `SMTP_URL`, verification, password-reset and invitation emails are printed to the
server console (fine for development; a deployment needs SMTP, since new accounts verify
their address by email).

## Configuration (environment)

| Variable | Required in production | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `APP_ORIGIN` | yes (https) | Public origin; used for links, Origin/CSRF checks and the Google redirect |
| `SESSION_SECRET` | yes (≥ 32 chars) | Signs the session cookie |
| `DATA_MASTER_KEY` | yes (32 bytes, base64) | Wraps the per-project dataset keys |
| `TOTP_KEY` | yes (32 bytes, base64) | Encrypts TOTP secrets |
| `SMTP_URL`, `MAIL_FROM` | for email | Invitation delivery (nodemailer URL) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | optional | Google sign-in; redirect URI `${APP_ORIGIN}/api/auth/google/callback` |
| `STATIC_DIR` | optional | Serve the built client (`../dist`) from this server |
| `PORT` | no (8787) | |

Generate keys with `openssl rand -base64 32`. The server refuses to start in
production with development defaults or a non-https origin. Keep `DATA_MASTER_KEY`
safe: without it, stored datasets cannot be decrypted.

## Security design

- **Passwords**: argon2id; ≥ 12 characters; generic login errors with equal timing for
  unknown emails; per-account lockout (5 failures → 15 min) plus per-IP rate limits.
- **Email verification**: registering sends a single-use link (24 h; only its SHA-256 is
  stored). Until it is used the account cannot create projects, invite or accept
  invitations. An unverified account does not reserve its address: the next registration
  with that address replaces it, and a Google sign-in with that address claims it.
  Accounts from before verification existed count as verified.
- **Password reset**: `POST /api/auth/password/forgot` always answers 200 and emails a
  1-hour single-use link when the address has an account (3 per address per hour).
  Using it sets the password, marks the address verified, clears the lockout and ends
  every session; TOTP stays on. Google-only accounts set a password the same way.
  `POST /api/auth/password/change` (current + new) ends the other sessions.
- **Sessions**: PostgreSQL-backed, `HttpOnly`, `SameSite=Lax`, `Secure` in production,
  24 h rolling; id regenerated at sign-in (no fixation).
- **CSRF**: per-session token required in `X-CSRF-Token` on every state-changing request
  (login included); the Origin header must match `APP_ORIGIN`.
- **TOTP**: RFC 6238, secrets encrypted at rest; also enforced after Google sign-in.
- **Google**: OIDC authorization code with PKCE, state and nonce; verified emails only;
  an existing password account is linked only after its password is confirmed.
- **Authorization**: every project operation checks the role in the service layer
  (owner / editor / viewer); non-members get 404 (no existence leak).
- **Invitations**: random 256-bit tokens, only their SHA-256 is stored; single use,
  7-day expiry, revocable; accepted only by an account with the invited email.
- **Datasets**: gzip + AES-256-GCM under a fresh per-project key, which is itself
  wrapped with `DATA_MASTER_KEY`; the project id is bound as associated data.
- **Real time**: the WebSocket handshake checks Origin, session and membership; viewers'
  document updates are dropped server-side; membership changes disconnect immediately;
  message size and rate limits per connection.
- **Headers**: helmet with a strict CSP (no inline scripts), `frame-ancestors 'none'`.
- **Audit log**: project creation/deletion, invitations, membership and dataset changes.
