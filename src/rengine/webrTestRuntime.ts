// Test helper: point the R runtime at the self-hosted webR in public/webr,
// served over HTTP from a local server (webR in Node fetches packages by URL).

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, normalize, sep } from 'node:path';
import { configureR } from './runtime';

const ROOT = join(__dirname, '..', '..');
const PUBLIC = join(ROOT, 'public', 'webr');
let server: Server | null = null;

export async function startTestRuntime() {
  if (server) return;
  if (!existsSync(join(PUBLIC, 'repo'))) throw new Error('public/webr is missing: run npm run webr:fetch first.');
  server = createServer((req, res) => {
    const path = normalize(join(PUBLIC, decodeURIComponent(new URL(req.url!, 'http://x').pathname)));
    if (!path.startsWith(PUBLIC + sep) || !existsSync(path) || !statSync(path).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200);
    createReadStream(path).pipe(res);
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  configureR({ baseUrl: join(ROOT, 'node_modules', 'webr', 'dist') + '/', repoUrl: `http://127.0.0.1:${port}/repo/` });
}

export function stopTestRuntime(): Promise<void> {
  return new Promise((r) => (server ? server.close(() => { server = null; r(); }) : r()));
}
