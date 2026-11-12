// Every package the browser runs must be in the self-hosted webR library (scripts/webr/webr-lock.json):
// adding one to R_PACKAGES without listing it in fetch.mjs's ROOTS leaves it out of public/webr.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { DESKTOP_ONLY, R_PACKAGES, type RPackage } from './bridge';

const lock = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'scripts', 'webr', 'webr-lock.json'), 'utf8'),
);
const locked = new Set(Object.keys(lock.packages ?? lock));
const BASE = new Set([
  'stats',
  'utils',
  'graphics',
  'grDevices',
  'methods',
  'parallel',
  'splines',
  'stats4',
  'tools',
  'grid',
  'datasets',
  'compiler',
  'tcltk',
]);

it('locks every package the browser loads', () => {
  const missing = (Object.keys(R_PACKAGES) as RPackage[])
    .filter((k) => !DESKTOP_ONLY.has(k))
    .flatMap((k) =>
      (R_PACKAGES[k] as readonly string[])
        .filter((p) => !BASE.has(p) && !locked.has(p))
        .map((p) => `${k}: ${p}`),
    );
  expect(missing).toEqual([]);
});

// effectsize only suggests boot, and webR's base library has no boot: without it effectsize warns and leaves out the
// bootstrap interval of Kruskal-Wallis's rank epsilon-squared (desktop R always has boot, a recommended package).
it('loads boot with effectsize', () => {
  const without = (Object.keys(R_PACKAGES) as RPackage[]).filter((k) => {
    const set = R_PACKAGES[k] as readonly string[];
    return set.includes('effectsize') && !set.includes('boot');
  });
  expect(without).toEqual([]);
});
