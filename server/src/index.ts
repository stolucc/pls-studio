import { createServer } from 'node:http';
import { createApp, type AppDeps } from './app.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db.ts';
import { migrate } from './migrate.ts';
import { createGoogleClient } from './routes/google.ts';
import { createMailer } from './services/mailer.ts';
import { attachCollab } from './ws.ts';

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
await migrate(db);
const deps: AppDeps = {
  config, db,
  mailer: createMailer(config.SMTP_URL, config.MAIL_FROM),
  google: config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET ? await createGoogleClient(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET) : undefined,
};
const app = createApp(deps);
const server = createServer(app);
const collab = attachCollab(server, db, (app as unknown as { sessionMiddleware: Parameters<typeof attachCollab>[2] }).sessionMiddleware, config.APP_ORIGIN);
deps.onMembershipChange = (projectId, userId) => { void collab.membershipChanged(projectId, userId); };
server.listen(config.PORT, () => console.log(`PLS Studio server on :${config.PORT} (${config.NODE_ENV})`));

const shutdown = async () => {
  server.close();
  await collab.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
