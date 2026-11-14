import express, { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import { h, requireUser, requireVerified, type AppDeps } from '../app.ts';
import * as P from '../services/projects.ts';
import { getUser } from '../services/users.ts';

const uuid = z.string().uuid();
const pid = (raw: unknown) => {
  const r = uuid.safeParse(raw);
  if (!r.success) throw new P.AccessError('Project not found.', 404);
  return r.data;
};
const projectName = z.string().trim().min(1).max(100);
/** Single line, no control characters (names end up in email subjects). */
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
/** Invitation emails per user and hour: anyone can create a project, so this caps mail to arbitrary addresses. */
export const INVITES_PER_HOUR = 20;
/** Dataset uploads per user and minute (each up to MAX_DATASET_BYTES). */
export const DATASET_UPLOADS_PER_MINUTE = 30;

export function projectRoutes(deps: AppDeps) {
  const { db, config, mailer } = deps;
  const master = Buffer.from(config.DATA_MASTER_KEY, 'base64');
  const r = Router();
  const json = express.json({ limit: '2mb' });
  const inviteLimit = rateLimit({
    windowMs: 60 * 60_000,
    limit: INVITES_PER_HOUR,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => req.session.userId ?? ipKeyGenerator(req.ip ?? ''),
    message: { error: 'Too many invitations sent in the last hour. Try again later.' },
  });
  // Dataset uploads per user and minute: the client uploads once per data import, so this only
  // stops one account from keeping the server busy reading and parsing tens of megabytes.
  const datasetLimit = rateLimit({
    windowMs: 60_000,
    limit: DATASET_UPLOADS_PER_MINUTE,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => req.session.userId ?? ipKeyGenerator(req.ip ?? ''),
    message: { error: 'Too many dataset uploads in the last minute. Try again shortly.' },
  });

  r.get(
    '/',
    h(async (req, res) => res.json({ projects: await P.listProjects(db, requireUser(req)) })),
  );

  r.post(
    '/',
    json,
    h(async (req, res) => {
      const userId = await requireVerified(db, req);
      const body = z
        .object({ name: projectName, yjsState: z.string().max(2_000_000).optional() })
        .parse(req.body);
      const state = body.yjsState ? Buffer.from(body.yjsState, 'base64') : null;
      const id = await P.createProject(db, userId, oneLine(body.name), state);
      res.status(201).json({ id });
    }),
  );

  r.get(
    '/:id',
    h(async (req, res) => res.json(await P.getProject(db, pid(req.params.id), requireUser(req)))),
  );

  r.patch(
    '/:id',
    json,
    h(async (req, res) => {
      const body = z.object({ name: projectName }).parse(req.body);
      await P.renameProject(db, pid(req.params.id), requireUser(req), oneLine(body.name));
      res.json({ ok: true });
    }),
  );

  r.delete(
    '/:id',
    h(async (req, res) => {
      const id = pid(req.params.id);
      await P.deleteProject(db, id, requireUser(req));
      deps.onMembershipChange?.(id);
      res.json({ ok: true });
    }),
  );

  // ---- members ----
  r.get(
    '/:id/members',
    h(async (req, res) =>
      res.json({ members: await P.listMembers(db, pid(req.params.id), requireUser(req)) }),
    ),
  );

  r.patch(
    '/:id/members/:userId',
    json,
    h(async (req, res) => {
      const id = pid(req.params.id);
      const target = uuid.parse(req.params.userId);
      const body = z.object({ role: z.enum(['editor', 'viewer']) }).parse(req.body);
      await P.setMemberRole(db, id, requireUser(req), target, body.role);
      deps.onMembershipChange?.(id, target);
      res.json({ ok: true });
    }),
  );

  r.delete(
    '/:id/members/:userId',
    h(async (req, res) => {
      const id = pid(req.params.id);
      const target = uuid.parse(req.params.userId);
      await P.removeMember(db, id, requireUser(req), target);
      deps.onMembershipChange?.(id, target);
      res.json({ ok: true });
    }),
  );

  // ---- invitations ----
  r.get(
    '/:id/invitations',
    h(async (req, res) =>
      res.json({ invitations: await P.listInvitations(db, pid(req.params.id), requireUser(req)) }),
    ),
  );

  r.post(
    '/:id/invitations',
    inviteLimit,
    json,
    h(async (req, res) => {
      const id = pid(req.params.id);
      const userId = await requireVerified(db, req);
      const body = z
        .object({
          email: z.string().trim().toLowerCase().email().max(254),
          role: z.enum(['editor', 'viewer']),
        })
        .parse(req.body);
      const inv = await P.createInvitation(db, id, userId, body.email, body.role);
      const [inviter, project] = await Promise.all([
        getUser(db, userId),
        P.getProject(db, id, userId),
      ]);
      // The token travels in the fragment: browsers never send it to the server, so it is in no access log or Referer.
      const link = `${config.APP_ORIGIN}/#invite=${encodeURIComponent(inv.token)}`;
      const mail = {
        to: body.email,
        subject: oneLine(
          `${inviter!.display_name} invited you to “${project.name}” on PLS Studio`,
        ).slice(0, 200),
        text: [
          `${oneLine(inviter!.display_name)} (${inviter!.email}) invited you to work on the project “${oneLine(project.name)}” as ${body.role === 'editor' ? 'an editor' : 'a viewer'}.`,
          '',
          `Open this link to accept (valid for ${P.INVITE_DAYS} days):`,
          link,
          '',
          `Sign in or create an account with ${body.email} to accept. If you did not expect this, you can ignore it.`,
        ].join('\n'),
      };
      // The owner also gets the link, to pass on when email is not set up or fails.
      // Only an account with the invited address can use it, as with the email.
      let emailed = mailer.configured;
      try {
        await mailer.send(mail);
      } catch (err) {
        console.error(`Invitation email to ${body.email} failed: ${(err as Error).message}`);
        emailed = false;
      }
      res.status(201).json({ id: inv.id, expiresAt: inv.expiresAt, link, emailed });
    }),
  );

  r.delete(
    '/:id/invitations/:invId',
    h(async (req, res) => {
      await P.revokeInvitation(
        db,
        pid(req.params.id),
        requireUser(req),
        uuid.parse(req.params.invId),
      );
      res.json({ ok: true });
    }),
  );

  // ---- dataset (encrypted at rest) ----
  // Up to MAX_DATASET_BYTES (tens of MB): body-parser refuses a larger declared or received
  // body (413) before anything is parsed, and the size counts after any Content-Encoding is
  // undone. Reading and parsing a body that size takes memory and blocks the event loop for
  // a moment, so only an editor of the project gets that far (editorFirst, before the body
  // parser): anyone else is answered from the headers and the body is never read.
  const big = express.text({ type: 'application/json', limit: config.MAX_DATASET_BYTES });
  const editorFirst = (req: Request, _res: Response, next: NextFunction) => {
    let check: Promise<unknown>;
    try {
      check = P.requireRole(db, pid(req.params.id), requireUser(req), 'editor');
    } catch (err) {
      return next(err);
    }
    check.then(() => next(), next);
  };
  r.put(
    '/:id/dataset',
    datasetLimit,
    editorFirst,
    big,
    h(async (req, res) => {
      const id = pid(req.params.id);
      const text = typeof req.body === 'string' ? req.body : '';
      let parsed: unknown;
      try {
        // (bounded by the body parser's limit above; only the shape is checked, the text is stored)
        parsed = JSON.parse(text);
      } catch {
        return res.status(400).json({ error: 'Dataset must be JSON.' });
      }
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !Array.isArray((parsed as { names?: unknown }).names)
      ) {
        return res.status(400).json({ error: 'Dataset must contain a names array.' });
      }
      // If-Match: "<revision>" makes the upload conditional on the revision it was made from.
      const ifMatch = req.get('If-Match');
      let expected: number | undefined;
      if (ifMatch !== undefined) {
        const m = /^"?(\d{1,15})"?$/.exec(ifMatch.trim());
        if (!m) return res.status(400).json({ error: 'If-Match must be a dataset revision.' });
        expected = Number(m[1]);
      }
      const revision = await P.putDataset(db, master, id, requireUser(req), text, expected);
      res.json({ revision });
    }),
  );

  r.get(
    '/:id/dataset',
    h(async (req, res) => {
      const text = await P.getDataset(db, master, pid(req.params.id), requireUser(req));
      if (text === null) return res.status(404).json({ error: 'No dataset.' });
      res.set('Cache-Control', 'no-store').type('application/json').send(text);
    }),
  );

  r.delete(
    '/:id/dataset',
    h(async (req, res) => {
      await P.deleteDataset(db, pid(req.params.id), requireUser(req));
      res.json({ ok: true });
    }),
  );

  return r;
}
