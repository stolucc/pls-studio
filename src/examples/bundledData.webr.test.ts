// The bundled copies of the examples' R-package datasets (public/examples/data, scripts/examples/bundle-data.mjs)
// are exactly what the bridge's ps_dataset returns for each: names, rows, every value and the factor levels. The copy
// cannot drift from R: after a package update this fails until the bundle is written again.
// Run in desktop R: WEBR_TESTS=1 PS_NATIVE_R=1 npx vitest run --dir src src/examples/bundledData.webr.test.ts
// (without PS_NATIVE_R it compares with webR).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { rCall, type RPackage } from '../rengine/bridge';
import { startTestRuntime, stopTestRuntime } from '../rengine/webrTestRuntime';
import type { PackageDataset } from './bundledData';
import manifest from './bundledData.json';

beforeAll(startTestRuntime);
afterAll(stopTestRuntime);

const PUBLIC = join(__dirname, '..', '..', 'public');

/** "pkg::name?na=-99" back into ps_dataset's request. */
function request(key: string) {
  const m = /^([^:]+)::([^?]+)(?:\?na=(.*))?$/.exec(key)!;
  return { package: m[1], name: m[2], na: m[3] ? m[3].split(',').map(Number) : [] };
}

it.each(Object.entries(manifest.datasets))('%s equals ps_dataset', async (key, file) => {
  const req = request(key);
  const fromR = await rCall<PackageDataset>('ps_dataset', req, req.package as RPackage);
  const bundled = JSON.parse(readFileSync(join(PUBLIC, file), 'utf8')) as PackageDataset;
  expect(bundled.names).toEqual(fromR.names);
  expect(bundled.n).toBe(fromR.n);
  expect(bundled.levels).toEqual(fromR.levels);
  // (exactly: both are R's 15 significant digits read back as the same doubles; missing values as null)
  expect(bundled.cols).toEqual(fromR.cols);
});
