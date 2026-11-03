import { createReadStream, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Strict CSP for production builds only: dev mode needs inline scripts for
// React Fast Refresh. All analysis runs in the browser (or in the optional
// desktop helper on 127.0.0.1), so no other external connections are allowed
// apart from the font stylesheet.
const CSP = [
  "default-src 'self'",
  // WebAssembly compilation for the in-browser R runtime (webR); JS eval stays blocked.
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  // The optional desktop R helper (helper/) listens on the loopback interface only.
  "connect-src 'self' http://127.0.0.1:9878",
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

// Cross-origin isolation: webR's SharedArrayBuffer channel (its recommended
// mode, which allows interrupting R) needs it. Every cross-origin resource must
// then be CORS-enabled (Google Fonts is).
export const ISOLATION_HEADERS = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' };

export default defineConfig({
  plugins: [react(), cspPlugin(), webrPlugin()],
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
  test: { environment: 'node', setupFiles: ['src/validation/setup.ts'], testTimeout: process.env.STRYKER_SLOW ? 1_800_000 : 60_000,
    // (webR starts in beforeAll: under a full parallel run that can take longer than vitest's 10 s)
    hookTimeout: process.env.WEBR_TESTS ? 300_000 : 10_000, exclude: ['server/**', 'node_modules/**', 'dist/**', '.stryker-tmp/**', 'reports/**', ...(process.env.WEBR_TESTS ? [] : ['**/*.webr.test.ts', '**/*.webr.test.tsx'])] },
} as never);
