// Test helper: point the R runtime at the self-hosted webR in public/webr,
// served over HTTP from a local server (webR in Node fetches packages by URL).

import { appendFileSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { cpus } from 'node:os';
import { join, normalize, sep } from 'node:path';
import { configureR, observeCalls } from './runtime';
import { setHelperTransport } from './helper';
import { useCompute } from './compute';
import { startNativePool, type NativePool } from './nativeR';

const ROOT = join(__dirname, '..', '..');
const PUBLIC = join(ROOT, 'public', 'webr');
let server: Server | null = null;
let native: NativePool | null = null;

export async function startTestRuntime() {
  // PS_NATIVE_R=1 (npm run test:native): the bridge's calls run in desktop R (nativeR.ts); webR stays available for
  // tests that drive it directly. Not for the validation record, which is what the browser computes.
  if (process.env.PS_NATIVE_R && !native) {
    if (process.env.PS_VALIDATION_DIR) throw new Error('The validation record is recorded from webR: unset PS_NATIVE_R.');
    native = await startNativePool(ROOT, Math.max(1, Number(process.env.PS_NATIVE_WORKERS) || Math.min(8, Math.max(2, cpus().length - 2))));
    setHelperTransport(native);
    useCompute.setState({ backend: 'helper' });
  }
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
  // PS_RECORD_REQUESTS=<file>: record every bridge call (scripts/security/replay-injection.R replays them).
  const record = process.env.PS_RECORD_REQUESTS;
  // (calls arrive either as `ps_x(req)` or, through rCall, as `ps_call("ps_x", req)`; both are kept as `ps_x(req)`)
  if (record) observeCalls((call, req) => {
    const viaCall = /^ps_call\("(ps_[a-z0-9_]+)", req[,)]/.exec(call);
    const fn = viaCall ? `${viaCall[1]}(req)` : /^ps_[a-z0-9_]+\(req[,)]/.test(call) ? call : null;
    if (fn) appendFileSync(record, `${JSON.stringify({ call: fn, req })}\n`);
  });
}

export function stopTestRuntime(): Promise<void> {
  if (native) { native.stop(); native = null; setHelperTransport(null); }
  return new Promise((r) => (server ? server.close(() => { server = null; r(); }) : r()));
}
