// For the tests (Node only): an example's dataset as opening it gives, read from disk. A file shipped with the app
// from public/; data that are downloaded at use (examples/remote) from the git-ignored cache .cache/, which
// `npm run data:fetch` (scripts/validation/fetch_example_data.mjs) fills with the same conversion, then reshaped
// as the app reshapes them.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../engine/dataset';
import type { Dataset } from '../engine/types';
import type { PackageExample } from './packages';
import { remoteFromCsv } from './remote/load';
import { remoteCacheFile, type RemoteData } from './remote/source';

export const ROOT = join(__dirname, '..', '..');
export const DATA_CACHE = join(ROOT, '.cache');

/** Downloaded data from the test cache, converted and reshaped as the app does it. */
export function remoteTestData(r: RemoteData): Dataset {
  const file = join(DATA_CACHE, remoteCacheFile(r));
  if (!existsSync(file))
    throw new Error(
      `${file} is missing: run npm run data:fetch (these data are downloaded from their source, not kept in the repository).`,
    );
  return remoteFromCsv(readFileSync(file, 'utf8'), r);
}

/** The example's data when it comes from a file (shipped or downloaded); null when it comes from an R package. */
export function exampleTestData(ex: Pick<PackageExample, 'data'>): Dataset | null {
  if (ex.data.file)
    return parseCsv(readFileSync(join(ROOT, 'public', ex.data.file), 'utf8')).dataset;
  if (ex.data.remote) return remoteTestData(ex.data.remote);
  return null;
}
