// Projects, membership, invitations and encrypted datasets. Every function
// that reads or writes project content takes the acting user and checks the
// role here, so routes cannot forget an authorization check.

import { decryptDataset, encryptDataset, hashToken, newToken } from '../crypto.ts';
import { tx, type Db } from '../db.ts';

export type Role = 'owner' | 'editor' | 'viewer';
const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export class AccessError extends Error {
  readonly status: 400 | 401 | 403 | 404 | 409 | 410;
  constructor(message: string, status: 400 | 401 | 403 | 404 | 409 | 410 = 403) { super(message); this.status = status; }
}

export async function roleOf(db: Db, projectId: string, userId: string): Promise<Role | null> {
  const r = await db.query('SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
  return (r.rows[0]?.role as Role) ?? null;
}

/** Throws 404 for non-members (no existence leak) and 403 for insufficient roles. */
export async function requireRole(db: Db, projectId: string, userId: string, min: Role): Promise<Role> {
  const role = await roleOf(db, projectId, userId);
  if (!role) throw new AccessError('Project not found.', 404);
  if (RANK[role] < RANK[min]) throw new AccessError(`This needs ${min} access.`, 403);
  return role;
}

export async function audit(db: Db, userId: string | null, projectId: string | null, action: string, meta: Record<string, unknown> = {}) {
  await db.query('INSERT INTO audit_log (user_id, project_id, action, meta) VALUES ($1, $2, $3, $4)', [userId, projectId, action, meta]);
}

export async function createProject(db: Db, userId: string, name: string, yjsState: Buffer | null): Promise<string> {
  return tx(db, async (c) => {
    const r = await c.query('INSERT INTO projects (name, owner_id, yjs_state) VALUES ($1, $2, $3) RETURNING id', [name, userId, yjsState]);
    const id = r.rows[0].id as string;
    await c.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')", [id, userId]);
    await c.query('INSERT INTO audit_log (user_id, project_id, action) VALUES ($1, $2, $3)', [userId, id, 'project.create']);
    return id;
  });
}

export async function listProjects(db: Db, userId: string) {
  const r = await db.query(
    `SELECT p.id, p.name, p.updated_at, m.role, u.display_name AS owner_name,
            (SELECT count(*)::int FROM project_members x WHERE x.project_id = p.id) AS members
       FROM project_members m JOIN projects p ON p.id = m.project_id JOIN users u ON u.id = p.owner_id
      WHERE m.user_id = $1 ORDER BY p.updated_at DESC`, [userId]);
  return r.rows;
}

export async function getProject(db: Db, projectId: string, userId: string) {
  const role = await requireRole(db, projectId, userId, 'viewer');
  const r = await db.query('SELECT id, name, data_revision, updated_at FROM projects WHERE id = $1', [projectId]);
  return { ...r.rows[0], role };
}

export async function renameProject(db: Db, projectId: string, userId: string, name: string) {
  await requireRole(db, projectId, userId, 'editor');
  await db.query('UPDATE projects SET name = $2, updated_at = now() WHERE id = $1', [projectId, name]);
}

export async function deleteProject(db: Db, projectId: string, userId: string) {
  await requireRole(db, projectId, userId, 'owner');
  await audit(db, userId, null, 'project.delete', { projectId });
  await db.query('DELETE FROM projects WHERE id = $1', [projectId]);
}

// ---------- members ----------

export async function listMembers(db: Db, projectId: string, userId: string) {
  await requireRole(db, projectId, userId, 'viewer');
  const r = await db.query(
    `SELECT u.id, u.email, u.display_name, m.role FROM project_members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = $1 ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, u.display_name`, [projectId]);
  return r.rows;
}

export async function setMemberRole(db: Db, projectId: string, actorId: string, targetId: string, role: 'editor' | 'viewer') {
  await requireRole(db, projectId, actorId, 'owner');
  if (targetId === actorId) throw new AccessError('Owners cannot change their own role.', 400);
  const r = await db.query("UPDATE project_members SET role = $3 WHERE project_id = $1 AND user_id = $2 AND role <> 'owner'", [projectId, targetId, role]);
  if (!r.rowCount) throw new AccessError('Member not found.', 404);
  await audit(db, actorId, projectId, 'member.role', { targetId, role });
}

/** Owners remove anyone but themselves; any member may remove themselves (leave). */
export async function removeMember(db: Db, projectId: string, actorId: string, targetId: string) {
  const role = await requireRole(db, projectId, actorId, 'viewer');
  if (targetId !== actorId && role !== 'owner') throw new AccessError('Only the owner can remove members.');
  if (targetId === actorId && role === 'owner') throw new AccessError('The owner cannot leave; delete the project instead.', 400);
  const r = await db.query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 AND role <> 'owner'", [projectId, targetId]);
  if (!r.rowCount) throw new AccessError('Member not found.', 404);
  await audit(db, actorId, projectId, 'member.remove', { targetId });
}

// ---------- invitations ----------

export const INVITE_DAYS = 7;

export async function createInvitation(db: Db, projectId: string, actorId: string, email: string, role: 'editor' | 'viewer') {
  await requireRole(db, projectId, actorId, 'owner');
  const existing = await db.query('SELECT 1 FROM project_members m JOIN users u ON u.id = m.user_id WHERE m.project_id = $1 AND u.email = $2', [projectId, email]);
  if (existing.rowCount) throw new AccessError('This person is already a member.', 409);
  const { token, hash } = newToken();
  // A new invitation replaces any open one for the same address.
  await db.query('UPDATE invitations SET revoked_at = now() WHERE project_id = $1 AND email = $2 AND accepted_at IS NULL AND revoked_at IS NULL', [projectId, email]);
  const r = await db.query(
    `INSERT INTO invitations (project_id, email, role, token_hash, invited_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => ${INVITE_DAYS})) RETURNING id, expires_at`,
    [projectId, email, role, hash, actorId]);
  await audit(db, actorId, projectId, 'invite.create', { email, role });
  return { id: r.rows[0].id as string, token, expiresAt: r.rows[0].expires_at as Date };
}

export async function listInvitations(db: Db, projectId: string, actorId: string) {
  await requireRole(db, projectId, actorId, 'owner');
  const r = await db.query(
    `SELECT id, email, role, expires_at, created_at FROM invitations
      WHERE project_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [projectId]);
  return r.rows;
}

export async function revokeInvitation(db: Db, projectId: string, actorId: string, invitationId: string) {
  await requireRole(db, projectId, actorId, 'owner');
  const r = await db.query('UPDATE invitations SET revoked_at = now() WHERE id = $1 AND project_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL', [invitationId, projectId]);
  if (!r.rowCount) throw new AccessError('Invitation not found.', 404);
  await audit(db, actorId, projectId, 'invite.revoke', { invitationId });
}

async function openInvitation(db: Db, token: string) {
  const r = await db.query(
    `SELECT i.*, p.name AS project_name, u.display_name AS inviter_name FROM invitations i
       JOIN projects p ON p.id = i.project_id JOIN users u ON u.id = i.invited_by WHERE i.token_hash = $1`, [hashToken(token)]);
  const inv = r.rows[0];
  if (!inv) throw new AccessError('This invitation link is not valid.', 404);
  if (inv.revoked_at) throw new AccessError('This invitation was withdrawn.', 410);
  if (inv.accepted_at) throw new AccessError('This invitation has already been used.', 410);
  if (new Date(inv.expires_at) < new Date()) throw new AccessError('This invitation has expired. Ask for a new one.', 410);
  return inv;
}

/** What an invitee sees before accepting (no project content). */
export async function previewInvitation(db: Db, token: string) {
  const inv = await openInvitation(db, token);
  return { projectName: inv.project_name as string, inviterName: inv.inviter_name as string, role: inv.role as string, email: inv.email as string };
}

/** Accept: the signed-in account's email must match the invited address. */
export async function acceptInvitation(db: Db, token: string, userId: string, userEmail: string): Promise<string> {
  return tx(db, async (c) => {
    const r = await c.query('SELECT * FROM invitations WHERE token_hash = $1 FOR UPDATE', [hashToken(token)]);
    const inv = r.rows[0];
    if (!inv || inv.revoked_at || inv.accepted_at || new Date(inv.expires_at) < new Date()) {
      throw new AccessError('This invitation is no longer valid.', 410);
    }
    if (String(inv.email).toLowerCase() !== userEmail.toLowerCase()) {
      throw new AccessError(`This invitation was sent to ${inv.email}. Sign in with that address to accept it.`, 403);
    }
    await c.query(
      `INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT (project_id, user_id) DO NOTHING`, [inv.project_id, userId, inv.role]);
    await c.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [inv.id]);
    await c.query('INSERT INTO audit_log (user_id, project_id, action) VALUES ($1, $2, $3)', [userId, inv.project_id, 'invite.accept']);
    return inv.project_id as string;
  });
}

// ---------- datasets (encrypted at rest) ----------

export async function putDataset(db: Db, master: Buffer, projectId: string, userId: string, json: string): Promise<number> {
  await requireRole(db, projectId, userId, 'editor');
  const { ciphertext, wrappedKey } = encryptDataset(master, projectId, json);
  return tx(db, async (c) => {
    await c.query(
      `INSERT INTO datasets (project_id, ciphertext, wrapped_key, byte_size, updated_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id) DO UPDATE SET ciphertext = $2, wrapped_key = $3, byte_size = $4, updated_by = $5, updated_at = now()`,
      [projectId, ciphertext, wrappedKey, Buffer.byteLength(json), userId]);
    const r = await c.query('UPDATE projects SET data_revision = data_revision + 1, updated_at = now() WHERE id = $1 RETURNING data_revision', [projectId]);
    await c.query('INSERT INTO audit_log (user_id, project_id, action) VALUES ($1, $2, $3)', [userId, projectId, 'dataset.put']);
    return r.rows[0].data_revision as number;
  });
}

export async function getDataset(db: Db, master: Buffer, projectId: string, userId: string): Promise<string | null> {
  await requireRole(db, projectId, userId, 'viewer');
  const r = await db.query('SELECT ciphertext, wrapped_key FROM datasets WHERE project_id = $1', [projectId]);
  if (!r.rows[0]) return null;
  return decryptDataset(master, projectId, r.rows[0].ciphertext, r.rows[0].wrapped_key);
}

export async function deleteDataset(db: Db, projectId: string, userId: string) {
  await requireRole(db, projectId, userId, 'editor');
  await db.query('DELETE FROM datasets WHERE project_id = $1', [projectId]);
  await db.query('UPDATE projects SET data_revision = data_revision + 1, updated_at = now() WHERE id = $1', [projectId]);
  await audit(db, userId, projectId, 'dataset.delete');
}
