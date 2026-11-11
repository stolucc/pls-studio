import { createReadStream, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { STATMODEL_BASE, statmodelPath } from './src/examples/remote/source';
import WebrSequencer from './src/validation/webrSequencer';
import EVIDENCE_RUNS from './src/validation/evidenceRuns.json';

// Strict CSP for production builds only: dev mode needs inline scripts for
// React Fast Refresh. All analysis runs in the browser (or in the optional
// desktop helper on 127.0.0.1), so no other external connections are allowed
// apart from the font stylesheet and example data read from their source.
const CSP = [
  "default-src 'self'",
  // WebAssembly compilation for the in-browser R runtime (webR); JS eval stays blocked.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  // The optional desktop R helper (helper/) listens on the loopback interface only; example data that PLS Studio
  // does not distribute are read from their source when an example opens (src/examples/remote: RI-CLPM tutorial).
  "connect-src 'self' http://127.0.0.1:9878 https://raw.githubusercontent.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const cspPlugin = (): Plugin => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

// The R runtime's files (public/webr) must arrive byte for byte: Vite's static
// server marks *.gz as Content-Encoding: gzip, so the browser would unpack
// webR's compressed filesystem images before webR does. Serve them verbatim.
const WEBR_DIR = join(__dirname, 'public', 'webr');
const webrFiles: Connect.NextHandleFunction = (req, res, next) => {
  const url = req.url?.split('?')[0] ?? '';
  if (!url.startsWith('/webr/')) return next();
  const file = normalize(join(WEBR_DIR, decodeURIComponent(url.slice('/webr/'.length))));
  if (!file.startsWith(WEBR_DIR + sep)) return next();
  let size: number;
  try { const st = statSync(file); if (!st.isFile()) return next(); size = st.size; } catch { return next(); }
  res.setHeader('Content-Type', file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
  res.setHeader('Content-Length', String(size));
  for (const [k, v] of Object.entries(ISOLATION_HEADERS)) res.setHeader(k, v);
  createReadStream(file).pipe(res);
};
const webrPlugin = (): Plugin => ({
  name: 'serve-webr-verbatim',
  configureServer: (server) => { server.middlewares.use(webrFiles); },
  configurePreviewServer: (server) => { server.middlewares.use(webrFiles); },
});

// Development without the collaboration server (it needs PostgreSQL): the dev server passes the Mplus example data
// through itself, with the same allowlist and limits as server/src/routes/exampleData.ts (production uses that route).
const exampleData: Connect.NextHandleFunction = (req, res, next) => {
  const url = req.url ?? '';
  const prefix = '/api/example-data/statmodel/';
  if (!url.startsWith(prefix) || req.method !== 'GET') return next();
  const path = statmodelPath(url.slice(prefix.length));
  if (!path) { res.statusCode = 404; res.end('Not one of the Mplus User’s Guide example files.'); return; }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  void (async () => {
    try {
      const up = await fetch(STATMODEL_BASE + path, { redirect: 'manual', signal: controller.signal });
      if (up.status !== 200) { res.statusCode = up.status >= 300 && up.status < 500 ? 404 : 502; res.end('statmodel.com does not have this file.'); return; }
      const body = Buffer.from(await up.arrayBuffer());
      if (body.length > 10 * 1024 * 1024) { res.statusCode = 502; res.end('The file is too large.'); return; }
      res.setHeader('Content-Type', 'text/plain; charset=iso-8859-1');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      for (const [k, v] of Object.entries(ISOLATION_HEADERS)) res.setHeader(k, v);
      res.end(body);
    } catch {
      res.statusCode = 504; res.end('statmodel.com did not answer.');
    } finally { clearTimeout(timer); }
  })();
};
const exampleDataPlugin = (): Plugin => ({
  name: 'example-data-dev',
  configureServer: (server) => { server.middlewares.use(exampleData); },
  configurePreviewServer: (server) => { server.middlewares.use(exampleData); },
});

// Cross-origin isolation: webR's SharedArrayBuffer channel (its recommended
// mode, which allows interrupting R) needs it. Every cross-origin resource must
// then be CORS-enabled (Google Fonts is).
export const ISOLATION_HEADERS = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  plugins: [react(), cspPlugin(), webrPlugin(), exampleDataPlugin()],
  // Development: the collaboration server (server/) runs on :8787; same-origin via proxy.
  server: {
    port: 5175,
    strictPort: true,
    headers: ISOLATION_HEADERS,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: false },
      '/ws': { target: 'ws://localhost:8787', ws: true, changeOrigin: false },
    },
  },
  preview: {
    port: 4175,
    headers: ISOLATION_HEADERS,
    proxy: {
      '/api': { target: 'http://localhost:8787', changeOrigin: false },
      '/ws': { target: 'ws://localhost:8787', ws: true, changeOrigin: false },
    },
  },
  worker: { format: 'es' },
  // The server package has its own (database-backed) test run: `cd server && npm test`.
  // *.webr.test.ts start R (webR) and need public/webr (npm run webr:fetch): run them with npm run test:webr.
  // Statistical tests (Monte Carlo, bootstrap) run long under mutation-testing instrumentation.
  // setupFiles: the validation evidence (src/validation/setup.ts), recorded only with PS_VALIDATION_DIR set.
  // The slow webR tests (src/rengine/webrSlow.ts: slowIt, and files named *.slow.webr.test.ts) run with WEBR_SLOW set
  // (npm run validate:evidence, the nightly CI job); the webR files start slowest first (src/validation/webrSequencer.ts).
  // The webR files of desktop-only packages (src/validation/evidenceRuns.json `desktop`) run only in desktop R (PS_NATIVE_R).
  test: { environment: 'node', setupFiles: ['src/validation/setup.ts'], testTimeout: process.env.STRYKER_SLOW ? 1_800_000 : 60_000,
    ...(process.env.WEBR_TESTS ? { sequence: { sequencer: WebrSequencer } } : {}),
    // (webR starts in beforeAll: under a full parallel run that can take longer than vitest's 10 s)
    hookTimeout: process.env.WEBR_TESTS ? 300_000 : 10_000, exclude: ['server/**', 'node_modules/**', 'dist/**', '.stryker-tmp/**', 'reports/**', '.claude/**' /* agents' git worktrees */, ...(process.env.WEBR_TESTS ? [] : ['**/*.webr.test.ts', '**/*.webr.test.tsx']), ...(process.env.WEBR_SLOW ? [] : ['**/*.slow.webr.test.ts', '**/*.slow.webr.test.tsx']), ...(process.env.WEBR_TESTS && !process.env.PS_NATIVE_R ? EVIDENCE_RUNS.desktop : [])] },
} as never);
