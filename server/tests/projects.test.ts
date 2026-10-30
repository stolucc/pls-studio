import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVITES_PER_HOUR } from '../src/routes/projects.ts';
import { signedUp, startEnv, type Agent, type TestEnv } from './helpers.ts';

let env: TestEnv;
let owner: Agent, editor: Agent, viewer: Agent, stranger: Agent;
let projectId: string;
const userId = async (email: string) => (await env.db.query('SELECT id FROM users WHERE email = $1', [email])).rows[0].id as string;

/** Invite by email and accept with the matching account; returns the token. */
async function invite(by: Agent, who: Agent, email: string, role: 'editor' | 'viewer') {
  const r = await by.post(`/api/projects/${projectId}/invitations`, { email, role });
  expect(r.status).toBe(201);
  const mail = env.deps.mailer.outbox.at(-1)!;
  const token = decodeURIComponent(/invite=([^\s]+)/.exec(mail.text)![1]);
  expect((await who.post(`/api/auth/invitations/${token}/accept`)).status).toBe(200);
  return token;
}

beforeAll(async () => {
  env = await startEnv();
  owner = await signedUp(env, 'owner@example.org', 'Olivia Owner');
  editor = await signedUp(env, 'editor@example.org');
  viewer = await signedUp(env, 'viewer@example.org');
  stranger = await signedUp(env, 'stranger@example.org');
  projectId = (await owner.post('/api/projects', { name: 'Shared model' })).body.id;
  await invite(owner, editor, 'editor@example.org', 'editor');
  await invite(owner, viewer, 'viewer@example.org', 'viewer');
});
afterAll(async () => { await env.close(); });

describe('projects and roles', () => {
  it('lists projects with roles for each member', async () => {
    const list = (await editor.get('/api/projects')).body.projects;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Shared model', role: 'editor', owner_name: 'Olivia Owner', members: 3 });
    expect((await stranger.get('/api/projects')).body.projects).toEqual([]);
  });

  it('hides projects from non-members (404, no existence leak) and rejects bad ids', async () => {
    for (const url of ['', '/members', '/dataset']) expect((await stranger.get(`/api/projects/${projectId}${url}`)).status).toBe(404);
    expect((await stranger.patch(`/api/projects/${projectId}`, { name: 'x' })).status).toBe(404);
    expect((await owner.get('/api/projects/not-a-uuid')).status).toBe(404);
  });

  it('enforces the role matrix', async () => {
    // Viewer: read only.
    expect((await viewer.get(`/api/projects/${projectId}/members`)).status).toBe(200);
    expect((await viewer.patch(`/api/projects/${projectId}`, { name: 'Renamed' })).status).toBe(403);
    expect((await viewer.put(`/api/projects/${projectId}/dataset`, JSON.stringify({ names: [] }))).status).toBe(403);
    // Editor: content, but not membership.
    expect((await editor.patch(`/api/projects/${projectId}`, { name: 'Renamed' })).status).toBe(200);
    expect((await editor.post(`/api/projects/${projectId}/invitations`, { email: 'x@example.org', role: 'viewer' })).status).toBe(403);
    expect((await editor.get(`/api/projects/${projectId}/invitations`)).status).toBe(403);
    expect((await editor.del(`/api/projects/${projectId}`)).status).toBe(403);
    const viewerId = await userId('viewer@example.org');
    expect((await editor.patch(`/api/projects/${projectId}/members/${viewerId}`, { role: 'editor' })).status).toBe(403);
    // Owner: everything.
    expect((await owner.patch(`/api/projects/${projectId}/members/${viewerId}`, { role: 'editor' })).status).toBe(200);
    expect((await owner.patch(`/api/projects/${projectId}/members/${viewerId}`, { role: 'viewer' })).status).toBe(200);
  });

  it('writes an audit trail', async () => {
    const actions = (await env.db.query('SELECT action FROM audit_log WHERE project_id = $1 ORDER BY id', [projectId])).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['project.create', 'invite.create', 'invite.accept', 'member.role']));
  });
});

describe('invitations', () => {
  it('sends a plain-text email with a link, never storing the token', async () => {
    await owner.post(`/api/projects/${projectId}/invitations`, { email: 'new@example.org', role: 'viewer' });
    const mail = env.deps.mailer.outbox.at(-1)!;
    expect(mail.to).toBe('new@example.org');
    expect(mail.subject).toContain('Olivia Owner invited you');
    const token = decodeURIComponent(/invite=([^\s]+)/.exec(mail.text)![1]);
    const stored = (await env.db.query('SELECT token_hash FROM invitations WHERE email = $1', ['new@example.org'])).rows[0].token_hash as Buffer;
    expect(stored.toString('latin1')).not.toContain(token);
    const preview = await stranger.get(`/api/auth/invitations/${encodeURIComponent(token)}`);
    expect(preview.body).toMatchObject({ projectName: 'Renamed', inviterName: 'Olivia Owner', role: 'viewer', email: 'new@example.org' });
  });

  it('gives the owner the link and says whether it was emailed', async () => {
    const r = await owner.post(`/api/projects/${projectId}/invitations`, { email: 'erin@example.org', role: 'viewer' });
    expect(r.status).toBe(201);
    expect(r.body.emailed).toBe(false); // no SMTP_URL in tests: mail only goes to the log
    expect(r.body.link).toBe(/(\S*invite=\S+)/.exec(env.deps.mailer.outbox.at(-1)!.text)![1]);
    // the link is no shortcut: a different account still cannot accept it
    const token = decodeURIComponent(new URL(r.body.link).searchParams.get('invite')!);
    expect((await stranger.post(`/api/auth/invitations/${encodeURIComponent(token)}/accept`)).status).toBe(403);
  });

  it('still creates the invitation when sending the email fails', async () => {
    const mailer = env.deps.mailer;
    const { send, configured } = mailer;
    mailer.configured = true;
    mailer.send = async () => { throw new Error('SMTP down'); };
    try {
      const r = await owner.post(`/api/projects/${projectId}/invitations`, { email: 'frank@example.org', role: 'editor' });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ emailed: false, link: expect.stringContaining('invite=') });
    } finally { mailer.send = send; mailer.configured = configured; }
  });

  it('only the invited address can accept, and only once', async () => {
    await owner.post(`/api/projects/${projectId}/invitations`, { email: 'carol@example.org', role: 'editor' });
    const token = decodeURIComponent(/invite=([^\s]+)/.exec(env.deps.mailer.outbox.at(-1)!.text)![1]);
    expect((await stranger.post(`/api/auth/invitations/${token}/accept`)).status).toBe(403);
    const carol = await signedUp(env, 'carol@example.org');
    expect((await carol.post(`/api/auth/invitations/${token}/accept`)).status).toBe(200);
    expect((await carol.post(`/api/auth/invitations/${token}/accept`)).status).toBe(410);
  });

  it('refuses revoked and expired invitations, and members cannot be re-invited', async () => {
    const r = await owner.post(`/api/projects/${projectId}/invitations`, { email: 'dave@example.org', role: 'viewer' });
    const token = decodeURIComponent(/invite=([^\s]+)/.exec(env.deps.mailer.outbox.at(-1)!.text)![1]);
    expect((await owner.del(`/api/projects/${projectId}/invitations/${r.body.id}`)).status).toBe(200);
    const dave = await signedUp(env, 'dave@example.org');
    expect((await dave.post(`/api/auth/invitations/${token}/accept`)).status).toBe(410);

    await owner.post(`/api/projects/${projectId}/invitations`, { email: 'dave@example.org', role: 'viewer' });
    const t2 = decodeURIComponent(/invite=([^\s]+)/.exec(env.deps.mailer.outbox.at(-1)!.text)![1]);
    await env.db.query("UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE email = 'dave@example.org' AND revoked_at IS NULL");
    expect((await dave.post(`/api/auth/invitations/${t2}/accept`)).status).toBe(410);

    expect((await owner.post(`/api/projects/${projectId}/invitations`, { email: 'editor@example.org', role: 'viewer' })).status).toBe(409);
  });

  it('handles leaving and removal', async () => {
    const carolId = await userId('carol@example.org');
    expect((await editor.del(`/api/projects/${projectId}/members/${carolId}`)).status).toBe(403);
    expect((await owner.del(`/api/projects/${projectId}/members/${carolId}`)).status).toBe(200);
    const ownerId = await userId('owner@example.org');
    expect((await owner.del(`/api/projects/${projectId}/members/${ownerId}`)).status).toBe(400);
    const v = await signedUp(env, 'leaver@example.org');
    await invite(owner, v, 'leaver@example.org', 'viewer');
    expect((await v.del(`/api/projects/${projectId}/members/${await userId('leaver@example.org')}`)).status).toBe(200);
    expect((await v.get(`/api/projects/${projectId}`)).status).toBe(404);
  });
});

describe('datasets are encrypted at rest', () => {
  const dataset = JSON.stringify({ names: ['SECRET_ITEM_1', 'q2'], columns: [[1, 2, 3], [4, 5, 6]] });

  it('round-trips for members and bumps the data revision', async () => {
    const put = await editor.put(`/api/projects/${projectId}/dataset`, dataset);
    expect(put.status).toBe(200);
    expect(put.body.revision).toBeGreaterThan(0);
    const got = await viewer.get(`/api/projects/${projectId}/dataset`);
    expect(got.status).toBe(200);
    expect(got.headers['cache-control']).toBe('no-store');
    expect(JSON.parse(got.text)).toEqual(JSON.parse(dataset));
  });

  it('stores no plaintext and binds ciphertexts to their project', async () => {
    const row = (await env.db.query('SELECT ciphertext, wrapped_key FROM datasets WHERE project_id = $1', [projectId])).rows[0];
    expect(row.ciphertext.toString('latin1')).not.toContain('SECRET_ITEM_1');
    // Replaying the ciphertext into another project fails authentication.
    const other = (await owner.post('/api/projects', { name: 'Other' })).body.id;
    await env.db.query('INSERT INTO datasets (project_id, ciphertext, wrapped_key, byte_size) VALUES ($1, $2, $3, 1)', [other, row.ciphertext, row.wrapped_key]);
    expect((await owner.get(`/api/projects/${other}/dataset`)).status).toBe(500);
    // Tampering is detected too.
    const tampered = Buffer.from(row.ciphertext);
    tampered[tampered.length - 1] ^= 1;
    await env.db.query('UPDATE datasets SET ciphertext = $2 WHERE project_id = $1', [other, tampered]);
    expect((await owner.get(`/api/projects/${other}/dataset`)).status).toBe(500);
  });

  it('validates uploads', async () => {
    expect((await editor.put(`/api/projects/${projectId}/dataset`, 'not json')).status).toBe(400);
    expect((await editor.put(`/api/projects/${projectId}/dataset`, JSON.stringify({ no: 'names' }))).status).toBe(400);
  });

  it('lets only the owner delete the project, removing its data', async () => {
    expect((await viewer.del(`/api/projects/${projectId}`)).status).toBe(403);
    expect((await owner.del(`/api/projects/${projectId}`)).status).toBe(200);
    expect((await env.db.query('SELECT count(*)::int AS n FROM datasets WHERE project_id = $1', [projectId])).rows[0].n).toBe(0);
  });
});

describe('invitation rate limit', () => {
  it(`caps invitation emails at ${INVITES_PER_HOUR} per user and hour`, async () => {
    const sender = await signedUp(env, 'sender@example.org');
    const pid = (await sender.post('/api/projects', { name: 'Mailer' })).body.id;
    const before = env.deps.mailer.outbox.length;
    const statuses: number[] = [];
    for (let i = 0; i <= INVITES_PER_HOUR; i++) statuses.push((await sender.post(`/api/projects/${pid}/invitations`, { email: `x${i}@example.org`, role: 'viewer' })).status);
    expect(statuses.slice(0, INVITES_PER_HOUR).every((s) => s === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect(env.deps.mailer.outbox.length - before).toBe(INVITES_PER_HOUR);
    // Other users are not affected.
    const other = await signedUp(env, 'other-sender@example.org');
    const pid2 = (await other.post('/api/projects', { name: 'Other' })).body.id;
    expect((await other.post(`/api/projects/${pid2}/invitations`, { email: 'y@example.org', role: 'viewer' })).status).toBe(201);
  });
});
