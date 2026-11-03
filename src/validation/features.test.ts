// The validation manifest covers every webR test file, and the reference scripts it names exist.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';
import { FEATURES } from './features';

const src = join(__dirname, '..');
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const webrTests = walk(src).filter((p) => /\.webr\.test\.tsx?$/.test(p)).map((p) => relative(src, p).replace(/\\/g, '/').replace(/\.webr\.test\.tsx?$/, '')).sort();

it('lists every webR test file, and no other', () => {
  expect(Object.keys(FEATURES).sort()).toEqual(webrTests);
});

it('names reference scripts that exist', () => {
  for (const [file, f] of Object.entries(FEATURES)) {
    if (typeof f === 'string') continue;
    expect(f.sources.length, file).toBeGreaterThan(0);
    for (const s of f.sources) if (s.script) expect(existsSync(join(src, '..', s.script)), `${file}: ${s.script}`).toBe(true);
  }
});
