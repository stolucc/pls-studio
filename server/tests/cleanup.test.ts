import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../src/db.ts';
import { deleteExpiredLinks, GRACE_DAYS } from '../src/services/cleanup.ts';
import { freshDb } from './helpers.ts';

let db: Db;
let userId: string;
let projectId: string;

beforeAll(async () => {
  db = await freshDb();
  const u = await db.query(
    "INSERT INTO users (email, display_name) VALUES ('owner@example.org', 'Owner') RETURNING id",
  );
  userId = u.rows[0].id;
  const p = await db.query("INSERT INTO projects (name, owner_id) VALUES ('P', $1) RETURNING id", [
    userId,
  ]);
  projectId = p.rows[0].id;
});
afterAll(async () => {
  await db.end();
});

/** A timestamp `days` days from now (negative: in the past), as SQL. */
const daysFromNow = (days: number) => `now() + make_interval(days => ${days})`;

async function addToken(label: string, expiresInDays: number) {
  await db.query(
    `INSERT INTO auth_tokens (user_id, kind, token_hash, expires_at)
     VALUES ($1, 'verify', decode(md5($2), 'hex'), ${daysFromNow(expiresInDays)})`,
    [userId, label],
  );
}

async function addInvitation(
  email: string,
  expiresInDays: number,
  extra: { acceptedDaysAgo?: number; revokedDaysAgo?: number } = {},
) {
  const accepted =
    extra.acceptedDaysAgo === undefined ? 'NULL' : daysFromNow(-extra.acceptedDaysAgo);
  const revoked = extra.revokedDaysAgo === undefined ? 'NULL' : daysFromNow(-extra.revokedDaysAgo);
  await db.query(
    `INSERT INTO invitations
       (project_id, email, role, token_hash, invited_by, expires_at, accepted_at, revoked_at)
     VALUES ($1, $2, 'viewer', decode(md5($4), 'hex'), $3, ${daysFromNow(expiresInDays)},
             ${accepted}, ${revoked})`,
    [projectId, email, userId, email],
  );
}

describe('deleting expired links', () => {
  it('deletes tokens and unaccepted invitations only once the grace period is over', async () => {
    await addToken('open', 1);
    await addToken('recently expired', -(GRACE_DAYS - 1));
    await addToken('long expired', -(GRACE_DAYS + 1));

    await addInvitation('open@example.org', 5);
    await addInvitation('recently-expired@example.org', -(GRACE_DAYS - 1));
    await addInvitation('long-expired@example.org', -(GRACE_DAYS + 1));
    await addInvitation('accepted@example.org', -(GRACE_DAYS + 10), { acceptedDaysAgo: 40 });
    await addInvitation('revoked-long-ago@example.org', 5, { revokedDaysAgo: GRACE_DAYS + 1 });
    await addInvitation('revoked-recently@example.org', 5, { revokedDaysAgo: 1 });

    expect(await deleteExpiredLinks(db)).toEqual({ tokens: 1, invitations: 2 });

    const tokens = await db.query('SELECT count(*)::int AS n FROM auth_tokens');
    expect(tokens.rows[0].n).toBe(2);
    const left = await db.query('SELECT email FROM invitations ORDER BY email');
    expect(left.rows.map((r) => r.email)).toEqual([
      'accepted@example.org',
      'open@example.org',
      'recently-expired@example.org',
      'revoked-recently@example.org',
    ]);

    // (a second sweep finds nothing more)
    expect(await deleteExpiredLinks(db)).toEqual({ tokens: 0, invitations: 0 });
  });
});
