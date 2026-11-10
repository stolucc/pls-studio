// Merge the validation evidence the webR tests wrote (PS_VALIDATION_DIR, one JSON file per test file;
// src/validation/record.ts) into public/validation.json, with the R and package versions from the webR lock.
//
//   npm run validate:evidence          (the webR tests, then the plain tests recorded without R, then this)
//   npm run validate:evidence:desktop  (the desktop-only packages' files in desktop R, then this with --desktop)
//   node scripts/validation/evidence.mjs <dir> [--desktop]
//
// The desktop run's checks (runtime "desktop") are kept by a later webR run, and replaced by the next desktop run.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? '.validation';
const desktop = process.argv.includes('--desktop');
const previous = existsSync('public/validation.json') ? JSON.parse(readFileSync('public/validation.json', 'utf8')) : null;
const lock = JSON.parse(readFileSync('scripts/webr/webr-lock.json', 'utf8'));
const pkgs = lock.packages ?? lock;
const version = (name) => pkgs?.[name]?.version;

const byKey = new Map();
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  for (const c of JSON.parse(readFileSync(join(dir, f), 'utf8'))) {
    const key = `${c.subject}:${c.id}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, c); continue; }
    // The same example checked in several test files: one check with every source and comparison (the app shows each kind of
    // evidence; `level` keeps one, published before native, for sorting).
    const rank = { published: 0, native: 1, recovery: 2, runs: 3 };
    prev.level = rank[c.level] < rank[prev.level] ? c.level : prev.level;
    prev.comparisons.push(...c.comparisons);
    for (const s of c.sources) if (!prev.sources.some((x) => x.label === s.label)) prev.sources.push(s);
    prev.packages = [...new Set([...prev.packages, ...c.packages])];
    prev.passed = prev.passed && c.passed;
    prev.test = `${prev.test}; ${c.test}`;
    prev.digest ??= c.digest;
    prev.definition ??= c.definition;
  }
}
// The other run's checks: a webR run keeps the desktop checks; a desktop run keeps everything else.
for (const c of previous?.checks ?? []) {
  const key = `${c.subject}:${c.id}`;
  if ((c.runtime === 'desktop') !== desktop && !byKey.has(key)) byKey.set(key, c);
}
const checks = [...byKey.values()].sort((a, b) => a.method.localeCompare(b.method) || a.subject.localeCompare(b.subject) || a.id.localeCompare(b.id));
const used = [...new Set(checks.flatMap((c) => c.packages))].sort();
const today = new Date().toISOString().slice(0, 10);
const out = {
  generated: desktop ? previous?.generated ?? today : today,
  ...(desktop ? { desktop: today } : previous?.desktop ? { desktop: previous.desktop } : {}),
  webR: lock.webR ?? lock.webr ?? '',
  R: lock.R ?? lock.r ?? '',
  versions: Object.fromEntries(used.map((p) => [p, version(p) ?? '']).filter(([, v]) => v)),
  checks,
};
writeFileSync('public/validation.json', `${JSON.stringify(out)}\n`);
const failed = checks.filter((c) => !c.passed);
console.log(`${checks.length} checks (${checks.reduce((a, c) => a + c.comparisons.length, 0)} comparisons), ${failed.length} failed → public/validation.json`);
if (failed.length) process.exitCode = 1;
