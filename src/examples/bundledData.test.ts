// The bundled copies of the examples' R-package datasets (scripts/examples/bundle-data.mjs): every example that reads
// its dataset with ps_dataset has one, and the manifest and public/examples/data hold nothing else. (That each copy
// equals R's result: bundledData.webr.test.ts.)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import type { PackageDataset } from './bundledData';
import manifest from './bundledData.json';
import { bundledDataKey, bundledDataPath, R_LOADED } from './bundledDataKey';
import { PACKAGE_EXAMPLES } from './packages';

const PUBLIC = join(__dirname, '..', '..', 'public');
const rLoaded = PACKAGE_EXAMPLES.filter((e) => R_LOADED(e.data));

it('has a bundled copy of every dataset an example reads from an R package', () => {
  expect(rLoaded.length).toBeGreaterThan(100);
  for (const ex of rLoaded) {
    const file = (manifest.datasets as Record<string, string>)[bundledDataKey(ex.data)];
    expect(file, `${ex.id}: run node scripts/examples/bundle-data.mjs`).toBe(
      bundledDataPath(ex.data),
    );
    expect(existsSync(join(PUBLIC, file)), file).toBe(true);
  }
});

it('lists no dataset that no example reads, and the data folder holds only the listed files', () => {
  const used = new Set(rLoaded.map((e) => bundledDataKey(e.data)));
  expect(Object.keys(manifest.datasets).filter((k) => !used.has(k))).toEqual([]);
  const dir = join(PUBLIC, 'examples', 'data');
  const walk = (d: string): string[] =>
    readdirSync(d).flatMap((f) =>
      statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)],
    );
  expect(
    walk(dir)
      .map((f) => relative(PUBLIC, f).replace(/\\/g, '/'))
      .sort(),
  ).toEqual(Object.values(manifest.datasets).sort());
});

it('keys the copies by package, dataset and missing-value codes', () => {
  expect(bundledDataKey({ package: 'lavaan', name: 'HolzingerSwineford1939' })).toBe(
    'lavaan::HolzingerSwineford1939',
  );
  const coded = { package: 'seminr', name: 'corp_rep_data', na: [-99] };
  expect(bundledDataKey(coded)).toBe('seminr::corp_rep_data?na=-99');
  expect(bundledDataPath(coded)).toBe('examples/data/seminr/corp_rep_data.na-99.json');
  expect(
    R_LOADED({ package: 'stats', name: 'Dobson', file: 'examples/regression/dobson.csv' }),
  ).toBe(false);
});

it('stores each copy in ps_dataset’s shape: equal-length columns, one per name', () => {
  for (const file of Object.values(manifest.datasets)) {
    const d = JSON.parse(readFileSync(join(PUBLIC, file), 'utf8')) as PackageDataset;
    expect(d.cols.length, file).toBe(d.names.length);
    for (const c of d.cols) expect(c.length, file).toBe(d.n);
  }
});

it('keeps the copies small (each example downloads only its own)', () => {
  const sizes = Object.values(manifest.datasets).map((f) => statSync(join(PUBLIC, f)).size);
  expect(Math.max(...sizes)).toBeLessThan(1_000_000);
  expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(5_000_000);
});
