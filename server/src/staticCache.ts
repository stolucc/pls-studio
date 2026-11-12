// Cache-Control for the built client's static files (app.ts serves STATIC_DIR).
//
//   index.html, webr/webr-worker.js           no-cache: revalidated on every load, so a deploy (or the worker's CSP)
//                                             takes effect at once
//   assets/*                                  Vite's content-hashed bundles: cached for a year, immutable
//   webr/repo/.../contrib/<R>/<pkg>_<v>.tgz   the R package binaries, named by their version (scripts/webr/fetch.mjs
//                                             serves exactly the pinned versions of webr-lock.json): cached for a year,
//                                             immutable, so a returning visitor does not download them again
//   webr/repo/.../PACKAGES(.gz, .rds)         the repository index naming those versions: no-cache, so a lock update
//                                             reaches browsers at once (its new versions are new file names)
//   anything else (the R runtime, example data, fonts)  max-age 1 hour (express.static's maxAge)
//
// A package binary replaced at the same version (a rebuild) must therefore be served under a new version, or browsers
// that cached the old file keep it for up to a year.

export const NO_CACHE = 'no-cache';
export const IMMUTABLE = 'public, max-age=31536000, immutable';

const PACKAGE_BINARY =
  /^webr\/repo\/bin\/emscripten\/contrib\/[0-9.]+\/[A-Za-z][A-Za-z0-9.]*_[0-9][0-9.-]*\.tgz$/;
const PACKAGE_INDEX = /^webr\/repo\/bin\/emscripten\/contrib\/[0-9.]+\/PACKAGES(\.gz|\.rds)?$/;

/** The Cache-Control header for a static file (its path relative to STATIC_DIR, any separator), or null for the default. */
export function staticCacheControl(relativePath: string): string | null {
  const p = relativePath.replace(/\\/g, '/');
  if (
    p === 'index.html' ||
    p.endsWith('/index.html') ||
    p === 'webr/webr-worker.js' ||
    PACKAGE_INDEX.test(p)
  )
    return NO_CACHE;
  if (p.startsWith('assets/') || PACKAGE_BINARY.test(p)) return IMMUTABLE;
  return null;
}
