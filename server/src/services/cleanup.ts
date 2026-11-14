// Expired single-use links: emailed tokens (email verification, password reset)
// and project invitations are refused once they expire, but their rows used to
// stay in the database for ever. They are deleted GRACE_DAYS after they stop
// working: a link opened within that window still gets the specific message
// ("expired", "withdrawn"), after it the generic "not valid". Accepted
// invitations are kept, as the record of who invited whom. Sessions are pruned
// by the session store itself (connect-pg-simple).

import type { Db } from '../db.ts';

export const GRACE_DAYS = 30;
const SWEEP_MS = 60 * 60 * 1000;

/** Delete emailed tokens and unaccepted invitations that stopped working more than GRACE_DAYS ago. */
export async function deleteExpiredLinks(db: Db): Promise<{ tokens: number; invitations: number }> {
  const tokens = await db.query(
    'DELETE FROM auth_tokens WHERE expires_at < now() - make_interval(days => $1)',
    [GRACE_DAYS],
  );
  const invitations = await db.query(
    `DELETE FROM invitations
      WHERE accepted_at IS NULL
        AND (expires_at < now() - make_interval(days => $1)
             OR revoked_at < now() - make_interval(days => $1))`,
    [GRACE_DAYS],
  );
  return { tokens: tokens.rowCount ?? 0, invitations: invitations.rowCount ?? 0 };
}

/**
 * Run deleteExpiredLinks now and then every hour; returns a function that stops it.
 * The DELETEs are idempotent, so every instance of a cluster may run them. The
 * timer is unref'd so it never keeps the process alive.
 */
export function startLinkCleanup(db: Db, intervalMs = SWEEP_MS): () => void {
  const sweep = () => {
    deleteExpiredLinks(db).catch((err: unknown) => {
      console.error('Deleting expired links failed:', err);
    });
  };
  sweep();
  const timer = setInterval(sweep, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
