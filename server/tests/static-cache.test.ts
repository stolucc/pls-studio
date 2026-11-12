// Cache-Control per static file (staticCache.ts): versioned files for a year, their indexes and the page revalidated.
import { describe, expect, it } from 'vitest';
import { IMMUTABLE, NO_CACHE, staticCacheControl } from '../src/staticCache.ts';

const contrib = 'webr/repo/bin/emscripten/contrib/4.6';

describe('staticCacheControl', () => {
  it('caches the R package binaries, named by their version, for a year', () => {
    for (const f of [
      'lavaan_0.6-21.tgz',
      'cSEM_0.7.1.tgz',
      'BayesFactor_0.9.12-4.8.tgz',
      'data.table_1.17.8.tgz',
      'nloptr_2.2.1.9000.tgz',
    ])
      expect(staticCacheControl(`${contrib}/${f}`), f).toBe(IMMUTABLE);
  });

  it('revalidates the repository index on every load (it names the versions)', () => {
    for (const f of ['PACKAGES', 'PACKAGES.gz', 'PACKAGES.rds'])
      expect(staticCacheControl(`${contrib}/${f}`), f).toBe(NO_CACHE);
  });

  it('leaves unversioned R files on the default hour', () => {
    for (const f of [
      'webr/R.wasm',
      'webr/R.js',
      'webr/libRblas.so',
      'webr/vfs/usr/share/proj.data.gz',
      'webr/vfs/usr/share/proj.js.metadata',
      'webr/licenses.json',
      `${contrib}/lavaan.tgz`,
      `${contrib}/lavaan_latest.tgz`,
      `${contrib}/sub/lavaan_0.6-21.tgz`,
      'webr/src/lavaan_0.6-21.tar.gz',
      'examples/data/lavaan/HolzingerSwineford1939.json',
      'guide.html',
    ])
      expect(staticCacheControl(f), f).toBeNull();
  });

  it('revalidates the page and the R worker, and caches the hashed bundles for good', () => {
    expect(staticCacheControl('index.html')).toBe(NO_CACHE);
    expect(staticCacheControl('webr/webr-worker.js')).toBe(NO_CACHE);
    expect(staticCacheControl('assets/index-abc123.js')).toBe(IMMUTABLE);
    // (Windows separators too)
    expect(staticCacheControl('webr\\repo\\bin\\emscripten\\contrib\\4.6\\lavaan_0.6-21.tgz')).toBe(
      IMMUTABLE,
    );
  });
});
