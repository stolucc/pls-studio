// The validation manifest covers every webR test file and every plain test file recorded without R, and the reference
// scripts it names exist; the desktop-R evidence run is exactly the files of desktop-only packages.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { DESKTOP_ONLY, type RPackage } from '../rengine/bridge';
import { FEATURES } from './features';
import RUNS from './evidenceRuns.json';

const src = join(__dirname, '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const webrTests = walk(src).filter((p) => /\.webr\.test\.tsx?$/.test(p)).map((p) => relative(src, p).replace(/\\/g, '/').replace(/\.webr\.test\.tsx?$/, '')).sort();
const key = (path: string) => path.replace(/^src\//, '').replace(/\.(webr\.)?test\.tsx?$/, '');

it('lists every webR test file and every file recorded without R, and no other', () => {
  expect(Object.keys(FEATURES).sort()).toEqual([...webrTests, ...RUNS.fixture.map(key)].sort());
});

it('records without R only plain test files that exist', () => {
  for (const f of RUNS.fixture) {
    expect(existsSync(join(src, '..', f)), f).toBe(true);
    expect(f, 'a webR file').not.toMatch(/webr\.test/);
  }
});

it('records in desktop R exactly the webR files whose packages are all desktop-only', () => {
  const desktop = Object.entries(FEATURES).filter(([k, f]) => webrTests.includes(k) && typeof f !== 'string' && f.packages.length && f.packages.every((p) => DESKTOP_ONLY.has(p as RPackage))).map(([k]) => k);
  expect(RUNS.desktop.map(key).sort()).toEqual(desktop.sort());
  for (const f of RUNS.desktop) expect(existsSync(join(src, '..', f)), f).toBe(true);
});

it('names reference scripts that exist', () => {
  for (const [file, f] of Object.entries(FEATURES)) {
    if (typeof f === 'string') continue;
    expect(f.sources.length, file).toBeGreaterThan(0);
    for (const s of f.sources) if (s.script) expect(existsSync(join(src, '..', s.script)), `${file}: ${s.script}`).toBe(true);
  }
});
